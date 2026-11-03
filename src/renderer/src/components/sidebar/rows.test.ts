import { expect, test } from 'vitest';
import type { MarkdownFile, Notebook } from '../../types';
import { visibleRows } from './rows';

const page = (id: string, parentId: string | null, position: number): Notebook => ({ id, title: id.toUpperCase(), spaceId: 'sm', parentId, position, createdAt: 0, updatedAt: 0, blocks: [], items: {} });
const md = (path: string, parentId: string | null, spaceId = 'sm'): MarkdownFile => ({ id: `md:${path}`, path, spaceId, parentId, text: '' });

const pages = [page('a', null, 0), page('b', 'a', 0), page('c', null, 1)];
const files = [md('Markets/zeta.md', null), md('Markets/Alpha.md', null), md('Markets/A/notes.md', 'a'), md('Markets/C/plan.md', 'c'), md('Lessons/other.md', null, 'sl')];

const shown = (expanded: Record<string, boolean>) =>
  visibleRows(pages, files, 'sm', expanded).map((r) => (r.kind === 'page' ? `${'  '.repeat(r.depth)}${r.page.id}${r.hasChildren ? (r.open ? ' -' : ' +') : ''}` : `${'  '.repeat(r.depth)}${r.file.path}`));

test('Markdown files list after the pages beside them, by name', () => {
  expect(shown({ a: true })).toEqual(['a -', '  b', '  Markets/A/notes.md', 'c +', 'Markets/Alpha.md', 'Markets/zeta.md']);
});

test('a page holding only Markdown files can be opened in the sidebar, and its files show when it is', () => {
  expect(shown({ c: true })).toEqual(['a +', 'c -', '  Markets/C/plan.md', 'Markets/Alpha.md', 'Markets/zeta.md']);
});
