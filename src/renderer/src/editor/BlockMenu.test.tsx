// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useStore } from '../store';
import type { Notebook } from '../types';
import type { PageBlock } from '../page/blockTypes';
import { NotebookEditor } from './NotebookEditor';
import { askAbout } from './BlockMenu';
import { useClaude } from '../claude/store';

vi.mock('../claude/ClaudePanel', async (original) => ({ ...(await original<typeof import('../claude/ClaudePanel')>()), askClaude: vi.fn() }));
const { askClaude } = await import('../claude/ClaudePanel');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lays nothing out: the editor and the menu ask where things are.
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
window.scrollTo = () => {};
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const text = (id: string, type: string, words: string, children: PageBlock[] = []): PageBlock => ({
  id,
  type,
  props: {},
  content: [{ type: 'text', text: words, styles: {} }],
  children,
});
const item = (id: string, type: string): PageBlock => ({ id, type, props: { itemId: id }, children: [] });

const page: Notebook = {
  id: 'a',
  title: 'Levels',
  spaceId: 's',
  parentId: null,
  position: 0,
  createdAt: 0,
  updatedAt: 0,
  blocks: [
    text('t1', 'paragraph', 'hello world'),
    text('b1', 'bulletListItem', 'Levels', [text('b2', 'bulletListItem', '62,400 held')]),
    item('p1', 'tradePlan'),
    item('d1', 'drawing'),
  ],
  items: {
    p1: { id: 'p1', type: 'plan', side: 'long', entry: 1, stop: null, target: null, reason: '' },
    d1: { id: 'd1', type: 'drawing', height: 300, background: 'blank', strokes: [] },
  },
};

let host: HTMLElement;
let root: Root;

const draw = async (editable = true) => {
  await act(async () => root.render(createElement(NotebookEditor, { notebook: page, editable })));
  // The editor draws its item blocks a moment after it mounts.
  await vi.waitFor(async () => {
    await act(() => new Promise((r) => setTimeout(r, 5)));
    expect(host.querySelector('.drawing-canvas')).not.toBeNull();
  });
};

