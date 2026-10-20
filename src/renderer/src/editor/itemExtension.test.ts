// @vitest-environment jsdom
// A real editor with the page schema, mounted in jsdom, so its plugins, keymaps and undo all run.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { ChartCell, Notebook } from '../types';
import { useStore } from '../store';
import { schema, type PageEditor } from './schema';
import { itemBlockAtCaret, itemBlocksExtension } from './itemExtension';

const chart = (id: string): ChartCell => ({
  id, type: 'chart', symbol: 'BTCUSDT', interval: '1d', asOf: 0, revealed: false, practice: false,
  levels: [{ id: 'l1', price: 70000 }], trends: [], pins: [],
});

type Content = PartialBlock<PageEditor['schema']['blockSchema']>[];
const chartBlock = (id: string, itemId = id) => ({ id, type: 'chart' as const, props: { itemId } });
const para = (id: string, text: string) => ({ id, type: 'paragraph' as const, content: text });

let editor: PageEditor;

function open(content: Content): PageEditor {
  editor = BlockNoteEditor.create({ schema, extensions: [itemBlocksExtension('n1')], initialContent: content });
  const host = document.createElement('div');
  document.body.append(host);
  editor.mount(host);
  return editor;
}

const items = () => useStore.getState().notebooks.find((n) => n.id === 'n1')!.items;
const page = () => editor.document.map((b) => (b.type === 'chart' ? `chart ${b.id}→${b.props.itemId}` : b.type));
const press = (key: 'Backspace' | 'Delete') =>
  editor.prosemirrorView!.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const selectedNode = () => {
  const sel = editor.prosemirrorState.selection;
  return sel instanceof NodeSelection ? sel.node.type.name : null;
};
const caretAt = (blockId: string, offset: number) => {
  editor.setTextCursorPosition(blockId, 'start');
  editor.transact((tr) => tr.setSelection(TextSelection.create(tr.doc, tr.selection.from + offset)));
};

beforeEach(() => {
  const nb: Notebook = { id: 'n1', title: 'Levels', spaceId: 'space-market', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [], items: { A: chart('A') } };
  useStore.setState({ notebooks: [nb], activeId: null, view: 'notebook', flashBlockId: null });
});

afterEach(() => {
  editor.unmount();
  document.body.innerHTML = '';
});

// Pasting keeps a block's props but gives it a new id, which is what inserting X pointing at A does here.

test('a pasted block gets its own copy of the data, and one undo takes the paste back', () => {
  open([chartBlock('A'), para('p', 'Below')]);
  editor.insertBlocks([chartBlock('X', 'A')], 'p', 'after');
  expect(page()).toEqual(['chart A→A', 'paragraph', 'chart X→X']);
  expect(items().X).toEqual({ ...chart('A'), id: 'X' });

  editor.undo();
  expect(page()).toEqual(['chart A→A', 'paragraph']);
});

test('a copy of an edited copy gets the edited data', () => {
  open([chartBlock('A'), para('p', 'Below')]);
  editor.insertBlocks([chartBlock('X', 'A')], 'p', 'after');
  useStore.getState().updateItem<ChartCell>('n1', 'X', { levels: [{ id: 'l2', price: 64000 }] });

  editor.insertBlocks([chartBlock('Y', 'X')], 'X', 'after');
  expect((items().Y as ChartCell).levels).toEqual([{ id: 'l2', price: 64000 }]);
});

test('a copy made after its source was cut and pruned still has its data', () => {
  open([chartBlock('A'), para('p', 'Below')]);
  editor.removeBlocks(['A']);
  editor.insertBlocks([chartBlock('X', 'A')], 'p', 'after');
  const { setBlocks, openNotebook } = useStore.getState();
  setBlocks('n1', editor.document as never);
  openNotebook('n1');
  expect(items().A).toBeUndefined();

  editor.insertBlocks([chartBlock('Y', 'X')], 'X', 'after');
  expect(items().Y).toEqual({ ...chart('A'), id: 'Y' });
});

test('Backspace under a chart selects it, a second Backspace deletes it, and undo brings it back', () => {
  open([chartBlock('A'), para('p', 'Below')]);
  editor.setTextCursorPosition('p', 'start');

  press('Backspace');
  expect(selectedNode()).toBe('chart');
  expect(page()).toEqual(['chart A→A', 'paragraph']);

  press('Backspace');
  expect(page()).toEqual(['paragraph']);

  editor.undo();
  expect(page()).toEqual(['chart A→A', 'paragraph']);
  expect(items().A).toEqual(chart('A'));
});

test('Delete above a chart selects it, and a second Delete deletes it', () => {
  open([para('p', 'Above'), chartBlock('A')]);
  editor.setTextCursorPosition('p', 'end');

  press('Delete');
  expect(selectedNode()).toBe('chart');
  expect(page()).toEqual(['paragraph', 'chart A→A']);

  press('Delete');
  expect(page()).toEqual(['paragraph']);
});

test('Delete finds a chart nested under the block, or the next block out of a nested one', () => {
  open([{ ...para('p', 'Parent'), children: [chartBlock('A')] }, { ...para('q', 'Parent'), children: [para('c', 'Child')] }, chartBlock('B')]);
  editor.setTextCursorPosition('p', 'end');
  expect(itemBlockAtCaret(editor.prosemirrorState, 'Delete')).toBe('A');
  editor.setTextCursorPosition('c', 'end');
  expect(itemBlockAtCaret(editor.prosemirrorState, 'Delete')).toBe('B');
});

test('Backspace finds a chart nested as the last block above', () => {
  open([{ ...para('p', 'Parent'), children: [chartBlock('A')] }, para('q', 'Below')]);
  editor.setTextCursorPosition('q', 'start');
  expect(itemBlockAtCaret(editor.prosemirrorState, 'Backspace')).toBe('A');
});

test('ordinary text deletion is left to the editor', () => {
  open([chartBlock('A'), para('p', 'Below'), { id: 'h', type: 'heading', content: 'Title' }, para('e', ''), para('q', 'Text')]);

  caretAt('p', 2);
  expect(itemBlockAtCaret(editor.prosemirrorState, 'Backspace')).toBeNull();
  editor.setTextCursorPosition('q', 'start');
  expect(itemBlockAtCaret(editor.prosemirrorState, 'Backspace')).toBeNull();
  editor.setTextCursorPosition('p', 'end');
  expect(itemBlockAtCaret(editor.prosemirrorState, 'Delete')).toBeNull();
});

test('a heading or an empty paragraph under a chart is left to the editor, which never deletes the chart there', () => {
  open([chartBlock('A'), { id: 'h', type: 'heading', content: 'Title' }]);
  editor.setTextCursorPosition('h', 'start');
  expect(itemBlockAtCaret(editor.prosemirrorState, 'Backspace')).toBeNull();
  press('Backspace');
  expect(page()).toEqual(['chart A→A', 'paragraph']);

  editor.updateBlock('h', { content: [] });
  editor.setTextCursorPosition('h', 'start');
  expect(itemBlockAtCaret(editor.prosemirrorState, 'Backspace')).toBeNull();
  press('Backspace');
  expect(page()).toEqual(['chart A→A']);
  expect(selectedNode()).toBe('chart');
});
