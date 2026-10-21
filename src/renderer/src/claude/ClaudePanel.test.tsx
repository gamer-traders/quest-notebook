// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Chat, ChatMessage, ClaudeEvent, QuestApi } from '@shared/ipc';
import { useStore } from '../store';
import type { Notebook } from '../types';
import { ClaudePanel } from './ClaudePanel';
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
  };
  bindClaude(api as unknown as Api, { flush: async () => {}, confirm: () => true });
  useStore.setState({ notebooks: [page('a', 'Support and resistance', A), page('w', 'Weekly levels', W)], spaces: [{ id: 'sm', name: 'Markets' }], activeId: 'a', view: 'notebook' });
  useClaude.setState({ open: true, status: { state: 'ready' }, chats: [], chat: null, running: null, sending: false, streaming: { text: [], actions: [] }, notApplied: {}, attachments: [], skipOpenPage: false, error: null });
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
  useClaude.setState({ chat: chat([reply]), notApplied: { m1: ['a'] } });
  await render();
  expect([...host.querySelectorAll('.claude-actions li')].map((li) => li.textContent)).toEqual(['Read Support and resistance', 'Searched for “gold” (refused)']);
  expect([...host.querySelectorAll('.claude-change')].map((l) => l.textContent)).toEqual(['Edited Support and resistance', 'Created Weekly levels']);
  expect(host.textContent).toContain('not applied: you were editing this page');
  expect(button('Undo all')).toBeDefined();

  await click(host.querySelectorAll('.claude-change')[1]);
  expect(useStore.getState().activeId).toBe('w');

  await click(host.querySelector('.claude-undo'));
  expect(api.undo).toHaveBeenCalledWith('c1', 'm1', [A], false);

  await act(async () => useClaude.setState({ chat: chat([{ ...reply, undone: [A] }]) }));
  expect(host.querySelector('.is-undone .claude-change')?.textContent).toContain('Edited Support and resistance');
  expect(host.querySelectorAll('.claude-undo')).toHaveLength(1);
  expect(button('Undo all')).toBeUndefined();
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
