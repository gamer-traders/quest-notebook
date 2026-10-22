// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Chat, ChatMessage, ClaudeEvent, QuestApi } from '@shared/ipc';
import { useStore } from '../store';
import type { Notebook } from '../types';
import { ChatBoundary, ClaudePanel } from './ClaudePanel';
import { bindClaude, useClaude } from './store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lays nothing out, so it has nothing to scroll.
Element.prototype.scrollIntoView ??= () => {};

type Api = QuestApi['claude'];

const page = (id: string, title: string, path: string): Notebook => ({ id, title, spaceId: 'sm', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [], items: {}, path });
const A = 'Markets/Support and resistance.json';
const W = 'Markets/Weekly levels.json';

let api: { [K in keyof Api]: ReturnType<typeof vi.fn> };
let handler: (e: ClaudeEvent) => void;
let openExternal: ReturnType<typeof vi.fn>;
let frames: FrameRequestCallback[];
let host: HTMLElement;
let root: Root;

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  openExternal = vi.fn(async () => {});
  (window as unknown as { quest: Partial<QuestApi> }).quest = { app: { openExternal } as unknown as QuestApi['app'] };
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
    image: vi.fn(async () => null),
  };
  bindClaude(api as unknown as Api, { flush: async () => {}, confirm: () => true });
  useStore.setState({ notebooks: [page('a', 'Support and resistance', A), page('w', 'Weekly levels', W)], spaces: [{ id: 'sm', name: 'Markets' }], activeId: 'a', view: 'notebook' });
  useClaude.setState({ open: true, status: { state: 'ready' }, chats: [], chat: null, running: null, sending: false, streaming: { text: [], actions: [] }, notApplied: {}, attachments: [], images: [], localImages: {}, skipOpenPage: false, error: null });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = () => act(async () => root.render(<ClaudePanel />));
const runFrames = () =>
  act(() => {
    const due = frames;
    frames = [];
    for (const cb of due) cb(0);
  });
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name);
const input = () => host.querySelector<HTMLTextAreaElement>('textarea')!;
const type = (value: string) =>
  act(async () => {
    const el = input();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.setSelectionRange(value.length, value.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const press = (key: string, init: KeyboardEventInit = {}) => act(async () => void input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })));

const chat = (messages: ChatMessage[]): Chat => ({ id: 'c1', title: 'Levels', sessionId: null, created: 'c', updated: 'u', messages });
/** A promise and the function that settles it. */
function later<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  return { promise: new Promise<T>((r) => (resolve = r)), resolve };
}

test('each setup state says what to do, and Check again looks again', async () => {
  api.status.mockResolvedValue({ state: 'missing' });
  useClaude.setState({ status: { state: 'missing' } });
  await render();
  expect(host.textContent).toContain("Claude Code isn't installed. Install it from claude.com/claude-code, then check again.");
  expect(input()).toBeNull();
  const before = api.status.mock.calls.length;
  await click(button('Check again'));
  expect(api.status.mock.calls.length).toBe(before + 1);

  api.status.mockResolvedValue({ state: 'logged-out' });
  await act(async () => useClaude.setState({ status: { state: 'logged-out' } }));
  expect(host.textContent).toContain("Claude Code isn't logged in. Open Terminal, run claude auth login, then check again.");
});

test('an empty chat offers the four starters; one sends at once with the open page, or goes in the box to edit first', async () => {
  await render();
  expect([...host.querySelectorAll('.claude-quick-send')].map((b) => b.textContent)).toEqual([
    'Summarize this page',
    'Tidy this page',
    'Make a checklist from this page',
    "Turn this week's journal into a lesson page",
  ]);
  await click(host.querySelectorAll('[aria-label="Edit first"]')[1]);
  expect(input().value).toBe('Tidy this page');
  expect(document.activeElement).toBe(input());

  await click(button('Summarize this page'));
  expect(api.send).toHaveBeenCalledWith({ chatId: null, message: 'Summarize this page', references: [], openPageId: 'a' });
});

