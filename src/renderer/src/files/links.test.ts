import { expect, test } from 'vitest';
import type { Notebook, Space } from '../types';
import type { NotebookLinkInline, PageBlock } from '../page/blockTypes';
import { findLinkTarget, linkWriter, linksTo, resolveLinks } from './links';

const spaces: Space[] = [
  { id: 'm', name: 'Markets' },
  { id: 'l', name: 'Lessons' },
];

const link = (notebookId: string, target = ''): NotebookLinkInline => ({ type: 'notebookLink', props: { notebookId, target } });

const page = (id: string, title: string, spaceId = 'm', parentId: string | null = null, content: unknown[] = []): Notebook => ({
  id, title, spaceId, parentId, position: 0, createdAt: 0, updatedAt: 0, items: {},
  blocks: [{ id: `b-${id}`, type: 'paragraph', props: {}, content, children: [] } as PageBlock],
});

const linkIn = (nb: Notebook) => (nb.blocks[0].content as NotebookLinkInline[]).find((p) => p.type === 'notebookLink')!;

test('a link is written with its page title, or its path when another page shares the title', () => {
  const notebooks = [page('w', 'Weekly levels'), page('a', 'Notes', 'm'), page('b', 'Notes', 'l'), page('c', 'Child', 'l', 'b')];
  const write = linkWriter(notebooks, spaces);
  expect(write(link('w'))).toBe('Weekly levels');
  expect(write(link('a'))).toBe('Markets/Notes');
  expect(write(link('b'))).toBe('Lessons/Notes');
  expect(write(link('c'))).toBe('Child');
});

test('titles clash ignoring case, and an empty title reads as Untitled', () => {
  const write = linkWriter([page('a', 'notes'), page('b', 'Notes', 'l'), page('u', '  ')], spaces);
  expect(write(link('a'))).toBe('Markets/notes');
  expect(write(link('u'))).toBe('Untitled');
});

test('a link to a page that is gone keeps the words it was written with', () => {
  const write = linkWriter([], spaces);
  expect(write(link('gone', 'Old idea'))).toBe('Old idea');
  expect(write(link('gone'))).toBe('Deleted notebook');
});

test('links read from files resolve by title, then by path', () => {
  const notebooks = [
    page('w', 'Weekly levels'),
    page('a', 'Notes', 'm'),
    page('b', 'Notes', 'l'),
    page('x', 'Reader', 'l', null, [{ type: 'text', text: 'See ', styles: {} }, link('', 'weekly levels'), link('', 'Markets/Notes'), link('', 'Notes'), link('', 'Nowhere')]),
  ];
  const resolved = resolveLinks(notebooks, spaces);
  const parts = (resolved[3].blocks[0].content as NotebookLinkInline[]).filter((p) => p.type === 'notebookLink');
  expect(parts.map((p) => p.props.notebookId)).toEqual(['w', 'a', 'b', '']);
  // Notebooks without links to resolve are the same objects.
  expect(resolved[0]).toBe(notebooks[0]);
  expect(resolved[1]).toBe(notebooks[1]);
});

test('links inside nested blocks resolve too, and already resolved links are left alone', () => {
  const nested = page('x', 'Reader');
  nested.blocks[0].children = [{ id: 'c', type: 'paragraph', props: {}, content: [link('', 'Target')], children: [] }];
  const done = page('y', 'Done', 'm', null, [link('t')]);
  const resolved = resolveLinks([page('t', 'Target'), nested, done], spaces);
  expect(linkIn({ ...resolved[1], blocks: resolved[1].blocks[0].children })).toMatchObject({ props: { notebookId: 't' } });
  expect(resolved[2]).toBe(done);
});

test('linksTo lists the pages a page links to', () => {
  expect(linksTo(page('x', 'X', 'm', null, [link('a'), link('b'), link('', 'Nowhere')]))).toEqual(new Set(['a', 'b']));
});

test('findLinkTarget finds the page a link names, for a link written before its page existed', () => {
  const notebooks = [page('w', 'Weekly levels'), page('a', 'Notes', 'm'), page('b', 'Notes', 'l')];
  expect(findLinkTarget(notebooks, spaces, 'Weekly Levels', 'm')).toBe('w');
  expect(findLinkTarget(notebooks, spaces, 'Lessons/Notes', 'm')).toBe('b');
  expect(findLinkTarget(notebooks, spaces, 'Notes', 'l')).toBe('b');
  expect(findLinkTarget(notebooks, spaces, 'Nowhere', 'm')).toBeNull();
});
