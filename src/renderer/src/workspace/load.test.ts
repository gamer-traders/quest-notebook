import { expect, test } from 'vitest';
import type { DiskDelta, PageRecord, WorkspaceSnapshot } from '@shared/ipc';
import type { NotebookLinkInline } from '../page/blockTypes';
import { deltaToNotebooks, snapshotToState } from './load';

const file = (id: string, title: string, extra: object = {}) => ({ id, title, position: 0, created: '2026-10-20T00:00:00Z', updated: '2026-10-20T00:00:00Z', blocks: [], ...extra });
const record = (id: string, path: string, parentId: string | null, f: unknown, spaceId = 'sm'): PageRecord => ({ id, spaceId, parentId, path, mtimeMs: Date.UTC(2026, 9, 21), file: f });

const snapshot = (pages: PageRecord[], ui: Partial<WorkspaceSnapshot['ui']> = {}): WorkspaceSnapshot => ({
  root: '/w',
  name: 'W',
  spaces: [{ id: 'sm', name: 'Markets' }, { id: 'sl', name: 'Lessons' }],
  journalSpaceId: 'sl',
  pages,
  ui: { openPageId: null, expanded: [], collapsedPanels: [], ...ui },
  isNew: false,
});

test('a snapshot becomes the page tree, with links resolved', () => {
  const s = snapshotToState(
    snapshot(
      [
        record('a', 'Markets/A.json', null, file('a', 'A', { position: 1 })),
        record('b', 'Markets/A/B.json', 'a', file('b', 'B', { blocks: [{ type: 'paragraph', text: 'See [[A]]' }] })),
      ],
      { openPageId: 'b', expanded: ['a', 'gone'], collapsedPanels: ['a'] },
    ),
  );
  expect(s.spaces).toEqual([{ id: 'sm', name: 'Markets' }, { id: 'sl', name: 'Lessons' }]);
  expect(s.journalSpaceId).toBe('sl');
  expect(s.notebooks.map((n) => [n.id, n.title, n.parentId, n.spaceId])).toEqual([['a', 'A', null, 'sm'], ['b', 'B', 'a', 'sm']]);
  const link = (s.notebooks[1].blocks[0].content as NotebookLinkInline[]).find((p) => p.type === 'notebookLink')!;
  expect(link.props.notebookId).toBe('a');
  expect(s.activeId).toBe('b');
  expect(s.expanded).toEqual({ a: true });
  expect(s.panelCollapsed).toEqual({ a: true });
  expect(s.repaired.size).toBe(0);
});

test('a page file that could not be read is a page with its error', () => {
  const bad: PageRecord = { id: 'bad:Markets/Bad.json', spaceId: 'sm', parentId: null, path: 'Markets/Bad.json', mtimeMs: 5, error: 'Unexpected token' };
  const s = snapshotToState(snapshot([record('a', 'Markets/A.json', null, file('a', 'A', { position: 3 })), bad]));
  const page = s.notebooks.find((n) => n.id === bad.id)!;
  expect(page).toMatchObject({ title: 'Bad', loadError: 'Unexpected token', blocks: [], items: {}, path: 'Markets/Bad.json', position: 4 });
});

test('a file that is JSON but not a page is unreadable too', () => {
  const s = snapshotToState(snapshot([record('x', 'Markets/X.json', null, { title: 'X' })]));
  expect(s.notebooks[0].loadError).toMatch(/not a page/);
});

test('pages missing fields go after their siblings and are marked repaired', () => {
  const s = snapshotToState(
    snapshot([record('a', 'Markets/A.json', null, file('a', 'A', { position: 5 })), record('n', 'Markets/New.json', null, { blocks: [] })]),
  );
  const added = s.notebooks.find((n) => n.id === 'n')!;
  expect(added).toMatchObject({ title: 'New', position: 6 });
  expect([...s.repaired]).toEqual(['n']);
});

test('with no open page saved, the first page of the first space opens', () => {
  const s = snapshotToState(snapshot([record('l', 'Lessons/L.json', null, file('l', 'L'), 'sl'), record('m', 'Markets/M.json', null, file('m', 'M'))]));
  expect(s.activeId).toBe('m');
});

test('a delta keeps positions of pages that lose theirs, and a renamed file renames the page', () => {
  const current = snapshotToState(snapshot([record('a', 'Markets/A.json', null, file('a', 'A', { position: 2 }))])).notebooks;
  const delta: DiskDelta = {
    seq: 1,
    spaces: [{ id: 'sm', name: 'Markets' }],
    journalSpaceId: null,
    pages: [{ ...record('a', 'Markets/Alpha.json', null, { id: 'a', title: 'A', blocks: [] }), titleFromPath: 'Alpha' }],
    removed: [],
  };
  const { upserts, repaired } = deltaToNotebooks(delta, current);
  expect(upserts[0]).toMatchObject({ id: 'a', title: 'Alpha', position: 2, path: 'Markets/Alpha.json' });
  expect([...repaired]).toEqual(['a']);
});
