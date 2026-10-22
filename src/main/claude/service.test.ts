import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { ChatAction, ChatMessage, ClaudeEvent, DiskDelta, ImageType, SendRequest } from '@shared/ipc';
import { WorkspaceSession } from '../workspace/session';
import { imageBytes, testImage } from './__fixtures__/image-bytes';
import { CHATS_DIR, readChat, writeChat } from './chats';
import { buildPrompt } from './command';
import { IMAGES_DIR } from './images';
import { ClaudeService, parseSendRequest, parseUndoArgs } from './service';

const FIXTURES = join(__dirname, '__fixtures__');
const FAKE = join(FIXTURES, 'fake-claude.mjs');
const SESSION_ID = 'e607f87c-c213-4764-b30b-b92b8927eec4';
// Laid out unusually on purpose: undo must give back these exact bytes, not a reformatted page.
const A_TEXT = '{\n  "id": "a",  "title": "A",\n  "position": 0,\n  "blocks": [{ "type": "paragraph", "text": "one" }]\n}\n';
const B_TEXT = '{"id":"b","title":"Bee","position":1,"blocks":[]}\n';
// What fake-claude.mjs writes.
const A_AFTER = `${JSON.stringify({ ...JSON.parse(A_TEXT), blocks: [...JSON.parse(A_TEXT).blocks, { type: 'paragraph', text: 'Hello from Claude.' }] }, null, 2)}\n`;
const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 1 L9 9"/></svg>\n';
const P_TEXT = `${JSON.stringify({ id: 'np000001', title: 'P', position: 0, blocks: [] }, null, 2)}\n`;
// "no position": a page without a position, and the app's tidy-up of it with the position filled in.
const R_FILE = { id: 'rng00001', title: 'R', created: '2026-10-21T00:00:00.000Z', updated: '2026-10-21T00:00:00.000Z', blocks: [] };
const R_TEXT = `${JSON.stringify(R_FILE, null, 2)}\n`;
const R_TIDIED = `${JSON.stringify({ id: R_FILE.id, title: 'R', position: 2, created: R_FILE.created, updated: R_FILE.updated, blocks: [] }, null, 2)}\n`;
// "inline strokes": a drawing block with its strokes in the page, and the app's tidy-up moving them to the drawing's file.
const INLINE = { type: 'drawing', id: 'd1', height: 200, strokes: [{ tool: 'pen', color: 'ink', size: 3, points: '10,10,0.5 60,60,0.5' }] };
const A_INLINE = `${JSON.stringify({ ...JSON.parse(A_TEXT), blocks: [...JSON.parse(A_TEXT).blocks, INLINE] }, null, 2)}\n`;
const A_TIDIED = `${JSON.stringify({ ...JSON.parse(A_TEXT), created: R_FILE.created, updated: R_FILE.updated, blocks: [...JSON.parse(A_TEXT).blocks, { type: 'drawing', id: 'd1', file: 'drawing-d1.svg' }] }, null, 2)}\n`;
const D1_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 200"><path data-points="10,10,0.5 60,60,0.5"/></svg>\n';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exists = (abs: string) => stat(abs).then(() => true, () => false);
const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

function resultText(name: string): string {
  const lines = readFileSync(join(FIXTURES, name), 'utf8').split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1]).result;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Sets environment variables for this test only. */
function withEnv(vars: Record<string, string | undefined>): void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const apply = (v: Record<string, string | undefined>) => {
    for (const [k, value] of Object.entries(v)) {
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    }
  };
  apply(vars);
  cleanups.push(() => apply(saved));
}

async function waitFor<T>(what: string, check: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
}

async function exited(child: ChildProcess): Promise<void> {
  if (!running(child)) return;
  await new Promise((resolve) => child.once('exit', resolve));
}

interface Setup {
  root: string;
  log: string;
  session: WorkspaceSession;
  service: ClaudeService;
  events: ClaudeEvent[];
  deltas: DiskDelta[];
  children: ChildProcess[];
  /** Processes the fake left behind on purpose, killed after the test. */
  strays: number[];
}

/**
 * A real session on a temp workspace (reached through a symlink, as macOS temp folders are), and the fake CLI.
 * The fake runs through node; any other path is spawned as it is.
 */
async function setup(over: { locate?: () => Promise<string | null>; stopGraceMs?: number } = {}): Promise<Setup> {
  const parent = await mkdtemp(join(tmpdir(), 'quest-claude-'));
  const real = join(parent, 'real');
  await mkdir(join(real, 'Markets'), { recursive: true });
  await writeFile(join(real, 'Markets/A.json'), A_TEXT);
  await writeFile(join(real, 'Markets/B.json'), B_TEXT);
  await writeFile(join(real, 'README.md'), 'readme\n');
  const root = join(parent, 'ws');
  await symlink(real, root);
  const log = join(parent, 'fake-log.json');
  withEnv({ FAKE_LOG: log, FAKE_LOGGED_OUT: undefined, FAKE_AUTH_BROKEN: undefined });

  const events: ClaudeEvent[] = [];
  const deltas: DiskDelta[] = [];
  const children: ChildProcess[] = [];
  const strays: number[] = [];
  let service: ClaudeService | undefined;
  const session = await WorkspaceSession.open(
    root,
    false,
    { change: (d) => deltas.push(d), lost: () => {}, fileChanges: (c) => service?.fileChanges(c), repaired: (f) => service?.repaired(f) },
    trash,
    60_000,
  );
  service = new ClaudeService(root, session, {
    locate: over.locate ?? (async () => FAKE),
    spawn: spawnVia(children),
    trash,
    send: (e) => events.push(e),
    stopGraceMs: over.stopGraceMs ?? 200,
    exitGraceMs: 200,
  });
  const made = service;
  cleanups.push(async () => {
    // Waits for the record of a turn the close cut short, so it isn't written into a folder being removed.
    await made.close();
    session.close();
    for (const child of children) {
      if (running(child)) child.kill('SIGKILL');
      await exited(child);
    }
    for (const pid of strays) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    await rm(parent, { recursive: true, force: true });
  });
  return { root, log, session, service, events, deltas, children, strays };
}

const trash = (abs: string) => rm(abs, { recursive: true });

/** A spawn that runs the fake through node, and anything else as it is, keeping every child. */
function spawnVia(children: ChildProcess[]): typeof spawn {
  return ((command: string, args: readonly string[], options: SpawnOptions) => {
    const child = command === FAKE ? spawn(process.execPath, [command, ...args], options) : spawn(command, args, options);
    children.push(child);
    return child;
  }) as unknown as typeof spawn;
}

/** A second service on the same workspace, as after reopening it. */
async function reopen(s: Setup): Promise<ClaudeService> {
  const session = await WorkspaceSession.open(s.root, false, { change: () => {}, lost: () => {} }, trash, 60_000);
  const service = new ClaudeService(s.root, session, { locate: async () => FAKE, spawn: spawnVia(s.children), trash, send: () => {} });
  cleanups.push(async () => {
    await service.close();
    session.close();
  });
  return service;
}

const request = (message: string, over: Partial<SendRequest> = {}): SendRequest => ({ chatId: null, message, references: [], openPageId: null, ...over });

async function sendOk(s: Setup, message: string, over: Partial<SendRequest> = {}): Promise<{ chatId: string; messageId: string }> {
  await rm(s.log, { force: true });
  const result = await s.service.send(request(message, over));
  if ('error' in result) throw new Error(result.error);
  return result;
}

const doneOf = (s: Setup, messageId: string): Promise<ChatMessage> =>
  waitFor('the done event', () => {
    const done = s.events.find((e) => e.kind === 'done' && e.messageId === messageId);
    return done?.kind === 'done' ? done.message : undefined;
  });