test('a reply is Markdown without raw HTML, and only its web links open, in the browser', async () => {
  const user: ChatMessage = { id: 'u1', role: 'user', text: 'what about this?', created: 'c', references: [{ kind: 'selection', pageId: 'w', title: 'Weekly levels', text: 'x' }] };
  const reply: ChatMessage = { id: 'm1', role: 'assistant', text: '**bold** <b>raw</b> [site](https://example.com) [bad](javascript:alert(1))', created: 'c', error: 'Usage limit reached' };
  useClaude.setState({ chat: chat([user, reply]) });
  await render();
  expect(host.querySelector('.claude-title')?.textContent).toBe('Levels');
  expect(host.querySelector('.is-user .claude-chip')?.textContent).toBe('Selection from Weekly levels');
  expect(host.querySelector('.claude-md strong')?.textContent).toBe('bold');
  expect(host.querySelector('.claude-md b')).toBeNull();
  expect(host.querySelectorAll('.claude-md a')).toHaveLength(1);
  await click(host.querySelector('.claude-md a'));
  expect(openExternal).toHaveBeenCalledWith('https://example.com');
  expect(host.querySelector('.claude-msg-error')?.textContent).toBe('Usage limit reached');
});

test('a reply renders GFM tables, task lists and strikethrough', async () => {
  const text = '| Level | Held |\n| --- | --- |\n| 62,400 | 3 times |\n\n- [x] Mark the weekly open\n- [ ] Note volume\n\n~~old idea~~';
  useClaude.setState({ chat: chat([{ id: 'm1', role: 'assistant', text, created: 'c' }]) });
  await render();
  expect([...host.querySelectorAll('.claude-md th')].map((th) => th.textContent)).toEqual(['Level', 'Held']);
  expect([...host.querySelectorAll('.claude-md td')].map((td) => td.textContent)).toEqual(['62,400', '3 times']);
  const boxes = [...host.querySelectorAll<HTMLInputElement>('.claude-md .task-list-item input[type="checkbox"]')];
  expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([
    [true, true],
    [false, true],
  ]);
  expect(host.querySelector('.claude-md del')?.textContent).toBe('old idea');
});

test('changed lines open their page and undo one by one or all together; undone lines are struck through', async () => {
  const reply: ChatMessage = {
    id: 'm1',
    role: 'assistant',
    text: 'Done.',
    created: 'c',
    actions: [{ verb: 'read', path: A }, { verb: 'searched', detail: 'gold', refused: true }],
    changes: [
      { path: A, pageId: 'a', kind: 'edited', drawing: false, before: '{}', after: '{}' },
      { path: W, pageId: 'w', kind: 'created', drawing: false, before: null, after: '{}' },
    ],
  };
  useClaude.setState({ chat: chat([reply]) });
  await render();
  expect([...host.querySelectorAll('.claude-actions li')].map((li) => li.textContent)).toEqual(['Read Support and resistance', 'Searched for “gold” (refused)']);
  expect([...host.querySelectorAll('.claude-change')].map((l) => l.textContent)).toEqual(['Edited Support and resistance', 'Created Weekly levels']);
  expect(host.textContent).not.toContain('not applied');
  expect(button('Undo all')).toBeDefined();

  await click(host.querySelectorAll('.claude-change')[1]);
  expect(useStore.getState().activeId).toBe('w');

  await click(host.querySelector('.claude-undo'));
  expect(api.undo).toHaveBeenCalledWith('c1', 'm1', [A], false);
  await click(button('Undo all'));
  expect(api.undo).toHaveBeenLastCalledWith('c1', 'm1', null, false);

  await act(async () => useClaude.setState({ chat: chat([{ ...reply, undone: [A] }]) }));
  expect(host.querySelector('.is-undone .claude-change')?.textContent).toContain('Edited Support and resistance');
  expect(host.querySelectorAll('.claude-undo')).toHaveLength(1);
  expect(button('Undo all')).toBeUndefined();
});

