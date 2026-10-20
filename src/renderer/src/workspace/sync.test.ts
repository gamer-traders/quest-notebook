import { expect, test } from 'vitest';
import type { Notebook, Space } from '../types';
import type { PageBlock } from '../page/blockTypes';
import { baselineFor, planFlush, type SyncSlice } from './sync';

const spaces: Space[] = [{ id: 'sm', name: 'Markets' }, { id: 'sl', name: 'Lessons' }];
const para = (content: unknown[]): PageBlock => ({ id: 'b', type: 'paragraph', props: {}, content, children: [] });
const text = (t: string) => ({ type: 'text', text: t, styles: {} });
const nb = (id: string, title: string, patch: Partial<Notebook> = {}): Notebook => ({
  id, title, spaceId: 'sm', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [para([text(title)])], items: {}, ...patch,
});

function start(notebooks: Notebook[]): { prev: SyncSlice; baseline: ReturnType<typeof baselineFor> } {
  const prev = { notebooks, spaces, journalSpaceId: null };
  return { prev, baseline: baselineFor(prev, new Set()) };
}

const plan = (prev: SyncSlice, next: Partial<SyncSlice>, baseline: ReturnType<typeof baselineFor>, dirty = new Set<string>()) =>
  planFlush(prev, { ...prev, ...next }, baseline, dirty);

test('editing a page saves that page alone', () => {
  const { prev, baseline } = start([nb('n1', 'One'), nb('n2', 'Two')]);
  const edited = prev.notebooks.map((n) => (n.id === 'n1' ? { ...n, blocks: [para([text('changed')])] } : n));
  const { batch } = plan(prev, { notebooks: edited }, baseline);
  expect(batch!.saves.map((s) => s.id)).toEqual(['n1']);
  expect(batch!.saves[0]).toMatchObject({ spaceId: 'sm', parentId: null, title: 'One' });
  expect(JSON.parse(batch!.saves[0].json).blocks).toEqual([{ type: 'paragraph', text: 'changed' }]);
  expect(batch!.deletes).toEqual([]);
  expect(batch!.spaces).toBe(spaces);
});

test('nothing changed, nothing sent', () => {
  const { prev, baseline } = start([nb('n1', 'One')]);
  expect(plan(prev, {}, baseline).batch).toBeNull();
  // A new object with the same content is not a change either.
  expect(plan(prev, { notebooks: prev.notebooks.map((n) => ({ ...n })) }, baseline).batch).toBeNull();
});

test('renaming a page rewrites the pages that link to it', () => {
  const link = { type: 'notebookLink', props: { notebookId: 'n1', target: '' } };
  const { prev, baseline } = start([nb('n1', 'Old title'), nb('n2', 'Reader', { blocks: [para([text('See '), link])] }), nb('n3', 'Other')]);
  const renamed = prev.notebooks.map((n) => (n.id === 'n1' ? { ...n, title: 'New title' } : n));
  const { batch } = plan(prev, { notebooks: renamed }, baseline);
  expect(batch!.saves.map((s) => s.id).sort()).toEqual(['n1', 'n2']);
  expect(JSON.parse(batch!.saves.find((s) => s.id === 'n2')!.json).blocks[0].text).toBe('See [[New title]]');
});

test('a page taking another page’s title makes links to that page name it by path', () => {
  const link = { type: 'notebookLink', props: { notebookId: 'n1', target: '' } };
  const { prev, baseline } = start([nb('n1', 'Notes'), nb('n2', 'Reader', { blocks: [para([link])] }), nb('n3', 'Other', { spaceId: 'sl' })]);
  const clash = prev.notebooks.map((n) => (n.id === 'n3' ? { ...n, title: 'Notes' } : n));
  const { batch } = plan(prev, { notebooks: clash }, baseline);
  expect(JSON.parse(batch!.saves.find((s) => s.id === 'n2')!.json).blocks[0].text).toBe('[[Markets/Notes]]');
});

test('deleting pages sends their ids', () => {
  const { prev, baseline } = start([nb('n1', 'One'), nb('n3', 'Child', { parentId: 'n1' }), nb('n2', 'Two')]);
  const { batch, baseline: after } = plan(prev, { notebooks: prev.notebooks.filter((n) => n.id === 'n2') }, baseline);
  expect(batch!.deletes).toEqual(['n1', 'n3']);
  expect(batch!.saves).toEqual([]);
  expect(after.has('n1')).toBe(false);
});

test('moving a page saves it even when its file text is the same', () => {
  const { prev, baseline } = start([nb('n1', 'One'), nb('n2', 'Two')]);
  const moved = prev.notebooks.map((n) => (n.id === 'n2' ? { ...n, parentId: 'n1' } : n));
  const { batch } = plan(prev, { notebooks: moved }, baseline);
  expect(batch!.saves.map((s) => [s.id, s.parentId])).toEqual([['n2', 'n1']]);
});

test('renaming a space sends the spaces', () => {
  const { prev, baseline } = start([nb('n1', 'One')]);
  const renamed = spaces.map((s) => (s.id === 'sm' ? { ...s, name: 'Crypto' } : s));
  const { batch } = plan(prev, { spaces: renamed }, baseline);
  expect(batch).toEqual({ spaces: renamed, createdSpaces: [], deletedSpaces: [], journalSpaceId: null, saves: [], deletes: [] });
});

test('a page whose file could not be read is never saved', () => {
  const { prev, baseline } = start([nb('bad:x', 'X', { loadError: 'broken' })]);
  const touched = prev.notebooks.map((n) => ({ ...n, title: 'Y' }));
  expect(plan(prev, { notebooks: touched }, baseline, new Set(['bad:x'])).batch).toBeNull();
});

test('pages marked dirty are saved even when unchanged', () => {
  const prev = { notebooks: [nb('n1', 'One')], spaces, journalSpaceId: null };
  const baseline = baselineFor(prev, new Set(['n1']));
  const { batch } = planFlush(prev, prev, baseline, new Set(['n1']));
  expect(batch!.saves.map((s) => s.id)).toEqual(['n1']);
});

test('new and deleted spaces are named in the batch', () => {
  const { prev, baseline } = start([nb('n1', 'One')]);
  const next = [...spaces.filter((s) => s.id !== 'sl'), { id: 'si', name: 'Ideas' }];
  const { batch } = plan(prev, { spaces: next }, baseline);
  expect(batch).toMatchObject({ createdSpaces: ['si'], deletedSpaces: ['sl'] });
});