/** The fake has written its log, so its signal handlers are in place. */
const fakeReady = (s: Setup) => waitFor('the fake to start', () => exists(s.log));
/** What the fake was given: its arguments, environment names and PATH, and the message it read on stdin. */
const fakeLog = async (s: Setup): Promise<{ argv: string[]; envKeys: string[]; path: string; prompt: string; images: { type: ImageType; bytes: number }[] }> =>
  JSON.parse(await readFile(s.log, 'utf8'));

const withoutId = ({ id: _id, ...rest }: ChatAction) => rest;
const actionEvents = (s: Setup, messageId: string) => s.events.flatMap((e) => (e.kind === 'action' && e.messageId === messageId ? [e.action] : []));

describe('a turn', () => {
  test('streams text and actions, then done', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'Add a paragraph');
    const message = await doneOf(s, messageId);

    expect(s.events.every((e) => e.chatId === chatId && e.messageId === messageId)).toBe(true);
    expect(s.events[s.events.length - 1].kind).toBe('done');
    const text = s.events.flatMap((e) => (e.kind === 'text' ? [e.text] : [])).join('');
    expect(text).toBe(resultText('read-and-edit.jsonl'));
    const expected = [
      { verb: 'read', path: 'Markets/A.json' },
      { verb: 'edited', path: 'Markets/A.json' },
      { verb: 'created', path: 'Markets/A/drawing-x1.svg' },
    ];
    expect(actionEvents(s, messageId).map(withoutId)).toEqual(expected);
    expect(message).toMatchObject({ id: messageId, role: 'assistant', text: resultText('read-and-edit.jsonl') });
    expect(message.actions?.map(withoutId)).toEqual(expected);
    expect(message.error).toBeUndefined();
  });

  test('the reply lists what changed, with the exact text before and after', async () => {
    const s = await setup();
    const { messageId } = await sendOk(s, 'Add a paragraph');
    const message = await doneOf(s, messageId);
    expect(message.changes).toEqual([
      { path: 'Markets/A.json', pageId: 'a', kind: 'edited', drawing: false, before: A_TEXT, after: A_AFTER },
      { path: 'Markets/A/drawing-x1.svg', pageId: 'a', kind: 'created', drawing: true, before: null, after: DRAWING },
    ]);
    expect(await readFile(join(s.root, 'Markets/A.json'), 'utf8')).toBe(A_AFTER);
  });

  test('the chat file keeps both messages, the references and the session id', async () => {
    const s = await setup();
    const references = [
      { kind: 'page' as const, pageId: 'b', title: 'Bee' },
      { kind: 'selection' as const, pageId: 'a', title: 'A', text: 'one\ntwo' },
      { kind: 'page' as const, pageId: 'gone', title: 'Gone' },
    ];
    const { chatId, messageId } = await sendOk(s, 'Tidy this page', { openPageId: 'a', references });
    const message = await doneOf(s, messageId);

    const chat = await readChat(s.root, chatId);
    expect(chat).toMatchObject({ id: chatId, title: 'Tidy this page', sessionId: SESSION_ID });
    expect(chat?.messages).toHaveLength(2);
    expect(chat?.messages[0]).toMatchObject({
      role: 'user',
      text: 'Tidy this page',
      references: [{ kind: 'page', pageId: 'a', title: 'A' }, references[0], references[1]],
    });
    expect(typeof chat?.messages[0].id).toBe('string');
    expect(chat?.messages[1]).toEqual(message);

    const { prompt } = await fakeLog(s);
    expect(prompt).toBe(
      buildPrompt({
        message: 'Tidy this page',
        openPage: { title: 'A', path: 'Markets/A.json' },
        references: [{ title: 'Bee', path: 'Markets/B.json' }],
        blocks: [],
        selections: [{ title: 'A', text: 'one\ntwo' }],
      }),
    );
  });

  test('every selection reaches Claude, in turn, under its page title as it is now', async () => {
    const s = await setup();
    const references = [
      { kind: 'selection' as const, pageId: 'a', title: 'A', text: 'one' },
      { kind: 'selection' as const, pageId: 'gone', title: 'Gone', text: 'lost' },
      { kind: 'selection' as const, pageId: 'b', title: 'Old title', text: 'bee text' },
      { kind: 'selection' as const, pageId: 'a', title: 'A', text: 'one again' },
    ];
    const { chatId, messageId } = await sendOk(s, 'Compare these', { references });
    await doneOf(s, messageId);
    const { prompt } = await fakeLog(s);
    expect(prompt).toBe(
      buildPrompt({
        message: 'Compare these',
        openPage: null,
        references: [],
        blocks: [],
        selections: [
          { title: 'A', text: 'one' },
          { title: 'Bee', text: 'bee text' },
          { title: 'A', text: 'one again' },
        ],
      }),
    );
    expect((await readChat(s.root, chatId))?.messages[0].references).toEqual([references[0], references[2], references[3]]);
  });

  test('the prompt sees a page added on disk just before the send, at its path and title', async () => {
    const s = await setup();
    // As a save the window makes just before sending: not yet read by the session.
    await writeFile(join(s.root, 'Markets/C.json'), '{"id":"c","title":"Sea","position":2,"blocks":[]}\n');
    const references = [{ kind: 'selection' as const, pageId: 'c', title: 'Untitled', text: 'waves' }];
    const { chatId, messageId } = await sendOk(s, 'Look at this', { openPageId: 'c', references });
    await doneOf(s, messageId);
    const { prompt } = await fakeLog(s);
    expect(prompt).toBe(
      buildPrompt({ message: 'Look at this', openPage: { title: 'Sea', path: 'Markets/C.json' }, references: [], blocks: [], selections: [{ title: 'Sea', text: 'waves' }] }),
    );
    expect((await readChat(s.root, chatId))?.messages[0].references).toEqual([{ kind: 'page', pageId: 'c', title: 'Sea' }, references[0]]);
  });

  test('a message over 100,000 characters is refused as too long, and nothing runs', async () => {
    const s = await setup();
    expect(await s.service.send(request('x'.repeat(100_001)))).toEqual({ error: 'That message is too long' });
    expect(s.children).toHaveLength(0);
    expect(await s.service.listChats()).toEqual([]);
    const { messageId } = await sendOk(s, `Add a paragraph${' '.repeat(100_000 - 'Add a paragraph'.length)}`);
    expect((await doneOf(s, messageId)).error).toBeUndefined();
  });

  test('a turn whose reply cannot be saved still ends, with a done that says why, and the service is free again', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'sleep');
    await fakeReady(s);
    const chats = join(s.root, CHATS_DIR);
    await chmod(chats, 0o555);
    cleanups.push(() => chmod(chats, 0o755));
    await s.service.stop();
    const message = await doneOf(s, messageId);
    expect(message.error).toMatch(/^Couldn't save this reply: /);
    expect(message.changes).toBeUndefined();
    expect((await readChat(s.root, chatId))?.messages).toHaveLength(1);

    await chmod(chats, 0o755);
    const next = await sendOk(s, 'Add a paragraph');
    expect((await doneOf(s, next.messageId)).error).toBeUndefined();
  });

  test('a second send while a turn runs is refused', async () => {
    const s = await setup();
    const { messageId } = await sendOk(s, 'sleep');
    expect(await s.service.send(request('Another'))).toEqual({ error: 'Claude is still answering' });
    await fakeReady(s);
    await s.service.stop();
    await doneOf(s, messageId);
    expect(s.children).toHaveLength(1);
  });

  test('the next turn in a chat resumes its session', async () => {
    const s = await setup();
    const first = await sendOk(s, 'Add a paragraph');
    await doneOf(s, first.messageId);
    expect((await fakeLog(s)).argv).not.toContain('--resume');

    const second = await sendOk(s, 'And another', { chatId: first.chatId });
    expect(second.chatId).toBe(first.chatId);
    await doneOf(s, second.messageId);
    const { argv } = await fakeLog(s);
    expect(argv.slice(argv.indexOf('--resume'), argv.indexOf('--resume') + 2)).toEqual(['--resume', SESSION_ID]);
    const chat = await readChat(s.root, first.chatId);
    expect(chat?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(chat?.sessionId).toBe(SESSION_ID);
  });

  test('a chat that is gone gives an error', async () => {
    const s = await setup();
    expect(await s.service.send(request('Hi', { chatId: 'zzzzzzzz' }))).toEqual({ error: 'That chat is gone' });
    expect(s.children).toHaveLength(0);
  });

  test('the child gets no API key or host variables, and finds node next to claude', async () => {
    const s = await setup();
    withEnv({ ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_BASE_URL: 'http://proxy', CLAUDE_CODE_SIMPLE: '1', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/cfg' });
    const { messageId } = await sendOk(s, 'Add a paragraph');
    await doneOf(s, messageId);
    const { envKeys, path, argv } = await fakeLog(s);
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_SIMPLE', 'CLAUDECODE']) expect(envKeys).not.toContain(key);
    expect(envKeys).toContain('CLAUDE_CONFIG_DIR');
    expect(path.startsWith(`${FIXTURES}${delimiter}`)).toBe(true);
    expect(argv[0]).toBe('-p');
    expect(argv).not.toContain('acceptEdits');
  });
});

describe('the message on stdin', () => {
  test('goes in as stream-json, and never on the command line', async () => {
    const s = await setup();
    const message = '--bare Add a paragraph';
    const { messageId } = await sendOk(s, message);
    expect((await doneOf(s, messageId)).error).toBeUndefined();
    const { argv, prompt, images } = await fakeLog(s);
    expect(argv.slice(0, 3)).toEqual(['-p', '--input-format', 'stream-json']);
    expect(argv).not.toContain('--');
    expect(argv.some((arg) => arg.includes('Add a paragraph'))).toBe(false);
    expect(prompt).toBe(message);
    expect(images).toEqual([]);
  });

  test('a claude that is gone before it reads the message ends the turn with an error, and nothing crashes', async () => {
    const s = await setup();
    // The fake exits at once without reading; an image too big for the pipe makes the write fail.
    withEnv({ FAKE_EXIT_AT_ONCE: '1' });
    const first = await sendOk(s, 'Look at this', { images: [testImage('image/png', 4 * 1024 * 1024)] });
    expect((await doneOf(s, first.messageId)).error).toBe('Claude stopped unexpectedly: exit code 3');
    withEnv({ FAKE_EXIT_AT_ONCE: undefined });
    const next = await sendOk(s, 'Add a paragraph', { chatId: first.chatId });
    expect((await doneOf(s, next.messageId)).error).toBeUndefined();
  });
});

describe('images', () => {
  const imageFiles = async (s: Setup) => (await readdir(join(s.root, IMAGES_DIR)).catch(() => [] as string[])).sort();

  test('are saved with the chat, listed on the message in order, and reach Claude as they were', async () => {
    const s = await setup();
    const images = [testImage('image/png', 1000), testImage('image/jpeg', 2000), testImage('image/webp', 300), testImage('image/gif', 40)];
    const { chatId, messageId } = await sendOk(s, 'What is in these?', { images });
    expect((await doneOf(s, messageId)).error).toBeUndefined();

    expect((await fakeLog(s)).images).toEqual([
      { type: 'image/png', bytes: 1000 },
      { type: 'image/jpeg', bytes: 2000 },
      { type: 'image/webp', bytes: 300 },
      { type: 'image/gif', bytes: 40 },
    ]);
    const saved = (await readChat(s.root, chatId))?.messages[0].images ?? [];
    expect(saved.map((i) => i.type)).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    expect(saved.map((i) => i.file.slice(i.file.lastIndexOf('.')))).toEqual(['.png', '.jpg', '.webp', '.gif']);
    for (const [i, { file }] of saved.entries()) {
      expect(file).toMatch(new RegExp(`^${chatId}-[a-z0-9]{8}\\.(png|jpg|gif|webp)$`));
      expect(await readFile(join(s.root, IMAGES_DIR, file))).toEqual(Buffer.from(images[i].data, 'base64'));
      expect(await s.service.image(chatId, file)).toEqual(images[i]);
    }
    expect(await imageFiles(s)).toEqual(saved.map((i) => i.file).sort());
    // The reply has no images, and a message without any has no list.
    expect((await readChat(s.root, chatId))?.messages[1].images).toBeUndefined();
    const next = await sendOk(s, 'Add a paragraph', { chatId });
    await doneOf(s, next.messageId);
    expect((await readChat(s.root, chatId))?.messages[2].images).toBeUndefined();
    expect((await fakeLog(s)).images).toEqual([]);
  });

  test('a message of images only reaches Claude as "(see the image)", and is kept as it was typed', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, '  ', { images: [testImage('image/gif')], openPageId: 'a' });
    await doneOf(s, messageId);
    expect((await fakeLog(s)).prompt).toBe(buildPrompt({ message: '(see the image)', openPage: { title: 'A', path: 'Markets/A.json' }, references: [], blocks: [], selections: [] }));
    const chat = await readChat(s.root, chatId);
    expect(chat?.messages[0]).toMatchObject({ role: 'user', text: '  ', images: [{ type: 'image/gif' }] });
    expect(chat?.title).toBe('New chat');
  });

  test("image() reads only this chat's own image files", async () => {
    const s = await setup();
    const first = await sendOk(s, 'Look', { images: [testImage('image/png')] });
    await doneOf(s, first.messageId);
    const second = await sendOk(s, 'Look again', { images: [testImage('image/jpeg')] });
    await doneOf(s, second.messageId);
    const [mine] = (await readChat(s.root, first.chatId))?.messages[0].images ?? [];
    const [theirs] = (await readChat(s.root, second.chatId))?.messages[0].images ?? [];

    expect(await s.service.image(first.chatId, mine.file)).toEqual({ type: 'image/png', data: imageBytes('image/png').toString('base64') });
    expect(await s.service.image(first.chatId, theirs.file)).toBeNull();
    expect(await s.service.image(second.chatId, mine.file)).toBeNull();
    expect(await s.service.image(first.chatId, `../images/${mine.file}`)).toBeNull();
    expect(await s.service.image(first.chatId, `${first.chatId}-00000000.png`)).toBeNull();
    expect(await s.service.image('../chats', mine.file)).toBeNull();
    expect(await s.service.image(first.chatId, `${first.chatId}.json`)).toBeNull();
    expect(await s.service.image(first.chatId, '../../Markets/A.json')).toBeNull();
  });

  test("deleting a chat trashes its images, and leaves other chats' images", async () => {
    const s = await setup();
    const first = await sendOk(s, 'Look', { images: [testImage('image/png'), testImage('image/png')] });
    await doneOf(s, first.messageId);
    const second = await sendOk(s, 'Look again', { images: [testImage('image/jpeg')] });
    await doneOf(s, second.messageId);
    expect(await imageFiles(s)).toHaveLength(3);
    await s.service.deleteChat(first.chatId);
    expect((await imageFiles(s)).map((f) => f.slice(0, 8))).toEqual([second.chatId]);
  });
});