test("a page the reply's changes didn't reach has no Undo, and Undo all leaves it out, so the owner's words stay", async () => {
  const WD = 'Markets/Weekly levels/drawing-1.svg';
  const reply: ChatMessage = {
    id: 'm1',
    role: 'assistant',
    text: 'Done.',
    created: 'c',
    changes: [
      { path: A, pageId: 'a', kind: 'edited', drawing: false, before: '{}', after: '{}' },
      { path: W, pageId: 'w', kind: 'edited', drawing: false, before: '{}', after: '{}' },
      { path: WD, pageId: 'w', kind: 'created', drawing: true, before: null, after: '<svg/>' },
    ],
  };
  useClaude.setState({ chat: chat([reply]), notApplied: { m1: ['a'] } });
  await render();
  const lines = [...host.querySelectorAll('.claude-changes li')];
  expect(lines.map((li) => [li.querySelector('.claude-change')?.textContent, !!li.querySelector('.claude-undo'), li.querySelector('.claude-not-applied')?.textContent ?? null])).toEqual([
    ['Edited Support and resistance', false, 'not applied: you were editing this page'],
    ['Edited Weekly levels', true, null],
    ['Drew in Weekly levels', true, null],
  ]);
  await click(button('Undo all'));
  expect(api.undo).toHaveBeenCalledWith('c1', 'm1', [W, WD], false);

  // With one change left to undo, there's nothing for Undo all to do.
  await act(async () => useClaude.setState({ chat: chat([{ ...reply, undone: [WD] }]) }));
  expect(host.querySelectorAll('.claude-undo')).toHaveLength(1);
  expect(button('Undo all')).toBeUndefined();
});

test('a message with damaged fields is drawn from what can be, without breaking the panel', async () => {
  const user = { id: 'u1', role: 'user', text: { not: 'words' }, created: 'c', references: { kind: 'page' } } as unknown as ChatMessage;
  const odd = { id: 'm1', role: 'assistant', text: 'Done.', created: 'c', references: 'x', actions: { verb: 'read' }, changes: 'nope', undone: 7, error: { message: 'boom' } } as unknown as ChatMessage;
  // An "undone" that's words, not a list, would otherwise match any path it holds a piece of.
  const half = {
    id: 'm2',
    role: 'assistant',
    text: 42,
    created: 'c',
    actions: [{ verb: 'read', path: A }, null, { verb: 'read', path: { not: 'a path' } }],
    changes: [{ path: A, pageId: 'a', kind: 'edited', drawing: false, before: '{}', after: '{}' }, null, { path: 5 }],
    undone: A,
    error: 'Usage limit reached',
  } as unknown as ChatMessage;
  useClaude.setState({ chat: chat([user, odd, half]) });
  await render();
  expect(host.querySelector('.claude-failed')).toBeNull();
  expect(host.querySelectorAll('.claude-msg')).toHaveLength(3);
  expect(host.querySelector('.is-user .claude-plain')?.textContent).toBe('');
  expect([...host.querySelectorAll('.claude-md')].map((m) => m.textContent)).toEqual(['Done.']);
  expect([...host.querySelectorAll('.claude-actions li')].map((li) => li.textContent)).toEqual(['Read Support and resistance']);
  expect([...host.querySelectorAll('.claude-msg-error')].map((p) => p.textContent)).toEqual(['Usage limit reached']);
  expect([...host.querySelectorAll('.claude-change')].map((l) => l.textContent)).toEqual(['Edited Support and resistance']);
  expect(host.querySelectorAll('.claude-undo')).toHaveLength(1);
});

test("a chat that can't be drawn says so in place of the chat, with New chat, and the header still works", async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  useClaude.setState({ chat: { ...chat([]), messages: 'not a list' } as unknown as Chat });
  await render();
  expect(host.querySelector('.claude-failed p')?.textContent).toBe("This chat couldn't be shown.");
  expect(host.querySelector('.claude-title')?.textContent).toBe('Levels');
  expect(host.querySelector('textarea')).toBeNull();
  await click(host.querySelector('.claude-failed button'));
  expect(useClaude.getState().chat).toBeNull();
  expect(host.querySelector('.claude-failed')).toBeNull();
  expect(host.querySelectorAll('.claude-quick-send')).toHaveLength(4);
  errors.mockRestore();
});

