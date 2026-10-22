// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import type { Chat, ChatMessage, ChatSummary, ClaudeEvent, ClaudeStatus, FileChange, QuestApi, UndoResult } from '@shared/ipc';
import { useStore } from '../store';
import type { Notebook } from '../types';
import { bindClaude, readPanel, useClaude, writePanel } from './store';

type Api = QuestApi['claude'];

const chatOf = (id: string, messages: ChatMessage[] = []): Chat => ({ id, title: 't', sessionId: null, created: 'c', updated: 'u', messages });
const reply = (id: string, text = 'hi'): ChatMessage => ({ id, role: 'assistant', text, created: 'c' });
const summary = (id: string): ChatSummary => ({ id, title: id, updated: 'u' });
const page = (id: string, title: string): Notebook => ({ id, title, spaceId: 's', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [], items: {} });
const change = (path: string, pageId: string): FileChange => ({ path, pageId, kind: 'edited', drawing: path.endsWith('.svg'), before: '{}', after: '{}' });
/** A promise and the function that settles it. */
function later<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  return { promise: new Promise<T>((r) => (resolve = r)), resolve };
}

let handler: (e: ClaudeEvent) => void;
let api: { [K in keyof Api]: ReturnType<typeof vi.fn> };
let flush: ReturnType<typeof vi.fn>;
let confirm: ReturnType<typeof vi.fn>;

const initial = useClaude.getState();

beforeEach(() => {
  localStorage.clear();
  useClaude.setState({ ...initial, open: false, width: 400, status: null, chats: [], chat: null, running: null, sending: false, streaming: { text: [], actions: [] }, notApplied: {}, attachments: [], skipOpenPage: false, error: null }, true);
  api = {
    status: vi.fn(async () => ({ state: 'ready' as const })),
    send: vi.fn(async () => ({ chatId: 'c1', messageId: 'm1' })),
    stop: vi.fn(async () => {}),
    onEvent: vi.fn((cb: (e: ClaudeEvent) => void) => {
      handler = cb;
      return () => {};
    }),
    listChats: vi.fn(async () => []),
    readChat: vi.fn(async () => null),
    deleteChat: vi.fn(async () => {}),
    undo: vi.fn(async () => ({ undone: [], conflicts: [] })),
  };
  flush = vi.fn(async () => {});
  confirm = vi.fn(() => true);
  bindClaude(api as unknown as Api, { flush: flush as unknown as () => Promise<void>, confirm: confirm as unknown as (text: string) => boolean });
});

const text = (t: string, messageId = 'm1'): ClaudeEvent => ({ chatId: 'c1', messageId, kind: 'text', text: t });

// Appending is linear: 20,000 pieces take well under 100 ms alone, while copying the list on each one would take seconds.
// The limit leaves room for a busy machine running the whole suite.
test('20,000 text events append quickly and join correctly', async () => {
  await useClaude.getState().send('go', null);
  const start = performance.now();
  for (let i = 0; i < 20000; i++) handler(text('x'));
  expect(performance.now() - start).toBeLessThan(500);
  expect(useClaude.getState().streaming.text.join('')).toBe('x'.repeat(20000));
});

test('done clears running and streaming, and the chat is what readChat returns', async () => {
  await useClaude.getState().send('go', 'p1');
  expect(useClaude.getState().running).toEqual({ chatId: 'c1', messageId: 'm1', lockedPageId: 'p1' });
  handler(text('a'));
  const saved = chatOf('c1', [reply('m1')]);
  api.readChat.mockResolvedValue(saved);
  handler({ chatId: 'c1', messageId: 'm1', kind: 'done', message: reply('m1') });
  await vi.waitFor(() => expect(useClaude.getState().chat).toEqual(saved));
  expect(useClaude.getState().running).toBeNull();
  expect(useClaude.getState().streaming).toEqual({ text: [], actions: [] });
  expect(api.listChats).toHaveBeenCalled();
});

test('done falls back to appending the message when the chat cannot be read', async () => {
  await useClaude.getState().send('go', null);
  handler({ chatId: 'c1', messageId: 'm1', kind: 'done', message: { ...reply('m1'), error: 'boom' } });
  // The reply shows at once, before the chat is read back.
  expect(useClaude.getState().chat?.messages.map((m) => m.id)).toEqual([expect.any(String), 'm1']);
  await vi.waitFor(() => expect(api.status).toHaveBeenCalled());
  expect(useClaude.getState().chat?.messages.map((m) => m.id)).toEqual([expect.any(String), 'm1']);
});