describe('block references', () => {
  test('a block whose page is known reaches Claude after the references and before the selections, under its page as it is now, and is kept', async () => {
    const s = await setup();
    const block = { kind: 'block' as const, pageId: 'b', title: 'Old title', text: '{\n  "type": "paragraph"\n}', where: 'block 1 of 1' };
    const lost = { kind: 'block' as const, pageId: 'gone', title: 'Gone', text: '{}', where: 'block 2 of 9' };
    const selection = { kind: 'selection' as const, pageId: 'a', title: 'A', text: 'one' };
    const { chatId, messageId } = await sendOk(s, 'Explain', { openPageId: 'a', references: [block, lost, selection] });
    await doneOf(s, messageId);
    expect((await fakeLog(s)).prompt).toBe(
      buildPrompt({
        message: 'Explain',
        openPage: { title: 'A', path: 'Markets/A.json' },
        references: [],
        blocks: [{ title: 'Bee', path: 'Markets/B.json', where: 'block 1 of 1', text: block.text }],
        selections: [{ title: 'A', text: 'one' }],
      }),
    );
    expect((await readChat(s.root, chatId))?.messages[0].references).toEqual([{ kind: 'page', pageId: 'a', title: 'A' }, block, selection]);
  });
});

describe('stopping', () => {
  test('stop ends a sleeping turn, and the reply says "Stopped"', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'sleep');
    await fakeReady(s);
    await s.service.stop();
    const message = await doneOf(s, messageId);
    expect(message.error).toBe('Stopped');
    expect(s.children[0].exitCode).toBe(130);
    // Only a turn that ended well gives the chat a session to resume.
    expect((await readChat(s.root, chatId))?.sessionId).toBeNull();
    // The service is free again.
    const next = await sendOk(s, 'Add a paragraph', { chatId });
    await doneOf(s, next.messageId);
  });

  test('a turn that ignores SIGINT is ended by SIGTERM after the grace period', async () => {
    const s = await setup();
    const { messageId } = await sendOk(s, 'stubborn sleep');
    await fakeReady(s);
    const started = Date.now();
    await s.service.stop();
    const message = await doneOf(s, messageId);
    expect(Date.now() - started).toBeGreaterThanOrEqual(180);
    expect(s.children[0].signalCode).toBe('SIGTERM');
    expect(message.error).toBe('Stopped');
  });

  test('a stop that comes while the turn is still starting stops it once it runs', async () => {
    const s = await setup();
    const sending = s.service.send(request('sleep'));
    await s.service.stop();
    const result = await sending;
    if ('error' in result) throw new Error(result.error);
    expect((await doneOf(s, result.messageId)).error).toBe('Stopped');
    expect(s.children).toHaveLength(1);
    expect(running(s.children[0])).toBe(false);
  });

  test('a close that comes while the turn is still starting starts nothing', async () => {
    const s = await setup();
    const sending = s.service.send(request('sleep'));
    s.service.close();
    expect(await sending).toHaveProperty('error');
    await sleep(100);
    expect(s.children).toHaveLength(0);
    expect(s.events).toEqual([]);
  });

  test('close resolves once the record of the turn it cut short is in the chat file, and closing again gives the same promise', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'edit then sleep');
    await waitFor('the actions', () => actionEvents(s, messageId).length === 3);
    await s.session.settle();

    const closing = s.service.close();
    expect(s.service.close()).toBe(closing);
    await closing;
    // No waiting: the record is there as soon as close is done.
    const reply = (await readChat(s.root, chatId))?.messages[1];
    expect(reply).toMatchObject({ id: messageId, error: 'Stopped: the workspace was closed' });
    expect(reply?.changes?.map((c) => c.path)).toEqual(['Markets/A.json', 'Markets/A/drawing-x1.svg']);
  });

  test('close with no turn running resolves at once, and is the same promise each time', async () => {
    const s = await setup();
    const closing = s.service.close();
    expect(s.service.close()).toBe(closing);
    await closing;
    expect(s.service.running).toBe(false);
  });

  test('close mid-turn kills the child and keeps a record of the reply in its own chat, and nothing more is written or sent (Review Focus 2)', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'noisy sleep');
    await fakeReady(s);
    const chatFile = join(s.root, CHATS_DIR, `${chatId}.json`);
    const sent = s.events.length;

    s.service.close();
    await exited(s.children[0]);
    // The noisy fake printed a last reply as it went: it must be ignored.
    expect(s.children[0].exitCode).toBe(143);
    const recorded = await waitFor('the record of the closed turn', async () => {
      const chat = await readChat(s.root, chatId);
      return chat?.messages.length === 2 ? chat : undefined;
    });
    expect(recorded.messages[1]).toEqual({ id: messageId, role: 'assistant', text: '', created: expect.any(String), actions: [], error: 'Stopped: the workspace was closed' });
    expect(recorded.sessionId).toBeNull();
    const after = await readFile(chatFile, 'utf8');
    await sleep(300);

    expect(await readFile(chatFile, 'utf8')).toBe(after);
    expect(s.events.slice(sent)).toEqual([]);
    expect(s.events.some((e) => e.kind === 'done' && e.messageId === messageId)).toBe(false);
    expect(await s.service.send(request('Again', { chatId }))).toHaveProperty('error');
    await expect(s.service.undo(chatId, messageId, null, false)).rejects.toThrow();
    expect(s.children).toHaveLength(1);
  });
});