test('the boundary catches a thrown child, and tries again when the chat changes or New chat is pressed', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let broken = true;
  const Child = () => {
    if (broken) throw new Error('bad chat');
    return <p className="fine">fine</p>;
  };
  const onNewChat = vi.fn();
  const one = chat([]);
  const draw = (c: Chat | null) => act(async () => root.render(<ChatBoundary chat={c} onNewChat={onNewChat}><Child /></ChatBoundary>));
  await draw(one);
  expect(host.querySelector('.claude-failed p')?.textContent).toBe("This chat couldn't be shown.");
  // The same chat drawn again still can't be.
  await draw(one);
  expect(host.querySelector('.fine')).toBeNull();

  broken = false;
  await draw({ ...one, messages: [] });
  expect(host.querySelector('.fine')).not.toBeNull();

  broken = true;
  await draw(one);
  broken = false;
  await click(host.querySelector('.claude-failed button'));
  expect(onNewChat).toHaveBeenCalledTimes(1);
  expect(host.querySelector('.fine')).not.toBeNull();
  errors.mockRestore();
});

test('while a message is on its way, no other chat can be chosen', async () => {
  // The list as the panel reads it when it opens.
  api.listChats.mockResolvedValue([
    { id: 'c1', title: 'Levels', updated: 'u' },
    { id: 'c2', title: 'Other', updated: 'v' },
  ]);
  useClaude.setState({ chat: chat([]) });
  await render();
  await act(async () => useClaude.setState({ sending: true }));
  await click(button('Chats ▾'));
  expect([...host.querySelectorAll<HTMLButtonElement>('.claude-chat-open')].map((b) => b.disabled)).toEqual([true, true]);
  await act(async () => useClaude.setState({ sending: false }));
  expect([...host.querySelectorAll<HTMLButtonElement>('.claude-chat-open')].map((b) => b.disabled)).toEqual([false, false]);
});

test('opening the panel looks for the CLI and lists the chats', async () => {
  await render();
  expect(api.status).toHaveBeenCalledTimes(1);
  expect(api.listChats).toHaveBeenCalledTimes(1);
});

test("a message over 100,000 characters can't be sent, and the box says so", async () => {
  await render();
  await type('x'.repeat(100_001));
  expect(button('Send')?.disabled).toBe(true);
  expect(host.querySelector('.claude-too-long')?.textContent).toBe('Too long to send');
  expect(input().getAttribute('aria-describedby')).toBe(host.querySelector('.claude-too-long')?.id);
  await press('Enter');
  expect(api.send).not.toHaveBeenCalled();

  await type('x'.repeat(100_000));
  expect(button('Send')?.disabled).toBe(false);
  expect(host.querySelector('.claude-too-long')).toBeNull();
  expect(input().hasAttribute('aria-describedby')).toBe(false);
});

test('a streamed reply is drawn once a frame, as plain text, with Stop and Send disabled', async () => {
  await render();
  await type('go');
  await press('Enter');
  expect(api.send).toHaveBeenCalledWith({ chatId: null, message: 'go', references: [], openPageId: 'a' });
  expect(input().value).toBe('');
  frames = [];

  await act(async () => {
    for (let i = 0; i < 2000; i++) handler({ chatId: 'c1', messageId: 'm1', kind: 'text', text: 'x' });
  });
  expect(frames).toHaveLength(1);
  expect(host.querySelector('.is-streaming')?.textContent).toBe('Working…');
  await runFrames();
  expect(host.querySelector('.is-streaming .claude-plain')?.textContent).toBe('x'.repeat(2000));
  expect(host.querySelector('.is-streaming .claude-md')).toBeNull();

  expect(button('Stop')).toBeDefined();
  await type('more');
  expect(button('Send')?.disabled).toBe(true);
  await click(button('Stop'));
  expect(api.stop).toHaveBeenCalled();
});