test('send ignores a blank message and a turn already running, and flushes first', async () => {
  await useClaude.getState().send('   ', null);
  expect(api.send).not.toHaveBeenCalled();
  const order: string[] = [];
  flush.mockImplementation(async () => void order.push('flush'));
  api.send.mockImplementation(async () => {
    order.push('send');
    return { chatId: 'c1', messageId: 'm1' };
  });
  await useClaude.getState().send('hello', 'p1');
  expect(order).toEqual(['flush', 'send']);
  await useClaude.getState().send('again', 'p1');
  expect(api.send).toHaveBeenCalledTimes(1);
  expect(useClaude.getState().chat?.messages[0]).toMatchObject({ role: 'user', text: 'hello' });
});

test('send passes the references and open page, then clears them', async () => {
  useClaude.getState().attach({ kind: 'page', pageId: 'p2', title: 'Two' });
  useClaude.getState().setSkipOpenPage(true);
  await useClaude.getState().send('hi', 'p1');
  expect(api.send).toHaveBeenCalledWith({ chatId: null, message: 'hi', references: [{ kind: 'page', pageId: 'p2', title: 'Two' }], openPageId: null });
  expect(useClaude.getState()).toMatchObject({ attachments: [], skipOpenPage: false, error: null });
  expect(useClaude.getState().running?.lockedPageId).toBe('p1');
});

test('a send error is shown and refreshes the status', async () => {
  api.send.mockResolvedValue({ error: 'nope' });
  await useClaude.getState().send('hi', null);
  expect(useClaude.getState()).toMatchObject({ error: 'nope', running: null, sending: false });
  await vi.waitFor(() => expect(api.status).toHaveBeenCalled());
});

test('an event arriving before api.send resolves is applied', async () => {
  let resolve!: (v: { chatId: string; messageId: string }) => void;
  api.send.mockReturnValue(new Promise((r) => (resolve = r)));
  const sent = useClaude.getState().send('hi', null);
  await vi.waitFor(() => expect(api.send).toHaveBeenCalled());
  expect(useClaude.getState().sending).toBe(true);
  handler(text('early'));
  resolve({ chatId: 'c1', messageId: 'm1' });
  await sent;
  expect(useClaude.getState().streaming.text.join('')).toBe('early');
});

test('events for another message are ignored', async () => {
  await useClaude.getState().send('hi', null);
  handler(text('stray', 'other'));
  expect(useClaude.getState().streaming.text).toEqual([]);
});

test('an action with a known id replaces the earlier one', async () => {
  await useClaude.getState().send('hi', null);
  handler({ chatId: 'c1', messageId: 'm1', kind: 'action', action: { id: 'a', verb: 'edited', path: 'S/P.json' } });
  handler({ chatId: 'c1', messageId: 'm1', kind: 'action', action: { verb: 'read', path: 'S/Q.json' } });
  handler({ chatId: 'c1', messageId: 'm1', kind: 'action', action: { id: 'a', verb: 'edited', path: 'S/P.json', refused: true } });
  expect(useClaude.getState().streaming.actions).toEqual([
    { id: 'a', verb: 'edited', path: 'S/P.json', refused: true },
    { verb: 'read', path: 'S/Q.json' },
  ]);
});

test('undo with conflicts asks, naming the pages, retries with force on only those paths, and not on no', async () => {
  useStore.setState({ notebooks: [page('a', 'Support and resistance'), page('w', 'Weekly levels')] });
  const changes = [change('M/A.json', 'a'), change('M/A/drawing-x.svg', 'a'), change('M/W.json', 'w'), change('M/X.json', 'x')];
  useClaude.setState({ chat: chatOf('c1', [{ ...reply('m1'), changes }]) });
  api.undo.mockResolvedValueOnce({ undone: ['M/X.json'], conflicts: ['M/A.json', 'M/A/drawing-x.svg', 'M/W.json'] }).mockResolvedValueOnce({ undone: [], conflicts: [] });
  api.readChat.mockResolvedValue(chatOf('c1', [reply('m1')]));
  await useClaude.getState().undo('m1', null);
  expect(confirm).toHaveBeenCalledWith("These pages changed since Claude's reply: “Support and resistance”, “Weekly levels”. Undo anyway?");
  expect(api.undo).toHaveBeenNthCalledWith(1, 'c1', 'm1', null, false);
  expect(api.undo).toHaveBeenNthCalledWith(2, 'c1', 'm1', ['M/A.json', 'M/A/drawing-x.svg', 'M/W.json'], true);
  expect(useClaude.getState().chat?.messages).toHaveLength(1);

  api.undo.mockClear();
  confirm.mockReturnValue(false);
  api.undo.mockResolvedValue({ undone: [], conflicts: ['b'] });
  await useClaude.getState().undo('m1', ['b']);
  expect(api.undo).toHaveBeenCalledTimes(1);
});