describe('status', () => {
  test('making a service looks for nothing and runs nothing: only status and send do', async () => {
    let looked = 0;
    const s = await setup({
      locate: async () => {
        looked++;
        return FAKE;
      },
    });
    await sleep(50);
    expect(looked).toBe(0);
    expect(s.children).toHaveLength(0);
    expect(await s.service.listChats()).toEqual([]);
    expect(looked).toBe(0);
    await s.service.status();
    expect(looked).toBe(1);
  });

  test('missing when claude is not found, and send says so', async () => {
    const s = await setup({ locate: async () => null });
    expect(await s.service.status()).toEqual({ state: 'missing' });
    const result = await s.service.send(request('Hi'));
    expect(result).toHaveProperty('error');
    expect(s.children).toHaveLength(0);
  });

  test('ready, with the version', async () => {
    const s = await setup();
    expect(await s.service.status()).toEqual({ state: 'ready', path: FAKE, version: '2.1.288 (Claude Code)' });
  });

  test('logged-out when auth status says so', async () => {
    const s = await setup();
    withEnv({ FAKE_LOGGED_OUT: '1' });
    expect(await s.service.status()).toMatchObject({ state: 'logged-out' });
  });

  test('an error when claude cannot be run', async () => {
    const s = await setup({ locate: async () => join(FIXTURES, 'no-such-claude') });
    const status = await s.service.status();
    expect(status.state).toBe('error');
    expect(status.message).toBeTruthy();
  });

  test('a failed login ends the turn with its error, and status follows auth status', async () => {
    const s = await setup();
    const { messageId } = await sendOk(s, 'fail auth');
    const message = await doneOf(s, messageId);
    expect(message.error).toBe('Failed to authenticate: OAuth session expired and could not be refreshed');

    // auth status can't be read: the last turn's logged-out stands.
    withEnv({ FAKE_AUTH_BROKEN: '1' });
    expect(await s.service.status()).toMatchObject({ state: 'logged-out' });
    // auth status says logged in: that clears it.
    withEnv({ FAKE_AUTH_BROKEN: undefined });
    expect(await s.service.status()).toMatchObject({ state: 'ready' });
    withEnv({ FAKE_AUTH_BROKEN: '1' });
    expect(await s.service.status()).toMatchObject({ state: 'ready' });
    withEnv({ FAKE_AUTH_BROKEN: undefined, FAKE_LOGGED_OUT: '1' });
    expect(await s.service.status()).toMatchObject({ state: 'logged-out' });
  });
});

