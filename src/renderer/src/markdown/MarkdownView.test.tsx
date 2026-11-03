// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { MarkdownSave, MarkdownSaveResult, QuestApi } from '@shared/ipc';
import type { MarkdownFile, Notebook } from '../types';
import { useStore } from '../store';
import { MarkdownView } from './MarkdownView';
import { markdownSaves } from './saving';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let saves: MarkdownSave[];
let answer: (save: MarkdownSave) => MarkdownSaveResult;
let opened: string[];

const ID = 'md:Markets/Plan/Notes.md';
const page: Notebook = { id: 'p', title: 'Plan', spaceId: 'sm', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [], items: {} };
const file: MarkdownFile = { id: ID, path: 'Markets/Plan/Notes.md', spaceId: 'sm', parentId: 'p', text: '# Notes\n\nSee [[Plan]] and [the site](https://example.com).' };

/** The view as the app shows it: drawn again from the store whenever the file changes. */
function Shown() {
  const md = useStore((s) => s.markdown.find((m) => m.id === ID));
  return md ? <MarkdownView file={md} /> : null;
}

const stored = () => useStore.getState().markdown.find((m) => m.id === ID)!.text;
const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === label);
const click = (el: Element | undefined) => act(() => void (el as HTMLElement).click());
const type = (text: string) => {
  const box = container.querySelector('textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(1000)));

beforeEach(() => {
  vi.useFakeTimers();
  saves = [];
  opened = [];
  answer = () => ({ ok: true });
  const workspace = { saveMarkdown: async (save: MarkdownSave) => (saves.push(save), answer(save)) } as Partial<QuestApi['workspace']>;
  const app = { openExternal: async (url: string) => void opened.push(url) } as Partial<QuestApi['app']>;
  (window as unknown as { quest: unknown }).quest = { workspace, app };
  useStore.setState({ workspace: { root: '/w', name: 'W' }, notebooks: [page], spaces: [{ id: 'sm', name: 'Markets' }], markdown: [file], activeId: ID, view: 'notebook' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Shown />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

test('a Markdown file opens as formatted text, under its name and where it sits', () => {
  expect(container.querySelector('.markdown-body h1')?.textContent).toBe('Notes');
  expect(container.querySelector('textarea')).toBeNull();
  expect(container.querySelector('.page-path')?.textContent).toContain('Markets');
  expect(container.querySelector('.page-path')?.textContent).toContain('Plan');
  expect(container.querySelector('.markdown-title')?.textContent).toBe('Notes');
});

test('Edit shows the text as written, and a pause in typing saves it over the text it was opened from', async () => {
  click(button('Edit'));
  expect(container.querySelector('textarea')!.value).toBe(file.text);
  type('# Notes\n\nNew words.');
  expect(saves).toEqual([]);
  await settle();
  expect(saves).toEqual([{ root: '/w', path: 'Markets/Plan/Notes.md', text: '# Notes\n\nNew words.', base: file.text }]);
  expect(stored()).toBe('# Notes\n\nNew words.');
  // The next save starts from what was saved.
  type('# Notes\n\nNewer words.');
  await settle();
  expect(saves[1].base).toBe('# Notes\n\nNew words.');
});

test('Done saves at once and shows the text formatted again', async () => {
  click(button('Edit'));
  type('## Done now');
  click(button('Done'));
  await act(async () => void (await Promise.resolve()));
  expect(saves.map((s) => s.text)).toEqual(['## Done now']);
  expect(container.querySelector('.markdown-body h2')?.textContent).toBe('Done now');
});

test('a save refused because the file changed on disk leaves the choice to the owner: keep their words', async () => {
  answer = () => ({ ok: false, error: 'changed on disk', stale: true });
  click(button('Edit'));
  type('mine');
  await settle();
  expect(container.textContent).toContain('changed on disk');
  // The outside version arrives; typing on doesn't save until the owner chooses.
  act(() => useStore.getState().setMarkdownText(ID, 'theirs'));
  type('mine, more');
  await settle();
  expect(saves).toHaveLength(1);
  answer = () => ({ ok: true });
  click(button('Keep my version'));
  await settle();
  expect(saves.at(-1)).toMatchObject({ text: 'mine, more', base: 'theirs' });
  expect(stored()).toBe('mine, more');
  expect(container.textContent).not.toContain('changed on disk');
});

test('…or take the file as it is now', async () => {
  answer = () => ({ ok: false, error: 'changed on disk', stale: true });
  click(button('Edit'));
  type('mine');
  await settle();
  act(() => useStore.getState().setMarkdownText(ID, 'theirs'));
  click(button('Use the file’s version'));
  expect(container.querySelector('textarea')!.value).toBe('theirs');
  expect(saves).toHaveLength(1);
});

test('a change on disk shows at once while nothing is being typed', () => {
  act(() => useStore.getState().setMarkdownText(ID, '# Changed outside'));
  expect(container.querySelector('.markdown-body h1')?.textContent).toBe('Changed outside');
});

test('a [[link]] opens its page, and a web link opens in the browser', () => {
  click(container.querySelector('a[data-wikilink]')!);
  expect(useStore.getState().activeId).toBe('p');
  click(container.querySelector('a[href="https://example.com"]')!);
  expect(opened).toEqual(['https://example.com']);
});

test('words still waiting to be saved are saved when the window asks before closing', async () => {
  click(button('Edit'));
  type('last words');
  await act(async () => void (await markdownSaves.flushAll()));
  expect(saves.map((s) => s.text)).toEqual(['last words']);
});