test('typing @ offers pages by title and path; Enter attaches one and takes the @query out, Escape closes', async () => {
  await render();
  await type('compare @wee');
  const options = host.querySelectorAll('[role="option"]');
  expect([...options].map((o) => o.textContent)).toEqual(['Weekly levelsMarkets']);
  await press('Enter');
  expect(useClaude.getState().attachments).toEqual([{ kind: 'page', pageId: 'w', title: 'Weekly levels' }]);
  expect(input().value).toBe('compare ');
  expect([...host.querySelectorAll('.claude-composer .claude-chip-label')].map((c) => c.textContent)).toEqual(['This page', 'Weekly levels']);
  expect(api.send).not.toHaveBeenCalled();

  await type('compare @sup');
  expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  await press('Escape');
  expect(host.querySelector('[role="listbox"]')).toBeNull();

  // Removing "This page" sends without it.
  await click(button('Leave out this page'));
  expect(useClaude.getState().skipOpenPage).toBe(true);
  await type('hi');
  await press('Enter', { shiftKey: true });
  expect(api.send).not.toHaveBeenCalled();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngFile = (name = 'shot.png') => new File([PNG], name, { type: 'image/png' });
const PNG_B64 = btoa(String.fromCharCode(...PNG));

/** A paste or drop event carrying these files, and words when given. */
function transfer(kind: 'paste' | 'drop' | 'dragover' | 'dragenter', files: File[], words: Record<string, string> = {}) {
  const event = new Event(kind, { bubbles: true, cancelable: true });
  const data = {
    files,
    types: [...Object.keys(words), ...(files.length ? ['Files'] : [])],
    getData: (type: string) => words[type] ?? '',
    dropEffect: 'none',
  };
  Object.defineProperty(event, kind === 'paste' ? 'clipboardData' : 'dataTransfer', { value: data });
  return event;
}
const fire = (el: Element, event: Event) => act(async () => void el.dispatchEvent(event));
const thumbs = () => [...host.querySelectorAll<HTMLImageElement>('.claude-composer .claude-chip-image img')];

test('a pasted image waits in the chips as a thumbnail, with ×, and goes with the message, which can be the image alone', async () => {
  await render();
  const paste = transfer('paste', [pngFile()]);
  await fire(input(), paste);
  expect(paste.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(thumbs()).toHaveLength(1));
  expect(thumbs()[0].alt).toBe('Pasted image 1');
  expect(thumbs()[0].src).toBe(`data:image/png;base64,${PNG_B64}`);
  expect(button('Send')?.disabled).toBe(false);

  await fire(input(), transfer('paste', [pngFile('two.png')]));
  await vi.waitFor(() => expect(thumbs().map((i) => i.alt)).toEqual(['Pasted image 1', 'Pasted image 2']));
  await click(button('Remove pasted image 1'));
  expect(useClaude.getState().images).toHaveLength(1);

  await click(button('Send'));
  expect(api.send).toHaveBeenCalledWith({ chatId: null, message: '', references: [], openPageId: 'a', images: [{ type: 'image/png', data: PNG_B64 }] });
  expect(thumbs()).toHaveLength(0);
  // The message shows its image at once, before the chat is read back.
  expect(host.querySelector<HTMLImageElement>('.is-user .claude-msg-image img')?.src).toBe(`data:image/png;base64,${PNG_B64}`);
});

test('pasted words go in as before; a file of another type is refused with a reason', async () => {
  await render();
  const words = transfer('paste', [], { 'text/plain': 'hello' });
  await fire(input(), words);
  expect(words.defaultPrevented).toBe(false);
  // Words copied from a sheet or a document come with a picture of themselves: the words go in.
  const sheet = transfer('paste', [pngFile()], { 'text/plain': 'a\tb', 'text/html': '<table></table>' });
  await fire(input(), sheet);
  expect(sheet.defaultPrevented).toBe(false);
  expect(useClaude.getState().images).toEqual([]);

  const pdf = transfer('paste', [new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })]);
  await fire(input(), pdf);
  expect(pdf.defaultPrevented).toBe(true);
  expect(host.querySelector('.claude-error')?.textContent).toContain('Only PNG, JPEG, GIF and WebP images can be sent');
  expect(useClaude.getState().images).toEqual([]);
});