describe('refusals and new spaces', () => {
  test('refused actions arrive again marked refused, and the reply marks every denial', async () => {
    const s = await setup();
    const { messageId } = await sendOk(s, 'Try to refuse these');
    const message = await doneOf(s, messageId);

    const live = ['toolu_01LoCENCcmhoC9RHHsBMyq27', 'toolu_012tiZcqnGrt5DutPowRKo4Y', 'toolu_011PvP1pN99ZvfmCCt8oGDqS'];
    const sent = actionEvents(s, messageId);
    expect(sent.filter((a) => a.refused).map((a) => a.id)).toEqual(live);
    for (const id of live) expect(sent.find((a) => a.id === id && !a.refused)).toBeTruthy();

    const denied = [...live, 'toolu_01PJkQHSxryFKttNhGwmoV9t'];
    expect(message.actions?.filter((a) => a.refused).map((a) => a.id).sort()).toEqual([...denied].sort());
    expect(message.actions?.find((a) => a.id === 'toolu_01PJkQHSxryFKttNhGwmoV9t')).toMatchObject({ verb: 'edited', path: '.quest/workspace.json', refused: true });
    expect(message.error).toBeUndefined();
    expect(message.changes).toBeUndefined();
  });

  test('a page in a space the turn made is flagged, and undoing it removes the space', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'make a new space');
    const message = await doneOf(s, messageId);
    expect(message.changes).toEqual([{ path: 'NewSpace/P.json', pageId: 'np000001', kind: 'created', drawing: false, newSpace: true, before: null, after: P_TEXT }]);

    expect(await s.service.undo(chatId, messageId, null, false)).toEqual({ undone: ['NewSpace/P.json'], conflicts: [] });
    expect(await exists(join(s.root, 'NewSpace'))).toBe(false);
    expect(await exists(join(s.root, 'Markets/A.json'))).toBe(true);
  });
});

describe('undo', () => {
  test('restores the page byte for byte, and records what was undone', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'Add a paragraph');
    await doneOf(s, messageId);

    expect(await s.service.undo(chatId, messageId, ['Markets/A.json'], false)).toEqual({ undone: ['Markets/A.json'], conflicts: [] });
    expect(await readFile(join(s.root, 'Markets/A.json'), 'utf8')).toBe(A_TEXT);
    expect(await exists(join(s.root, 'Markets/A/drawing-x1.svg'))).toBe(true);
    expect((await readChat(s.root, chatId))?.messages[1].undone).toEqual(['Markets/A.json']);

    // Undo all: only what is left.
    expect(await s.service.undo(chatId, messageId, null, false)).toEqual({ undone: ['Markets/A/drawing-x1.svg'], conflicts: [] });
    expect(await exists(join(s.root, 'Markets/A'))).toBe(false);
    expect((await readChat(s.root, chatId))?.messages[1].undone).toEqual(['Markets/A.json', 'Markets/A/drawing-x1.svg']);
    expect(await s.service.undo(chatId, messageId, null, false)).toEqual({ undone: [], conflicts: [] });
  });

  test('a page changed since the reply is a conflict unless forced', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'Add a paragraph');
    await doneOf(s, messageId);
    await writeFile(join(s.root, 'Markets/A.json'), 'edited since');
    expect(await s.service.undo(chatId, messageId, ['Markets/A.json'], false)).toEqual({ undone: [], conflicts: ['Markets/A.json'] });
    expect(await s.service.undo(chatId, messageId, ['Markets/A.json'], true)).toEqual({ undone: ['Markets/A.json'], conflicts: [] });
    expect(await readFile(join(s.root, 'Markets/A.json'), 'utf8')).toBe(A_TEXT);
  });

  test('is refused while a turn runs', async () => {
    const s = await setup();
    const first = await sendOk(s, 'Add a paragraph');
    await doneOf(s, first.messageId);
    const second = await sendOk(s, 'sleep', { chatId: first.chatId });
    await expect(s.service.undo(first.chatId, first.messageId, null, false)).rejects.toThrow(/still answering/);
    expect(await readFile(join(s.root, 'Markets/A.json'), 'utf8')).toBe(A_AFTER);
    await fakeReady(s);
    await s.service.stop();
    await doneOf(s, second.messageId);
  });

  test('ignores paths that are not among the reply changes', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'Add a paragraph');
    await doneOf(s, messageId);
    expect(await s.service.undo(chatId, messageId, ['README.md', '../x.json', 'Markets/B.json'], true)).toEqual({ undone: [], conflicts: [] });
    expect(await readFile(join(s.root, 'Markets/A.json'), 'utf8')).toBe(A_AFTER);
    expect(await readFile(join(s.root, 'README.md'), 'utf8')).toBe('readme\n');
  });

  test('never touches anything but page and drawing files in a space, whatever the chat file says', async () => {
    const s = await setup();
    await mkdir(join(s.root, '.quest'), { recursive: true });
    await writeFile(join(s.root, '.quest/workspace.json'), 'config');
    await writeFile(join(s.root, 'Top.json'), 'top');
    await writeFile(join(s.root, 'Markets/notes.txt'), 'notes');
    const change = (path: string, after: string) => ({ path, kind: 'edited' as const, drawing: false, before: 'EVIL', after });
    await writeChat(s.root, {
      id: 'handmade',
      title: 'Hand-made',
      sessionId: null,
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          text: '',
          created: '2026-01-01T00:00:00.000Z',
          changes: [
            change('.quest/workspace.json', 'config'),
            change('README.md', 'readme\n'),
            change('Top.json', 'top'),
            change('Markets/notes.txt', 'notes'),
            change('Markets/../README.md', 'readme\n'),
            change('Markets/.hidden/x.json', 'x'),
            change('Markets/drawing-x.png', 'x'),
          ],
        },
      ],
    });
    expect(await s.service.undo('handmade', 'm1', null, true)).toEqual({ undone: [], conflicts: [] });
    expect(await readFile(join(s.root, '.quest/workspace.json'), 'utf8')).toBe('config');
    expect(await readFile(join(s.root, 'README.md'), 'utf8')).toBe('readme\n');
    expect(await readFile(join(s.root, 'Top.json'), 'utf8')).toBe('top');
    expect(await readFile(join(s.root, 'Markets/notes.txt'), 'utf8')).toBe('notes');
    expect(await exists(join(s.root, 'Markets/.hidden'))).toBe(false);
  });

  test('a message that is not there is an error', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'Add a paragraph');
    await doneOf(s, messageId);
    await expect(s.service.undo(chatId, 'nope', null, false)).rejects.toThrow();
    await expect(s.service.undo('zzzzzzzz', messageId, null, false)).rejects.toThrow();
  });
});

describe('chats', () => {
  test('list, read and delete pass through, and the chat a turn runs in cannot be deleted', async () => {
    const s = await setup();
    const first = await sendOk(s, 'Add a paragraph');
    await doneOf(s, first.messageId);
    expect((await s.service.listChats()).map((c) => c.id)).toEqual([first.chatId]);
    expect((await s.service.readChat(first.chatId))?.messages).toHaveLength(2);

    const second = await sendOk(s, 'sleep');
    await expect(s.service.deleteChat(second.chatId)).rejects.toThrow();
    await s.service.deleteChat(first.chatId);
    expect(await s.service.readChat(first.chatId)).toBeNull();
    await fakeReady(s);
    await s.service.stop();
    await doneOf(s, second.messageId);
    await s.service.deleteChat(second.chatId);
    expect(await s.service.listChats()).toEqual([]);
  });
});

test('a claude that cannot be started ends the turn with an error, and the next send still works', async () => {
  const s = await setup({ locate: async () => join(FIXTURES, 'no-such-claude') });
  const first = await s.service.send(request('Hi'));
  if ('error' in first) throw new Error(first.error);
  const message = await doneOf(s, first.messageId);
  expect(message.error).toMatch(/^Claude stopped unexpectedly/);
  const second = await s.service.send(request('Again', { chatId: first.chatId }));
  if ('error' in second) throw new Error(second.error);
  await doneOf(s, second.messageId);
  expect((await readChat(s.root, first.chatId))?.messages).toHaveLength(4);
});