test("undo doesn't take the owner back to its chat when they opened another one meanwhile", async () => {
  useClaude.setState({ chat: chatOf('c1') });
  const undone = later<UndoResult>();
  api.undo.mockReturnValue(undone.promise);
  api.readChat.mockImplementation(async (id: string) => chatOf(id, [reply('m1')]));
  const undoing = useClaude.getState().undo('m1', null);
  await vi.waitFor(() => expect(api.undo).toHaveBeenCalled());
  await useClaude.getState().openChat('c2');
  undone.resolve({ undone: ['a'], conflicts: [] });
  await undoing;
  expect(useClaude.getState().chat?.id).toBe('c2');

  // Still on the same chat, the undo shows what's saved now.
  api.undo.mockResolvedValue({ undone: ['a'], conflicts: [] });
  await useClaude.getState().undo('m1', null);
  expect(useClaude.getState().chat).toEqual(chatOf('c2', [reply('m1')]));
});

test('openChat is refused while a message is being sent, as while Claude answers in another chat', async () => {
  useClaude.setState({ chat: chatOf('c1'), sending: true });
  api.readChat.mockResolvedValue(chatOf('c9'));
  await useClaude.getState().openChat('c9');
  await useClaude.getState().openChat(null);
  expect(useClaude.getState().chat?.id).toBe('c1');
  expect(api.readChat).not.toHaveBeenCalled();
});

test("a chat read after the owner moved on isn't shown", async () => {
  const reads: Record<string, (chat: Chat) => void> = {};
  api.readChat.mockImplementation((id: string) => new Promise((r) => (reads[id] = r)));

  // Two chats chosen one after the other: the later one shows, whichever is read first.
  const a = useClaude.getState().openChat('a');
  const b = useClaude.getState().openChat('b');
  reads.b(chatOf('b'));
  reads.a(chatOf('a'));
  await Promise.all([a, b]);
  expect(useClaude.getState().chat?.id).toBe('b');

  // New chat, after choosing one.
  const c = useClaude.getState().openChat('c');
  await useClaude.getState().openChat(null);
  reads.c(chatOf('c'));
  await c;
  expect(useClaude.getState().chat).toBeNull();

  // A message sent while a chat was being read: the chat it went to stays.
  const d = useClaude.getState().openChat('d');
  await useClaude.getState().send('hi', null);
  reads.d(chatOf('d'));
  await d;
  expect(useClaude.getState().chat?.id).toBe('c1');
});

test('reset lists the chats without checking the CLI, which waits for the panel to open', async () => {
  useClaude.setState({ chats: [summary('old')] });
  api.listChats.mockResolvedValue([summary('new')]);
  useClaude.getState().reset();
  expect(useClaude.getState().chats).toEqual([]);
  await vi.waitFor(() => expect(useClaude.getState().chats).toEqual([summary('new')]));
  expect(api.status).not.toHaveBeenCalled();
});

test("answers about the last workspace are dropped once a reset comes between: its chats, its status, a reply's list", async () => {
  // A refresh started before the reset asks again, for the workspace open now.
  const oldList = later<ChatSummary[]>();
  const oldStatus = later<ClaudeStatus>();
  api.listChats.mockReturnValueOnce(oldList.promise);
  api.status.mockReturnValueOnce(oldStatus.promise);
  const refreshed = useClaude.getState().refresh();
  api.listChats.mockResolvedValue([summary('new')]);
  useClaude.getState().reset();
  oldList.resolve([summary('old')]);
  oldStatus.resolve({ state: 'error', message: 'This workspace was closed.' });
  await refreshed;
  expect(useClaude.getState()).toMatchObject({ chats: [summary('new')], status: { state: 'ready' } });

  // A reset's own list, overtaken by a later reset.
  const firstList = later<ChatSummary[]>();
  api.listChats.mockReturnValueOnce(firstList.promise);
  useClaude.getState().reset();
  api.listChats.mockResolvedValue([summary('newer')]);
  useClaude.getState().reset();
  await vi.waitFor(() => expect(useClaude.getState().chats).toEqual([summary('newer')]));
  firstList.resolve([summary('new')]);
  await firstList.promise;
  expect(useClaude.getState().chats).toEqual([summary('newer')]);

  // The list read after a reply.
  await useClaude.getState().send('go', null);
  const afterReply = later<ChatSummary[]>();
  api.listChats.mockClear();
  api.listChats.mockReturnValueOnce(afterReply.promise);
  handler({ chatId: 'c1', messageId: 'm1', kind: 'done', message: reply('m1') });
  await vi.waitFor(() => expect(api.listChats).toHaveBeenCalledTimes(1));
  api.listChats.mockResolvedValue([summary('newest')]);
  useClaude.getState().reset();
  afterReply.resolve([summary('c1')]);
  await vi.waitFor(() => expect(useClaude.getState().chats).toEqual([summary('newest')]));
  await afterReply.promise;
  expect(useClaude.getState().chats).toEqual([summary('newest')]);
});

