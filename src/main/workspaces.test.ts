import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { ClaudeEvent, SendRequest } from '@shared/ipc';
import { readChat } from './claude/chats';
import { Workspaces } from './workspaces';

const FAKE = join(__dirname, 'claude/__fixtures__/fake-claude.mjs');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exists = (abs: string) => stat(abs).then(() => true, () => false);
const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

async function waitFor<T>(what: string, check: () => T | undefined | null | false | Promise<T | undefined | null | false>): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > 10_000) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
}

const exited = async (child: ChildProcess) => {
  if (running(child)) await new Promise((resolve) => child.once('exit', resolve));
};

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const parent = await mkdtemp(join(tmpdir(), 'quest-workspaces-'));
  const folder = async (name: string) => {
    const root = join(parent, name);
    await mkdir(join(root, 'Markets'), { recursive: true });
    await writeFile(join(root, 'Markets/A.json'), '{"id":"a","title":"A","position":0,"blocks":[]}\n');
    return root;
  };
  const first = await folder('first');
  const second = await folder('second');
  const log = join(parent, 'fake-log.json');
  const savedLog = process.env.FAKE_LOG;
  process.env.FAKE_LOG = log;

  const events: ClaudeEvent[] = [];
  const children: ChildProcess[] = [];
  const spawnFake = ((command: string, args: readonly string[], options: SpawnOptions) => {
    const child = spawn(process.execPath, [command, ...args], options);
    children.push(child);
    return child;
  }) as unknown as typeof spawn;
  const workspaces = new Workspaces(
    join(parent, 'registry.json'),
    {
      flushWindow: async () => {},
      diskChanged: () => {},
      lost: () => {},
      opened: () => {},
      trash: (abs) => rm(abs, { recursive: true }),
      confirmAdopt: async () => true,
      claudeEvent: (e) => events.push(e),
    },
    { locate: async () => FAKE, spawn: spawnFake, stopGraceMs: 200 },
  );
  cleanups.push(async () => {
    workspaces.close();
    for (const child of children) {
      if (running(child)) child.kill('SIGKILL');
      await exited(child);
    }
    if (savedLog === undefined) delete process.env.FAKE_LOG;
    else process.env.FAKE_LOG = savedLog;
    await rm(parent, { recursive: true, force: true });
  });
  return { first, second, log, workspaces, events, children };
}

const request = (message: string): SendRequest => ({ chatId: null, message, references: [], openPageId: null });

async function startSleeping(s: Awaited<ReturnType<typeof setup>>, message = 'noisy sleep') {
  expect((await s.workspaces.open(s.first)).ok).toBe(true);
  const service = s.workspaces.claude;
  if (!service) throw new Error('no claude service');
  const result = await service.send(request(message));
  if ('error' in result) throw new Error(result.error);
  await waitFor('the fake to start', () => exists(s.log));
  return { service, ...result };
}

test('each open workspace has its own claude service, and none without a workspace', async () => {
  const s = await setup();
  expect(s.workspaces.claude).toBeNull();
  await s.workspaces.open(s.first);
  const first = s.workspaces.claude;
  expect(first).not.toBeNull();
  await s.workspaces.open(s.second);
  expect(s.workspaces.claude).not.toBeNull();
  expect(s.workspaces.claude).not.toBe(first);
  expect(await first?.send(request('Hi'))).toHaveProperty('error');
  s.workspaces.close();
  expect(s.workspaces.claude).toBeNull();
});

test('switching workspace mid-turn stops claude, records the reply in the old workspace only, and sends nothing more (Review Focus 2)', async () => {
  const s = await setup();
  const { chatId, messageId } = await startSleeping(s);
  const chatFile = join(s.first, '.quest/chats', `${chatId}.json`);
  const sent = s.events.length;

  expect((await s.workspaces.open(s.second)).ok).toBe(true);
  await exited(s.children[0]);
  const old = await waitFor('the record in the old workspace', async () => {
    const chat = await readChat(s.first, chatId);
    return chat?.messages.length === 2 ? chat : undefined;
  });
  expect(old.messages[1]).toMatchObject({ id: messageId, role: 'assistant', error: 'Stopped: the workspace was closed' });
  const before = await readFile(chatFile, 'utf8');
  await sleep(300);

  expect(await readFile(chatFile, 'utf8')).toBe(before);
  expect(await exists(join(s.second, '.quest/chats'))).toBe(false);
  expect(s.events.slice(sent)).toEqual([]);
  expect(s.events.some((e) => e.kind === 'done' && e.messageId === messageId)).toBe(false);
  // The new workspace's service is free to start a turn of its own.
  const next = await s.workspaces.claude?.send(request('Add a paragraph'));
  if (!next || 'error' in next) throw new Error('the second workspace could not start a turn');
  await waitFor('the second turn', () => s.events.find((e) => e.kind === 'done' && e.messageId === next.messageId));
  expect(await exists(join(s.second, '.quest/chats', `${next.chatId}.json`))).toBe(true);
  expect(await readFile(chatFile, 'utf8')).toBe(before);
});

test('closing the window stops the turn, which ends as Stopped', async () => {
  const s = await setup();
  const { messageId } = await startSleeping(s, 'sleep');
  s.workspaces.stopClaude();
  const done = await waitFor('the done event', () => s.events.find((e) => e.kind === 'done' && e.messageId === messageId));
  expect(done.kind === 'done' && done.message.error).toBe('Stopped');
  expect(s.children[0].exitCode).toBe(130);
});

test('closing the app mid-turn kills claude without reporting anything, and closing again is harmless', async () => {
  const s = await setup();
  const { messageId } = await startSleeping(s);
  s.workspaces.close();
  s.workspaces.close();
  await exited(s.children[0]);
  await sleep(300);
  expect(s.events.some((e) => e.kind === 'done' && e.messageId === messageId)).toBe(false);
  expect(s.workspaces.claude).toBeNull();
  expect(s.workspaces.session).toBeNull();
  s.workspaces.close();
});

test("the window's tidy-up of a page Claude wrote reaches the open workspace's claude, so undo has no conflict", async () => {
  const s = await setup();
  expect((await s.workspaces.open(s.first)).ok).toBe(true);
  const service = s.workspaces.claude!;
  const session = s.workspaces.session!;
  const sent = await service.send(request('Make a page with no position'));
  if ('error' in sent) throw new Error(sent.error);
  await waitFor('the reply', () => s.events.find((e) => e.kind === 'done' && e.messageId === sent.messageId));

  const markets = session.snapshot.spaces.find((sp) => sp.name === 'Markets')!;
  const tidied = '{\n  "id": "rng00001",\n  "title": "R",\n  "position": 1,\n  "blocks": []\n}\n';
  const saves = [{ id: 'rng00001', spaceId: markets.id, parentId: null, title: 'R', json: tidied, sidecars: {} }];
  expect((await session.flush({ spaces: session.snapshot.spaces, createdSpaces: [], deletedSpaces: [], journalSpaceId: null, deletes: [], saves, repairs: ['rng00001'] })).ok).toBe(true);
  expect(await service.undo(sent.chatId, sent.messageId, null, false)).toEqual({ undone: ['Markets/R.json'], conflicts: [] });
  expect(await exists(join(s.first, 'Markets/R.json'))).toBe(false);
});