describe('request checks', () => {
  const good = { chatId: null, message: 'Hi', references: [{ kind: 'page', pageId: 'a', title: 'A' }, { kind: 'selection', pageId: 'a', title: 'A', text: 'x' }], openPageId: 'a' };

  test('a good send request passes, with only the known fields', () => {
    expect(parseSendRequest(good)).toEqual(good);
    expect(parseSendRequest({ ...good, chatId: 'abcdefgh', openPageId: null, extra: 1 })).toEqual({ ...good, chatId: 'abcdefgh', openPageId: null });
    expect(parseSendRequest({ ...good, references: [{ kind: 'page', pageId: 'a', title: 'A', text: 'dropped' }] })).toEqual({ ...good, references: [{ kind: 'page', pageId: 'a', title: 'A' }] });
  });

  test('bad send requests are refused', () => {
    for (const bad of [
      null,
      'Hi',
      { ...good, message: '' },
      { ...good, message: '   ' },
      { ...good, message: 5 },
      { ...good, chatId: 5 },
      { ...good, openPageId: 5 },
      { ...good, references: 'a' },
      { ...good, references: [{ kind: 'page', pageId: 1, title: 'A' }] },
      { ...good, references: [{ kind: 'selection', pageId: 'a', title: 'A' }] },
      { ...good, references: [{ kind: 'link', pageId: 'a', title: 'A' }] },
      { ...good, references: [null] },
      { ...good, references: [{ kind: 'block', pageId: 'a', title: 'A', text: '{}' }] },
      { ...good, images: null },
      { ...good, images: 'x' },
      { ...good, images: [{ type: 'image/png' }] },
      { ...good, images: [{ type: 'image/png', data: 'not base64!' }] },
      { ...good, message: '', images: [] },
      { ...good, message: '  ', images: undefined },
      { ...good, message: 5, images: [testImage('image/png')] },
    ]) {
      expect(parseSendRequest(bad)).toEqual({ error: 'Bad request' });
    }
    // Length is the service's to refuse, with its own message.
    expect(parseSendRequest({ ...good, message: 'x'.repeat(100_001) })).not.toHaveProperty('error');
  });

  test('a block reference passes with its own fields', () => {
    const block = { kind: 'block', pageId: 'a', title: 'A', text: '{ "type": "paragraph" }', where: 'block 2 of 3' };
    expect(parseSendRequest({ ...good, references: [{ ...block, extra: 1 }] })).toEqual({ ...good, references: [block] });
  });

  test('images pass, checked, and a message may then be blank', () => {
    const images = [testImage('image/png'), testImage('image/webp')];
    expect(parseSendRequest({ ...good, images })).toEqual({ ...good, images });
    expect(parseSendRequest({ ...good, images: [] })).toEqual(good);
    expect(parseSendRequest({ ...good, images: undefined })).toEqual(good);
    expect(parseSendRequest({ ...good, message: '', images })).toEqual({ ...good, message: '', images });
    expect(parseSendRequest({ ...good, message: ' \n ', images: [images[0]] })).toEqual({ ...good, message: ' \n ', images: [images[0]] });
  });

  test('images that cannot be sent are refused with why', () => {
    expect(parseSendRequest({ ...good, images: Array.from({ length: 11 }, () => testImage('image/png')) })).toEqual({ error: 'At most 10 images per message' });
    expect(parseSendRequest({ ...good, images: [testImage('image/png', 5 * 1024 * 1024 + 1)] })).toEqual({ error: 'Each image must be under 5 MB' });
    expect(parseSendRequest({ ...good, images: [{ type: 'image/svg+xml', data: testImage('image/png').data }] })).toEqual({ error: 'Only PNG, JPEG, GIF and WebP images can be sent' });
    expect(parseSendRequest({ ...good, images: [{ type: 'image/png', data: testImage('image/jpeg').data }] })).toEqual({ error: 'Only PNG, JPEG, GIF and WebP images can be sent' });
  });

  test('undo arguments', () => {
    expect(parseUndoArgs(['c', 'm', null, false])).toEqual({ chatId: 'c', messageId: 'm', paths: null, force: false });
    expect(parseUndoArgs(['c', 'm', ['a', 'b'], true])).toEqual({ chatId: 'c', messageId: 'm', paths: ['a', 'b'], force: true });
    for (const bad of [[1, 'm', null, false], ['c', null, null, false], ['c', 'm', 'a', false], ['c', 'm', [1], false], ['c', 'm', null, 'yes'], ['c', 'm', undefined, false]]) {
      expect(parseUndoArgs(bad)).toBeNull();
    }
  });
});

describe('session ids', () => {
  test('a session id that is not a UUID is never kept, so it never reaches the command line', async () => {
    const s = await setup();
    const first = await sendOk(s, 'odd session');
    const message = await doneOf(s, first.messageId);
    expect(message.error).toBeUndefined();
    expect((await readChat(s.root, first.chatId))?.sessionId).toBeNull();
    const second = await sendOk(s, 'Add a paragraph', { chatId: first.chatId });
    await doneOf(s, second.messageId);
    expect((await fakeLog(s)).argv).not.toContain('--resume');
  });

  test('a failed turn leaves the chat session as it was', async () => {
    const s = await setup();
    const first = await sendOk(s, 'fail auth');
    await doneOf(s, first.messageId);
    expect((await readChat(s.root, first.chatId))?.sessionId).toBeNull();

    const second = await sendOk(s, 'Add a paragraph', { chatId: first.chatId });
    await doneOf(s, second.messageId);
    expect((await readChat(s.root, first.chatId))?.sessionId).toBe(SESSION_ID);
    const third = await sendOk(s, 'fail auth', { chatId: first.chatId });
    await doneOf(s, third.messageId);
    expect((await readChat(s.root, first.chatId))?.sessionId).toBe(SESSION_ID);
  });

  test('a resumed session the CLI no longer has is dropped, so the next message starts fresh', async () => {
    const s = await setup();
    const first = await sendOk(s, 'Add a paragraph');
    await doneOf(s, first.messageId);
    const lost = await sendOk(s, 'lost session', { chatId: first.chatId });
    const message = await doneOf(s, lost.messageId);
    expect(message.error).toMatch(/No conversation found/);
    expect((await readChat(s.root, first.chatId))?.sessionId).toBeNull();

    const next = await sendOk(s, 'Add a paragraph', { chatId: first.chatId });
    await doneOf(s, next.messageId);
    expect((await fakeLog(s)).argv).not.toContain('--resume');
    expect((await readChat(s.root, first.chatId))?.sessionId).toBe(SESSION_ID);
  });
});

describe('turns that would not end', () => {
  test('a turn ends when claude exits, even if something it started keeps its output open', async () => {
    const s = await setup();
    const started = Date.now();
    const { messageId } = await sendOk(s, 'linger');
    const message = await doneOf(s, messageId);
    const { grandchild } = JSON.parse(await readFile(s.log, 'utf8')) as { grandchild: number };
    s.strays.push(grandchild);
    // The grandchild holds the output for 5 s; the turn ends about exitGraceMs after claude itself exits.
    expect(Date.now() - started).toBeLessThan(3000);
    expect(message).toMatchObject({ text: 'Still here.' });
    expect(message.error).toBeUndefined();
  });

  test('stop goes on to SIGKILL when SIGINT and SIGTERM are ignored', async () => {
    const s = await setup();
    const { messageId } = await sendOk(s, 'deaf sleep');
    await fakeReady(s);
    const started = Date.now();
    await s.service.stop();
    const message = await doneOf(s, messageId);
    expect(Date.now() - started).toBeGreaterThanOrEqual(380);
    expect(s.children[0].signalCode).toBe('SIGKILL');
    expect(message.error).toBe('Stopped');
  });

  test('a second stop kills at once', async () => {
    const s = await setup({ stopGraceMs: 5000 });
    const { messageId } = await sendOk(s, 'deaf sleep');
    await fakeReady(s);
    const started = Date.now();
    await s.service.stop();
    await s.service.stop();
    const message = await doneOf(s, messageId);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(s.children[0].signalCode).toBe('SIGKILL');
    expect(message.error).toBe('Stopped');
  });

  test('close kills a child that ignores SIGTERM', async () => {
    const s = await setup();
    await sendOk(s, 'deaf sleep');
    await fakeReady(s);
    s.service.close();
    await exited(s.children[0]);
    expect(s.children[0].signalCode).toBe('SIGKILL');
  });
});