test("a send answered after a reset doesn't bring the last workspace's chat or error into the new one", async () => {
  const answer = later<{ chatId: string; messageId: string } | { error: string }>();
  api.send.mockReturnValue(answer.promise);
  const sent = useClaude.getState().send('hi', 'p1');
  await vi.waitFor(() => expect(api.send).toHaveBeenCalled());
  useClaude.getState().reset();
  answer.resolve({ chatId: 'c1', messageId: 'm1' });
  await sent;
  expect(useClaude.getState()).toMatchObject({ chat: null, running: null, sending: false, error: null });

  const failed = later<{ chatId: string; messageId: string } | { error: string }>();
  api.send.mockReturnValue(failed.promise);
  const again = useClaude.getState().send('hi', 'p1');
  await vi.waitFor(() => expect(api.send).toHaveBeenCalledTimes(2));
  useClaude.getState().reset();
  failed.resolve({ error: 'Claude is busy' });
  await again;
  expect(useClaude.getState()).toMatchObject({ chat: null, running: null, sending: false, error: null });
});

test('undo saves first, so words typed just before it reach the disk before the files are restored', async () => {
  useClaude.setState({ chat: chatOf('c1') });
  const order: string[] = [];
  flush.mockImplementation(async () => void order.push('flush'));
  api.undo.mockImplementation(async () => {
    order.push('undo');
    return { undone: [], conflicts: [] };
  });
  await useClaude.getState().undo('m1', null);
  expect(order).toEqual(['flush', 'undo']);
});

test('markNotApplied records per running message once, and does nothing otherwise', async () => {
  useClaude.getState().markNotApplied('p1');
  expect(useClaude.getState().notApplied).toEqual({});
  await useClaude.getState().send('hi', null);
  useClaude.getState().markNotApplied('p1');
  useClaude.getState().markNotApplied('p1');
  expect(useClaude.getState().notApplied).toEqual({ m1: ['p1'] });
});

test('attach opens the panel and skips a page already attached', () => {
  const ref = { kind: 'page', pageId: 'p', title: 'P' } as const;
  useClaude.getState().attach(ref);
  useClaude.getState().attach(ref);
  expect(useClaude.getState().open).toBe(true);
  expect(useClaude.getState().attachments).toHaveLength(1);
  useClaude.getState().detach(0);
  expect(useClaude.getState().attachments).toEqual([]);
});

test('openChat, deleteChat and reset', async () => {
  api.readChat.mockResolvedValue(chatOf('c9'));
  await useClaude.getState().openChat('c9');
  expect(useClaude.getState().chat?.id).toBe('c9');
  await useClaude.getState().deleteChat('c9');
  expect(api.deleteChat).toHaveBeenCalledWith('c9');
  expect(useClaude.getState().chat).toBeNull();
  useClaude.setState({ error: 'x', attachments: [{ kind: 'page', pageId: 'p', title: 'P' }] });
  useClaude.getState().reset();
  expect(useClaude.getState()).toMatchObject({ error: null, attachments: [], chat: null });
});

test('panel settings round-trip, clamp the width, and fall back on broken JSON', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  expect(readPanel(storage)).toEqual({ open: false, width: 400 });
  writePanel(storage, { open: true, width: 500 });
  expect(readPanel(storage)).toEqual({ open: true, width: 500 });
  data.set('quest-notebook-claude-panel', JSON.stringify({ open: true, width: 9000 }));
  expect(readPanel(storage).width).toBe(720);
  data.set('quest-notebook-claude-panel', JSON.stringify({ open: 'yes', width: 10 }));
  expect(readPanel(storage)).toEqual({ open: false, width: 320 });
  data.set('quest-notebook-claude-panel', '{nope');
  expect(readPanel(storage)).toEqual({ open: false, width: 400 });
  expect(readPanel(null)).toEqual({ open: false, width: 400 });
});

test('setOpen, toggle and setWidth persist', () => {
  useClaude.getState().toggle();
  useClaude.getState().setWidth(9999);
  expect(JSON.parse(localStorage.getItem('quest-notebook-claude-panel')!)).toEqual({ open: true, width: 720 });
  useClaude.getState().setOpen(false);
  expect(useClaude.getState().open).toBe(false);
});
