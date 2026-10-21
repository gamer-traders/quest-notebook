// @vitest-environment jsdom
// The / menu's chart, plan and prediction items, run in a real editor with the page schema and its guards.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import type { ChartCell, Notebook } from '../types';
import { useStore } from '../store';
import { schema, type PageEditor } from './schema';
import { itemBlocksExtension } from './itemExtension';
import { pageSlashItems } from './slashItems';

const eth: ChartCell = {
  id: 'A', type: 'chart', symbol: 'ETHUSDT', interval: '4h', asOf: 0, revealed: false, practice: false,
  levels: [], trends: [], pins: [],
};

type Content = PartialBlock<PageEditor['schema']['blockSchema']>[];

let editor: PageEditor;

function open(content: Content): PageEditor {
  editor = BlockNoteEditor.create({ schema, extensions: [itemBlocksExtension('n1')], initialContent: content });
  const host = document.createElement('div');
  document.body.append(host);
  editor.mount(host);
  return editor;
}

const items = () => useStore.getState().notebooks.find((n) => n.id === 'n1')!.items;
const pick = (title: string) => pageSlashItems(editor, 'n1').find((i) => i.title === title)!.onItemClick();

beforeEach(() => {
  // The store hasn't been given the page yet, as when the save is still waiting for typing to stop.
  const nb: Notebook = { id: 'n1', title: 'Levels', spaceId: 'space-market', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [], items: { A: eth } };
  useStore.setState({ notebooks: [nb], activeId: null, view: 'notebook', flashBlockId: null });
});

afterEach(() => {
  editor.unmount();
  document.body.innerHTML = '';
});

test('Chart on an empty line becomes that line, with the id of its data and the market of the chart above', () => {
  open([{ id: 'A', type: 'chart', props: { itemId: 'A' } }, { id: 'p', type: 'paragraph' }]);
  editor.setTextCursorPosition('p');
  pick('Chart');

  const block = editor.document[1];
  expect(block.type).toBe('chart');
  expect(block.props).toEqual({ itemId: block.id });
  expect(Object.keys(items())).toEqual(['A', block.id]);
  expect(items()[block.id]).toMatchObject({ type: 'chart', symbol: 'ETHUSDT', interval: '4h' });
});

test('Trade plan after some words goes below them, with the id of its data', () => {
  open([{ id: 'p', type: 'paragraph', content: 'Breakout over the range' }]);
  editor.setTextCursorPosition('p', 'end');
  pick('Trade plan');

  const block = editor.document[1];
  expect(editor.document[0].id).toBe('p');
  expect(block.type).toBe('tradePlan');
  expect(block.props).toEqual({ itemId: block.id });
  expect(items()[block.id]).toMatchObject({ type: 'plan', id: block.id });
});

test('the menu has the page blocks and ours, and no emoji or blocks a page leaves out', () => {
  open([{ type: 'paragraph' }]);
  const titles = pageSlashItems(editor, 'n1').map((i) => i.title);
  expect(titles.slice(0, 4)).toEqual(['Chart', 'Trade plan', 'Prediction', 'Drawing']);
  expect(titles).toContain('Callout');
  expect(titles).toContain('Heading 3');
  expect(titles).not.toContain('Heading 4');
  expect(titles).not.toContain('Emoji');
  expect(titles).not.toContain('Table');
  expect(titles).not.toContain('Toggle List');
});