test('text from separate blocks is kept apart', async () => {
  const s = await setup();
  const { messageId } = await sendOk(s, 'two parts');
  const message = await doneOf(s, messageId);
  expect(message.text).toBe("I'll read the page.\n\nDone.");
  expect(s.events.flatMap((e) => (e.kind === 'text' ? [e.text] : []))).toEqual(["I'll read the page.", '\n\n', 'Done.']);
});

test('a claude that went away is looked for again', async () => {
  let where = join(FIXTURES, 'no-such-claude');
  let looked = 0;
  const s = await setup({
    locate: async () => {
      looked++;
      return where;
    },
  });
  const first = await sendOk(s, 'Hi');
  expect((await doneOf(s, first.messageId)).error).toMatch(/^Claude stopped unexpectedly/);
  expect(looked).toBe(1);
  where = FAKE;
  const second = await sendOk(s, 'Add a paragraph');
  expect((await doneOf(s, second.messageId)).error).toBeUndefined();
  expect(looked).toBe(2);
});

describe("only Claude's own changes", () => {
  test('a page another app changes during the turn is not in the reply', async () => {
    const s = await setup();
    const { messageId } = await sendOk(s, 'Add a paragraph while others write');
    const message = await doneOf(s, messageId);
    expect(message.changes?.map((c) => c.path)).toEqual(['Markets/A.json', 'Markets/A/drawing-x1.svg']);
    expect(await readFile(join(s.root, 'Markets/B.json'), 'utf8')).toMatch(/Written by another app/);
  });

  test('a sub-page in a new folder brings the page the app made for that folder, and undo leaves nothing behind', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'Make a sub page');
    const message = await doneOf(s, messageId);
    expect(message.changes?.map(({ path, kind, drawing }) => ({ path, kind, drawing }))).toEqual([
      { path: 'Markets/Folder.json', kind: 'created', drawing: false },
      { path: 'Markets/Folder/X.json', kind: 'created', drawing: false },
    ]);
    // The app made Markets/Folder.json itself, so Claude has no action for it.
    expect(message.actions?.map(withoutId)).toEqual([{ verb: 'created', path: 'Markets/Folder/X.json' }]);

    expect(await s.service.undo(chatId, messageId, null, false)).toEqual({ undone: ['Markets/Folder.json', 'Markets/Folder/X.json'], conflicts: [] });
    expect((await readdir(join(s.root, 'Markets'))).sort()).toEqual(['A.json', 'B.json']);
    // The next look at the folder finds nothing to put back.
    await s.session.settle();
    expect((await readdir(join(s.root, 'Markets'))).sort()).toEqual(['A.json', 'B.json']);
  });

  test('the page the app made for a folder another app created is not recorded', async () => {
    const s = await setup();
    const { messageId } = await sendOk(s, 'Add a paragraph while others folder');
    const message = await doneOf(s, messageId);
    expect(message.changes?.map((c) => c.path)).toEqual(['Markets/A.json', 'Markets/A/drawing-x1.svg']);
    expect(await exists(join(s.root, 'Markets/Other.json'))).toBe(true);
  });

  test('a save planned before an undo is refused as stale, and the restored text stays', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'Add a paragraph');
    await doneOf(s, messageId);
    const seenSeq = s.deltas[s.deltas.length - 1]?.seq ?? 0;

    // Hold the undo in the queue once its work is done, and queue the window's save behind it.
    const exclusive = s.session.exclusive.bind(s.session);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let queued!: () => void;
    const isQueued = new Promise<void>((r) => (queued = r));
    s.session.exclusive = ((work, opts) => {
      const held = exclusive(async () => {
        const out = await work();
        await gate;
        return out;
      }, opts);
      queued();
      return held;
    }) as typeof s.session.exclusive;

    const undoing = s.service.undo(chatId, messageId, ['Markets/A.json'], false);
    await isQueued;
    const markets = s.session.snapshot.spaces.find((sp) => sp.name === 'Markets')!;
    const flushing = s.session.flush({
      spaces: s.session.snapshot.spaces,
      createdSpaces: [],
      deletedSpaces: [],
      journalSpaceId: null,
      deletes: [],
      seenSeq,
      saves: [{ id: 'a', spaceId: markets.id, parentId: null, title: 'A', json: A_AFTER, sidecars: {} }],
    });
    release();
    expect(await undoing).toEqual({ undone: ['Markets/A.json'], conflicts: [] });
    expect((await flushing).stale).toEqual(['a']);
    expect(await readFile(join(s.root, 'Markets/A.json'), 'utf8')).toBe(A_TEXT);
  });

  test('close mid-turn keeps what Claude changed so far, and it can be undone after reopening', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'edit then sleep');
    await waitFor('the actions', () => actionEvents(s, messageId).length === 3);
    // What the watcher would report: read the folder now, so the turn has seen the writes.
    await s.session.settle();
    const sent = s.events.length;
    s.service.close();
    await exited(s.children[0]);

    const chat = await waitFor('the record of the closed turn', async () => {
      const c = await readChat(s.root, chatId);
      return c?.messages.length === 2 ? c : undefined;
    });
    const reply = chat.messages[1];
    expect(reply).toMatchObject({ id: messageId, text: resultText('read-and-edit.jsonl'), error: 'Stopped: the workspace was closed' });
    expect(reply.actions?.map(withoutId)).toEqual([
      { verb: 'read', path: 'Markets/A.json' },
      { verb: 'edited', path: 'Markets/A.json' },
      { verb: 'created', path: 'Markets/A/drawing-x1.svg' },
    ]);
    expect(reply.changes?.map((c) => c.path)).toEqual(['Markets/A.json', 'Markets/A/drawing-x1.svg']);
    expect(s.events.slice(sent)).toEqual([]);

    const again = await reopen(s);
    expect(await again.undo(chatId, messageId, null, false)).toEqual({ undone: ['Markets/A.json', 'Markets/A/drawing-x1.svg'], conflicts: [] });
    expect(await readFile(join(s.root, 'Markets/A.json'), 'utf8')).toBe(A_TEXT);
    expect(await exists(join(s.root, 'Markets/A'))).toBe(false);
  });
});

