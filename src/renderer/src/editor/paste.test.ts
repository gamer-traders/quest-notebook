// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { BlockNoteEditor } from '@blocknote/core';
import type { Notebook } from '../types';
import { useStore } from '../store';
import { linkClipboard } from './copyLink';
import { pastePage, tablesToParagraphs } from './paste';
import { schema, type PageEditor } from './schema';

test('each table row becomes a paragraph, its cells set apart by bars', () => {
  const html =
    '<p>Levels</p><table><thead><tr><th>Level</th><th>Price</th></tr></thead>' +
    '<tbody><tr><td>Support</td><td> 67,500 </td></tr><tr><td><b>Resistance</b></td><td>73,800</td></tr></tbody></table><p>After</p>';
  expect(tablesToParagraphs(html)).toBe('<p>Levels</p><p>Level | Price</p><p>Support | 67,500</p><p>Resistance | 73,800</p><p>After</p>');
});

test('html without a table is left as it is', () => {
  const html = '<h2>Weekly</h2><p>BTC held <b>70k</b>.</p>';
  expect(tablesToParagraphs(html)).toBe(html);
});

describe('pasting a page link', () => {
  let editor: PageEditor;
  let usual: number;

  const notebook = (id: string, title: string): Notebook => ({ id, title, spaceId: 'space-market', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [], items: {} });

  /** Pastes as the browser would hand it to the editor, at the end of the first paragraph. */
  function paste(data: Record<string, string>) {
    const event = { clipboardData: { types: Object.keys(data), getData: (type: string) => data[type] ?? '' } } as unknown as ClipboardEvent;
    return pastePage({ event, editor, defaultPasteHandler: () => (usual++, true) });
  }

  beforeEach(() => {
    usual = 0;
    useStore.setState({ notebooks: [notebook('j', 'Today'), notebook('sr', 'Support and resistance'), notebook('w1', 'Weekly'), notebook('w2', 'weekly')] });
    editor = BlockNoteEditor.create({ schema, initialContent: [{ id: 'p', type: 'paragraph', content: 'See ' }] });
    const host = document.createElement('div');
    document.body.append(host);
    editor.mount(host);
    editor.setTextCursorPosition('p', 'end');
  });

  afterEach(() => {
    editor.unmount();
    document.body.innerHTML = '';
  });

  test('a copied link pastes as a link chip to that page', () => {
    const { text, html } = linkClipboard('sr', 'Support and resistance');
    expect(paste({ 'text/plain': text, 'text/html': `<meta charset="utf-8">${html}` })).toBe(true);
    expect(usual).toBe(0);
    expect(editor.document[0].content).toContainEqual({ type: 'notebookLink', props: { notebookId: 'sr' } });
    expect(editor.document[0].content).not.toContainEqual(expect.objectContaining({ text: expect.stringContaining('[[') }));
  });

  test('plain [[Title]] naming exactly one page pastes as a link chip', () => {
    expect(paste({ 'text/plain': '[[support and resistance]]' })).toBe(true);
    expect(editor.document[0].content).toContainEqual({ type: 'notebookLink', props: { notebookId: 'sr' } });
  });

  test('plain [[Title]] that names no page, or two, pastes as text', () => {
    paste({ 'text/plain': '[[Weekly]]' });
    paste({ 'text/plain': '[[No such page]]' });
    expect(usual).toBe(2);
    expect(editor.document[0].content).not.toContainEqual(expect.objectContaining({ type: 'notebookLink' }));
  });
});
