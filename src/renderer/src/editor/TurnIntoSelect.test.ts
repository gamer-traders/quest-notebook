// @vitest-environment jsdom
// A real editor with the page schema, so the selection's blocks are the ones BlockNote's "turn into" would change.
import { afterEach, expect, test } from 'vitest';
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { NodeSelection } from 'prosemirror-state';
import { schema, type PageEditor } from './schema';
import { canTurnInto } from './TurnIntoSelect';

type Content = PartialBlock<PageEditor['schema']['blockSchema']>[];
const para = (id: string, text: string) => ({ id, type: 'paragraph' as const, content: text });
const item = (id: string, type: 'chart' | 'tradePlan' | 'prediction') => ({ id, type, props: { itemId: id } });

let editor: PageEditor;

function open(content: Content): PageEditor {
  editor = BlockNoteEditor.create({ schema, initialContent: content });
  const host = document.createElement('div');
  document.body.append(host);
  editor.mount(host);
  return editor;
}

afterEach(() => {
  editor.unmount();
  document.body.innerHTML = '';
});

test.each(['chart', 'tradePlan', 'prediction'] as const)('a selection that takes in a %s block offers no "turn into"', (type) => {
  open([para('p1', 'Before'), item('A', type), para('p2', 'After')]);
  editor.setSelection('p1', 'p2');
  expect(editor.getSelection()!.blocks.map((b) => b.type)).toEqual(['paragraph', type, 'paragraph']);
  expect(canTurnInto(editor)).toBe(false);
});

// As the first Backspace under a chart leaves it.
test('a chart selected on its own offers no "turn into"', () => {
  open([para('p1', 'Before'), item('A', 'chart'), para('p2', 'After')]);
  let chartAt = -1;
  editor.prosemirrorState.doc.descendants((node, pos) => {
    if (node.type.name === 'chart') chartAt = pos;
  });
  editor.transact((tr) => tr.setSelection(NodeSelection.create(tr.doc, chartAt)));
  expect(canTurnInto(editor)).toBe(false);
});

test('text blocks keep "turn into", across several blocks or at the caret', () => {
  open([para('p1', 'Before'), { id: 'h', type: 'heading', content: 'Levels' }, para('p2', 'After'), item('A', 'chart')]);
  editor.setSelection('p1', 'p2');
  expect(canTurnInto(editor)).toBe(true);
  editor.setTextCursorPosition('h', 'end');
  expect(canTurnInto(editor)).toBe(true);
});