describe("the app's own tidy-up of a page Claude wrote", () => {
  /** A save from the window, as sync sends it: named in `repairs` when it only fills in or tidies the page, not for an edit. */
  function save(s: Setup, page: { id: string; title: string; json: string; sidecars?: Record<string, string> }, opts: { repair: boolean }) {
    const markets = s.session.snapshot.spaces.find((sp) => sp.name === 'Markets')!;
    return s.session.flush({
      spaces: s.session.snapshot.spaces,
      createdSpaces: [],
      deletedSpaces: [],
      journalSpaceId: null,
      deletes: [],
      saves: [{ id: page.id, spaceId: markets.id, parentId: null, title: page.title, json: page.json, sidecars: page.sidecars ?? {} }],
      ...(opts.repair ? { repairs: [page.id] } : {}),
    });
  }

  const textOf = (s: Setup, path: string) => readFile(join(s.root, path), 'utf8').catch(() => null);

  /** A turn whose prompt says "hold" finishes when this is called. */
  function holding(s: Setup): () => Promise<void> {
    const go = `${s.log}.go`;
    withEnv({ FAKE_GO: go });
    return () => writeFile(go, '');
  }

  /** The turn has written `path` and seen it, as the watcher would report it. */
  async function written(s: Setup, path: string, text: string): Promise<void> {
    await waitFor(`${path} to be written`, async () => (await textOf(s, path)) === text);
    await s.session.settle();
  }

  const chatChanges = async (s: Setup, chatId: string) => (await readChat(s.root, chatId))?.messages[1].changes;

  test('a page tidied during the turn is recorded as tidied, and undo trashes it with no conflict', async () => {
    const s = await setup();
    const go = holding(s);
    const { chatId, messageId } = await sendOk(s, 'Make a page with no position, and hold');
    await written(s, 'Markets/R.json', R_TEXT);
    expect((await save(s, { id: 'rng00001', title: 'R', json: R_TIDIED }, { repair: true })).ok).toBe(true);
    await go();

    const message = await doneOf(s, messageId);
    expect(message.changes).toEqual([{ path: 'Markets/R.json', pageId: 'rng00001', kind: 'created', drawing: false, before: null, after: R_TIDIED }]);
    expect(await s.service.undo(chatId, messageId, null, false)).toEqual({ undone: ['Markets/R.json'], conflicts: [] });
    expect(await exists(join(s.root, 'Markets/R.json'))).toBe(false);
  });

  test('a page tidied after the reply is done: the chat file follows, and undo has no conflict', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'Make a page with no position');
    const message = await doneOf(s, messageId);
    expect(message.changes).toEqual([{ path: 'Markets/R.json', pageId: 'rng00001', kind: 'created', drawing: false, before: null, after: R_TEXT }]);

    expect((await save(s, { id: 'rng00001', title: 'R', json: R_TIDIED }, { repair: true })).ok).toBe(true);
    await waitFor('the chat to follow the tidy-up', async () => (await chatChanges(s, chatId))?.[0].after === R_TIDIED);
    expect(await s.service.undo(chatId, messageId, null, false)).toEqual({ undone: ['Markets/R.json'], conflicts: [] });
    expect(await exists(join(s.root, 'Markets/R.json'))).toBe(false);
  });

  test('an edit by the owner is not a tidy-up: undo still asks', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'Make a page with no position');
    await doneOf(s, messageId);

    expect((await save(s, { id: 'rng00001', title: 'R', json: R_TIDIED }, { repair: false })).ok).toBe(true);
    expect(await s.service.undo(chatId, messageId, null, false)).toEqual({ undone: [], conflicts: ['Markets/R.json'] });
    expect((await chatChanges(s, chatId))?.[0].after).toBe(R_TEXT);
    expect(await textOf(s, 'Markets/R.json')).toBe(R_TIDIED);
  });

  test('a tidy-up of what the owner changed since is not moved into the reply', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'Make a page with no position');
    await doneOf(s, messageId);

    const owner = R_TEXT.replace('"blocks": []', '"blocks": [{ "type": "paragraph", "text": "mine" }]');
    await save(s, { id: 'rng00001', title: 'R', json: owner }, { repair: false });
    await save(s, { id: 'rng00001', title: 'R', json: R_TIDIED }, { repair: true });
    expect(await s.service.undo(chatId, messageId, null, false)).toEqual({ undone: [], conflicts: ['Markets/R.json'] });
  });

  test('inline strokes moved to a drawing file during the turn: undo restores the page byte for byte and trashes the drawing', async () => {
    const s = await setup();
    const go = holding(s);
    const { chatId, messageId } = await sendOk(s, 'Draw with inline strokes, and hold');
    await written(s, 'Markets/A.json', A_INLINE);
    expect((await save(s, { id: 'a', title: 'A', json: A_TIDIED, sidecars: { 'drawing-d1.svg': D1_SVG } }, { repair: true })).ok).toBe(true);
    expect(await textOf(s, 'Markets/A/drawing-d1.svg')).toBe(D1_SVG);
    await go();

    const message = await doneOf(s, messageId);
    expect(message.changes).toEqual([
      { path: 'Markets/A.json', pageId: 'a', kind: 'edited', drawing: false, before: A_TEXT, after: A_TIDIED },
      { path: 'Markets/A/drawing-d1.svg', pageId: 'a', kind: 'created', drawing: true, before: null, after: D1_SVG },
    ]);
    expect(await s.service.undo(chatId, messageId, null, false)).toEqual({ undone: ['Markets/A.json', 'Markets/A/drawing-d1.svg'], conflicts: [] });
    expect(await textOf(s, 'Markets/A.json')).toBe(A_TEXT);
    expect(await exists(join(s.root, 'Markets/A'))).toBe(false);
  });

  test('inline strokes moved to a drawing file after the reply is done: undo restores the page and trashes the drawing', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'Draw with inline strokes');
    expect((await doneOf(s, messageId)).changes).toEqual([{ path: 'Markets/A.json', pageId: 'a', kind: 'edited', drawing: false, before: A_TEXT, after: A_INLINE }]);

    await save(s, { id: 'a', title: 'A', json: A_TIDIED, sidecars: { 'drawing-d1.svg': D1_SVG } }, { repair: true });
    await waitFor('the chat to follow the tidy-up', async () => (await chatChanges(s, chatId))?.length === 2);
    expect(await chatChanges(s, chatId)).toEqual([
      { path: 'Markets/A.json', pageId: 'a', kind: 'edited', drawing: false, before: A_TEXT, after: A_TIDIED },
      { path: 'Markets/A/drawing-d1.svg', pageId: 'a', kind: 'created', drawing: true, before: null, after: D1_SVG },
    ]);
    expect(await s.service.undo(chatId, messageId, null, false)).toEqual({ undone: ['Markets/A.json', 'Markets/A/drawing-d1.svg'], conflicts: [] });
    expect(await textOf(s, 'Markets/A.json')).toBe(A_TEXT);
    expect(await exists(join(s.root, 'Markets/A'))).toBe(false);
  });

  test('a tidy-up while a later turn runs in the same chat reaches the earlier reply once the turn ends, and the later reply is kept', async () => {
    const s = await setup();
    const first = await sendOk(s, 'Make a page with no position');
    await doneOf(s, first.messageId);

    const second = await sendOk(s, 'sleep', { chatId: first.chatId });
    await fakeReady(s);
    await save(s, { id: 'rng00001', title: 'R', json: R_TIDIED }, { repair: true });
    await s.service.stop();
    await doneOf(s, second.messageId);

    await waitFor('the chat to follow the tidy-up', async () => (await chatChanges(s, first.chatId))?.[0].after === R_TIDIED);
    expect((await readChat(s.root, first.chatId))?.messages.map((m) => m.id)).toEqual([expect.any(String), first.messageId, expect.any(String), second.messageId]);
    expect(await s.service.undo(first.chatId, first.messageId, null, false)).toEqual({ undone: ['Markets/R.json'], conflicts: [] });
  });

  test('a path already undone is left as it is', async () => {
    const s = await setup();
    const { chatId, messageId } = await sendOk(s, 'Make a page with no position');
    await doneOf(s, messageId);
    expect(await s.service.undo(chatId, messageId, null, false)).toEqual({ undone: ['Markets/R.json'], conflicts: [] });
    const before = await readFile(join(s.root, CHATS_DIR, `${chatId}.json`), 'utf8');

    // The page comes back as Claude left it (from another app, say), and the window tidies it.
    await writeFile(join(s.root, 'Markets/R.json'), R_TEXT);
    await s.session.settle();
    await save(s, { id: 'rng00001', title: 'R', json: R_TIDIED }, { repair: true });
    await s.service.undo(chatId, messageId, null, false);
    expect(await readFile(join(s.root, CHATS_DIR, `${chatId}.json`), 'utf8')).toBe(before);
  });
});
