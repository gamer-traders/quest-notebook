// @vitest-environment jsdom
// The [[ menu and the links it puts in, run in a real editor with the page schema.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { SuggestionMenu } from '@blocknote/core/extensions';
import { TextSelection } from 'prosemirror-state';
import type { Notebook } from '../types';
import { useStore } from '../store';
import { schema, type PageEditor } from './schema';
import { LINK_TRIGGER, linkMenuOpensHere } from './inlineRules';
import { insertNotebookLink, linkClosingExtension } from './NotebookLink';
import { pageSlashItems } from './slashItems';

type Content = PartialBlock<PageEditor['schema']['blockSchema']>[];

let editor: PageEditor;

// The menu places itself by its trigger's rect, as JSON, which jsdom's rects can't give.
const rectOf = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () {
  const r = rectOf.call(this);
  return Object.assign(r, { toJSON: () => ({ x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left }) });
};

function open(content: Content): PageEditor {
  editor = BlockNoteEditor.create({ schema, extensions: [linkClosingExtension('j')], initialContent: content });
  const host = document.createElement('div');
  document.body.append(host);
  editor.mount(host);
  // What the editor's SuggestionMenuController registers.
  editor.getExtension(SuggestionMenu)!.addSuggestionMenu({ triggerCharacter: LINK_TRIGGER, shouldOpen: linkMenuOpensHere });
  return editor;
}

/** Types as the keyboard does: each character goes past the editor's text input handlers first. */
function type(text: string) {
  const view = editor.prosemirrorView;
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(ch, from, to);
    if (!view.someProp('handleTextInput', (f) => f(view, from, to, ch, insert))) view.dispatch(insert());
  }
}

const menu = () => editor.getExtension(SuggestionMenu)!.store.state;
const notebook = (id: string, title: string): Notebook => ({ id, title, spaceId: 'space-market', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [], items: {} });

beforeEach(() => {
  useStore.setState({
    notebooks: [notebook('j', 'Journal: 20 Oct 2026'), notebook('sr', 'Support and resistance')],
    activeId: 'j',
    view: 'notebook',
    flashBlockId: null,
  });
});

afterEach(() => {
  editor.unmount();
  document.body.innerHTML = '';
});

test('typing [[ opens the link menu, with what follows as its query', () => {
  open([{ id: 'p', type: 'paragraph', content: 'Same setup as ' }]);
  editor.setTextCursorPosition('p', 'end');
  type('[');
  expect(menu()?.show).toBeFalsy();
  type('[supp');
  expect(menu()).toMatchObject({ show: true, triggerCharacter: '[[', query: 'supp' });
});

test('Link to notebook in the / menu opens the link menu, as though [[ had been typed', () => {
  open([{ id: 'p', type: 'paragraph', content: 'See ' }]);
  editor.setTextCursorPosition('p', 'end');
  pageSlashItems(editor, 'j').find((i) => i.title === 'Link to notebook')!.onItemClick();
  expect(menu()).toMatchObject({ show: true, triggerCharacter: '[[', query: '' });
  type('bit');
  expect(menu()).toMatchObject({ show: true, query: 'bit' });
});

test('typing [ after anything but [ leaves the menu shut', () => {
  open([{ id: 'p', type: 'paragraph', content: 'a[b' }]);
  editor.setTextCursorPosition('p', 'end');
  type('[');
  expect(menu()?.show).toBeFalsy();
});

// A code block's code is typed in its own editor, which the page never hears from: CodeBlock.test.tsx shows that
// '[[' typed there opens no menu and makes no link.

test('[[ in inline code stays code', () => {
  open([{ id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'arr', styles: { code: true } }] }]);
  editor.setTextCursorPosition('p', 'start');
  editor.transact((tr) => tr.setSelection(TextSelection.create(tr.doc, tr.selection.from + 'ar'.length)));
  type('[[');
  expect(menu()?.show).toBeFalsy();
  expect(editor.document[0].content).toEqual([{ type: 'text', text: 'ar[[r', styles: { code: true } }]);
});

