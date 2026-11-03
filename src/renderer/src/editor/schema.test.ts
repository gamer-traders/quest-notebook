// @vitest-environment jsdom
// Pages written by hand or by an AI can mark text any way the file format allows; the editor must still open them.
import { BlockNoteEditor } from '@blocknote/core';
import { expect, test } from 'vitest';
import { fileToPage } from '../files/convert';
import { schema } from './schema';

const open = (text: string) => {
  const { notebook } = fileToPage(
    { blocks: [{ type: 'paragraph', text }, { type: 'checklist', checked: false, text }] },
    { id: 'p', spaceId: 's', parentId: null, path: 'S/P.json', fileTimeMs: 0, fallbackPosition: 0 },
  );
  return BlockNoteEditor.create({ schema, initialContent: notebook.blocks as never });
};

test.each([
  '**Meal 1 (`~600 kcal`)**',
  '*`a`* ~~`b`~~ <u>`c`</u> ==`d`== =={green}`e`==',
  '[see `docs`](https://a.io)',
  '**[`bold code link`](https://a.io)**',
])('a page with %s opens in the editor', (text) => {
  expect(() => open(text)).not.toThrow();
});