beforeEach(async () => {
  vi.mocked(askClaude).mockClear();
  useStore.setState({ notebooks: [page], spaces: [{ id: 's', name: 'S' }], activeId: 'a', view: 'notebook' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await draw();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const blockText = (id: string) => host.querySelector(`[data-node-type="blockContainer"][data-id="${id}"] .bn-inline-content`)!;
const rightClick = async (el: Element) => {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 80 });
  await act(async () => void el.dispatchEvent(event));
  return event;
};
const menu = () => document.querySelector<HTMLElement>('.block-menu');
const item0 = () => menu()?.querySelector<HTMLButtonElement>('[role="menuitem"]') ?? null;
/** The blocks' JSON in the last reference asked about. */
const lastText = () => {
  const ref = vi.mocked(askClaude).mock.lastCall![0];
  return ref.kind === 'block' ? ref.text : '';
};

test('right-clicking a block offers to ask Claude about it, and attaches the block as the file has it', async () => {
  const event = await rightClick(blockText('t1'));
  expect(event.defaultPrevented).toBe(true);
  expect(menu()?.getAttribute('role')).toBe('menu');
  expect([menu()!.style.left, menu()!.style.top]).toEqual(['120px', '80px']);
  expect(item0()?.textContent).toBe('Ask Claude about this block');
  expect(document.activeElement).toBe(item0());
  await act(async () => item0()!.click());
  expect(askClaude).toHaveBeenCalledWith({ kind: 'block', pageId: 'a', title: 'Levels', text: '{ "type": "paragraph", "text": "hello world" }', where: 'block 1 of 4' });
  expect(menu()).toBeNull();
});

test('a nested block says what it is inside; an item block is its data', async () => {
  await rightClick(blockText('b2'));
  await act(async () => item0()!.click());
  expect(askClaude).toHaveBeenLastCalledWith(expect.objectContaining({ text: '{ "type": "bullet", "text": "62,400 held" }', where: 'inside block 2 of 4' }));

  await rightClick(host.querySelector('.plan-cell')!);
  await act(async () => item0()!.click());
  expect(askClaude).toHaveBeenLastCalledWith(expect.objectContaining({ where: 'block 3 of 4' }));
  expect(JSON.parse(lastText())).toMatchObject({ type: 'tradePlan', id: 'p1', side: 'long' });
});

test("a drawing's canvas keeps its own right-click: no menu", async () => {
  const event = await rightClick(host.querySelector('.drawing-canvas')!);
  expect(event.defaultPrevented).toBe(false);
  expect(menu()).toBeNull();
  // The rest of the drawing block still offers it.
  await rightClick(host.querySelector('[data-id="d1"] .item-block')!);
  expect(item0()?.textContent).toBe('Ask Claude about this block');
});

test('with several blocks selected, right-clicking one of them asks about them all, as one reference', async () => {
  await act(async () => {
    const view = (host.querySelector('.ProseMirror') as unknown as { editor: { view: EditorView } }).editor.view;
    const starts: number[] = [];
    view.state.doc.descendants((n, pos) => {
      if (n.isText) starts.push(pos);
    });
    // From inside "hello world" to inside "Levels".
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, starts[0] + 2, starts[1] + 3)));
  });
  await rightClick(blockText('t1'));
  expect(item0()?.textContent).toBe('Ask Claude about these 2 blocks');
  await act(async () => item0()!.click());
  expect(vi.mocked(askClaude).mock.lastCall![0]).toMatchObject({ kind: 'block', where: 'blocks 1–2 of 4' });
  expect(JSON.parse(lastText())).toEqual([
    { type: 'paragraph', text: 'hello world' },
    { type: 'bullet', text: 'Levels', children: [{ type: 'bullet', text: '62,400 held' }] },
  ]);

  // A block outside the selection is asked about alone.
  await rightClick(host.querySelector('.plan-cell')!);
  expect(item0()?.textContent).toBe('Ask Claude about this block');
});

test('Escape, a press outside, or scrolling closes the menu; Escape gives focus back', async () => {
  const editable = host.querySelector<HTMLElement>('.ProseMirror')!;
  editable.focus();
  await rightClick(blockText('t1'));
  await act(async () => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(editable);

  await rightClick(blockText('t1'));
  await act(async () => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(menu()).toBeNull();

  await rightClick(blockText('t1'));
  await act(async () => void host.dispatchEvent(new Event('scroll')));
  expect(menu()).toBeNull();
  expect(askClaude).not.toHaveBeenCalled();
});

test('a read-only page offers it too: asking only reads', async () => {
  await draw(false);
  expect(host.querySelector('.ProseMirror')!.getAttribute('contenteditable')).toBe('false');
  await rightClick(blockText('t1'));
  await act(async () => item0()!.click());
  expect(askClaude).toHaveBeenCalledWith(expect.objectContaining({ where: 'block 1 of 4' }));
});

test("blocks too long for main to take aren't attached: the panel opens and says why", () => {
  useClaude.setState({ open: false, error: null, attachments: [] });
  const ref = { kind: 'block', pageId: 'a', title: 'Levels', text: `{ "type": "chart", "candles": "${'x'.repeat(50_000)}" }`, where: 'block 1 of 4' } as const;
  askAbout(ref);
  expect(askClaude).not.toHaveBeenCalled();
  expect(useClaude.getState()).toMatchObject({ open: true, attachments: [], error: 'This block is too long to send. Ask about the whole page instead.' });
  askAbout({ ...ref, text: `[${ref.text}]` });
  expect(useClaude.getState().error).toBe('These blocks are too long to send. Ask about the whole page instead.');

  askAbout({ ...ref, text: '{ "type": "divider" }' });
  expect(askClaude).toHaveBeenCalledWith({ ...ref, text: '{ "type": "divider" }' });
});