test('picking a notebook puts a link to it where [[ and the query were', () => {
  open([{ id: 'p', type: 'paragraph', content: 'Same setup as ' }]);
  editor.setTextCursorPosition('p', 'end');
  type('[[supp');
  editor.getExtension(SuggestionMenu)!.closeMenu();
  editor.getExtension(SuggestionMenu)!.clearQuery();
  insertNotebookLink(editor, 'j', { kind: 'notebook', notebookId: 'sr', title: 'Support and resistance' });

  expect(editor.document[0].content).toEqual([
    { type: 'text', text: 'Same setup as ', styles: {} },
    { type: 'notebookLink', props: { notebookId: 'sr', target: '' } },
    { type: 'text', text: ' ', styles: {} },
  ]);
});

test('a link mid-sentence adds no space', () => {
  open([{ id: 'p', type: 'paragraph', content: 'See , again' }]);
  editor.setTextCursorPosition('p', 'start');
  editor.transact((tr) => tr.setSelection(TextSelection.create(tr.doc, tr.selection.from + 'See '.length)));
  insertNotebookLink(editor, 'j', { kind: 'notebook', notebookId: 'sr', title: 'Support and resistance' });

  expect(editor.document[0].content).toEqual([
    { type: 'text', text: 'See ', styles: {} },
    { type: 'notebookLink', props: { notebookId: 'sr', target: '' } },
    { type: 'text', text: ', again', styles: {} },
  ]);
});

test("the create choice makes a top-level page in this page's space, links it, and stays on the page", () => {
  // This page is a sub-page, and its old shelf names another space: the new page follows the space.
  useStore.setState({ notebooks: [{ ...notebook('j', 'Journal: 20 Oct 2026'), parentId: 'sr' }, notebook('sr', 'Support and resistance')] });
  open([{ id: 'p', type: 'paragraph', content: 'Try ' }]);
  editor.setTextCursorPosition('p', 'end');
  insertNotebookLink(editor, 'j', { kind: 'create', title: 'New idea' });

  const created = useStore.getState().notebooks.find((n) => n.title === 'New idea')!;
  expect(created).toMatchObject({ spaceId: 'space-market', parentId: null });
  expect(useStore.getState().activeId).toBe('j');
  expect(useStore.getState().focusTitleId).toBeNull();
  expect(editor.document[0].content).toContainEqual({ type: 'notebookLink', props: { notebookId: created.id, target: '' } });
});

const titles = () => useStore.getState().notebooks.map((n) => n.title);

test('typing ]] after a notebook title turns [[Title]] into a link and closes the menu', () => {
  open([{ id: 'p', type: 'paragraph', content: 'Price ' }]);
  editor.setTextCursorPosition('p', 'end');
  type('[[Support and resistance]');
  expect(menu()?.show).toBe(true);
  type('] held today');

  expect(menu()?.show).toBe(false);
  expect(editor.document[0].content).toEqual([
    { type: 'text', text: 'Price ', styles: {} },
    { type: 'notebookLink', props: { notebookId: 'sr', target: '' } },
    { type: 'text', text: ' held today', styles: {} },
  ]);
  expect(titles()).toEqual(['Journal: 20 Oct 2026', 'Support and resistance']);
});

test('typing ]] after words that name no notebook closes the menu and keeps the text', () => {
  open([{ id: 'p', type: 'paragraph', content: '' }]);
  editor.setTextCursorPosition('p', 'end');
  type('[[No such page]] more');

  expect(menu()?.show).toBe(false);
  expect(editor.document[0].content).toEqual([{ type: 'text', text: '[[No such page]] more', styles: {} }]);
  expect(titles()).toEqual(['Journal: 20 Oct 2026', 'Support and resistance']);
});

test('[[ and ]] around the current notebook\'s own title stay text', () => {
  open([{ id: 'p', type: 'paragraph', content: '' }]);
  editor.setTextCursorPosition('p', 'end');
  type('[[journal: 20 oct 2026]]');
  expect(editor.document[0].content).toEqual([{ type: 'text', text: '[[journal: 20 oct 2026]]', styles: {} }]);
});