test('files dragged over the panel light up the box, and dropped images join the message', async () => {
  await render();
  const panel = host.querySelector('.claude-panel')!;
  const over = transfer('dragover', [pngFile()]);
  await fire(host.querySelector('.claude-scroll')!, over);
  expect(over.defaultPrevented).toBe(true);
  expect(panel.classList.contains('is-dropping')).toBe(true);
  // Words dragged aren't dropped here.
  const dragWords = transfer('dragover', [], { 'text/plain': 'x' });
  await fire(panel, dragWords);
  expect(dragWords.defaultPrevented).toBe(false);

  const drop = transfer('drop', [pngFile(), pngFile('b.png')]);
  await fire(host.querySelector('.claude-scroll')!, drop);
  expect(drop.defaultPrevented).toBe(true);
  expect(panel.classList.contains('is-dropping')).toBe(false);
  await vi.waitFor(() => expect(thumbs()).toHaveLength(2));
});

test('a saved image is loaded from main once, with a placeholder until it comes; a missing one says so', async () => {
  const shown = later<{ type: 'image/png'; data: string } | null>();
  api.image.mockImplementation((_chat: string, file: string) => (file === 'c1aaaaaa-gone0000.png' ? Promise.resolve(null) : shown.promise));
  const user: ChatMessage = {
    id: 'u1',
    role: 'user',
    text: 'what is this?',
    created: 'c',
    images: [
      { file: 'c1aaaaaa-abcdefgh.png', type: 'image/png' },
      { file: 'c1aaaaaa-gone0000.png', type: 'image/png' },
    ],
  };
  useClaude.setState({ chat: chat([user]) });
  await render();
  expect(api.image).toHaveBeenCalledWith('c1', 'c1aaaaaa-abcdefgh.png');
  const tiles = () => [...host.querySelectorAll('.is-user .claude-msg-image')];
  expect(tiles()[0].classList.contains('is-loading')).toBe(true);
  expect(tiles()[1].textContent).toBe('Image missing');

  await act(async () => shown.resolve({ type: 'image/png', data: 'AAAA' }));
  expect(tiles()[0].querySelector('img')?.src).toBe('data:image/png;base64,AAAA');

  // Shown again, it's known.
  api.image.mockClear();
  await act(async () => useClaude.setState({ chat: { ...chat([user]) } }));
  act(() => root.unmount());
  root = createRoot(host);
  await render();
  expect(tiles()[0].querySelector('img')?.src).toBe('data:image/png;base64,AAAA');
  expect(api.image).not.toHaveBeenCalledWith('c1', 'c1aaaaaa-abcdefgh.png');
});

test('an image in a message opens larger over the window; Escape or a click closes it and focus goes back', async () => {
  const user: ChatMessage = { id: 'local-1', role: 'user', text: '', created: 'c' };
  useClaude.setState({ chat: chat([user]), localImages: { 'local-1': ['data:image/png;base64,AAAA'] } });
  await render();
  const thumb = host.querySelector<HTMLButtonElement>('.claude-msg-image')!;
  // An image alone has no line of words under it.
  expect(host.querySelector('.is-user .claude-plain')).toBeNull();
  await click(thumb);
  const viewer = () => document.querySelector('.claude-viewer');
  expect(viewer()?.getAttribute('role')).toBe('dialog');
  expect(viewer()?.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  await act(async () => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(viewer()).toBeNull();
  expect(document.activeElement).toBe(thumb);

  await click(thumb);
  await click(viewer());
  expect(viewer()).toBeNull();
});

test('a block reference chip reads the block, with its page and place as a tooltip, before and after sending', async () => {
  const block = { kind: 'block', pageId: 'w', title: 'Weekly levels', text: '{ "type": "paragraph", "text": "Entry at the weekly open" }', where: 'block 4 of 12' } as const;
  useClaude.setState({ attachments: [block], chat: chat([{ id: 'u1', role: 'user', text: 'why?', created: 'c', references: [block] }]) });
  await render();
  const composerChip = [...host.querySelectorAll('.claude-composer .claude-chip')].find((c) => c.textContent?.startsWith('Block'))!;
  expect([composerChip.querySelector('.claude-chip-label')?.textContent, composerChip.getAttribute('title')]).toEqual(['Block: Entry at the weekly open', 'Weekly levels, block 4 of 12']);
  const sentChip = host.querySelector('.is-user .claude-chip')!;
  expect([sentChip.textContent, sentChip.getAttribute('title')]).toEqual(['Block: Entry at the weekly open', 'Weekly levels, block 4 of 12']);
});
