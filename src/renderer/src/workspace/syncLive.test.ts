// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { FlushBatch, QuestApi, UiState, WorkspaceSnapshot } from '@shared/ipc';
import { useStore } from '../store';
import { snapshotToState } from './load';
import { drawingToSvg } from '../drawing/svg';
import { startSync, useSaveStatus, type SyncHandle } from './sync';

const file = (id: string, title: string, text = '') => ({
  id, title, position: 0, created: '2026-10-20T00:00:00Z', updated: '2026-10-20T00:00:00Z', blocks: [{ type: 'paragraph', text }],
});

const snapshot: WorkspaceSnapshot = {
  root: '/w',
  name: 'W',
  spaces: [{ id: 'sm', name: 'Markets' }],
  journalSpaceId: null,
  pages: [
    { id: 'a', spaceId: 'sm', parentId: null, path: 'Markets/A.json', mtimeMs: 0, file: file('a', 'A', 'first') },
    { id: 'b', spaceId: 'sm', parentId: null, path: 'Markets/B.json', mtimeMs: 0, file: file('b', 'B') },
  ],
  ui: { openPageId: 'a', expanded: [], collapsedPanels: [] },
  isNew: false,
};

let batches: FlushBatch[];
let sync: SyncHandle;
let flushResult: () => Promise<{ ok: boolean; error?: string; paths: Record<string, string> }>;
let uiSaves: UiState[];

const api: QuestApi['workspace'] = {
  flush: async (batch) => {
    batches.push(batch);
    return flushResult();
  },
  saveMarkdown: async () => ({ ok: true }),
  saveUi: async (ui) => void uiSaves.push(ui),
  onDiskChange: () => () => {},
  onLost: () => () => {},
};

beforeEach(() => {
  batches = [];
  uiSaves = [];
  flushResult = async () => ({ ok: true, paths: {} });
  useSaveStatus.setState({ error: null });
  const loaded = snapshotToState(snapshot);
  useStore.getState().loadWorkspace('/w', 'W', loaded);
  sync = startSync(api, useStore, loaded.repaired);
});

afterEach(() => {
  sync.stop();
  vi.useRealTimers();
});

test('loading a workspace sends nothing back', async () => {
  await sync.flush();
  expect(batches).toEqual([]);
});

test('a change from disk is not sent back, and a later edit sends only that page', async () => {
  sync.applyFromDisk(() =>
    useStore.getState().applyDiskDelta({
      seq: 1,
      spaces: snapshot.spaces,
      journalSpaceId: null,
      pages: [{ ...snapshot.pages[0], file: file('a', 'A', 'written by an AI') }],
      removed: [],
    }),
  );
  expect(useStore.getState().diskRevision).toEqual({ a: 1 });
  expect(sync.pendingIds()).toEqual(new Set());
  await sync.flush();
  expect(batches).toEqual([]);

  useStore.getState().updateNotebook('b', { title: 'B edited' });
  expect(sync.pendingIds()).toEqual(new Set(['b']));
  await sync.flush();
  expect(batches).toHaveLength(1);
  expect(batches[0].saves.map((s) => s.id)).toEqual(['b']);
});

test('edits are batched a moment after the last one', async () => {
  vi.useFakeTimers();
  useStore.getState().updateNotebook('a', { title: 'A1' });
  useStore.getState().updateNotebook('a', { title: 'A12' });
  await vi.advanceTimersByTimeAsync(299);
  expect(batches).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(10);
  expect(batches).toHaveLength(1);
  expect(JSON.parse(batches[0].saves[0].json!).title).toBe('A12');
});

test('a failed save shows the error and is tried again', async () => {
  vi.useFakeTimers();
  flushResult = async () => ({ ok: false, error: 'Disk full', paths: {} });
  useStore.getState().updateNotebook('a', { title: 'A2' });
  await sync.flush();
  expect(useSaveStatus.getState().error).toBe('Disk full');
  flushResult = async () => ({ ok: true, paths: { a: 'Markets/A2.json' } });
  await vi.advanceTimersByTimeAsync(3000);
  expect(batches).toHaveLength(2);
  expect(batches[1].saves.map((s) => s.id)).toEqual(['a']);
  expect(useSaveStatus.getState().error).toBeNull();
});

test('a page marked dirty after a change from disk is written back, even though nothing in it changed', async () => {
  sync.applyFromDisk(() =>
    useStore.getState().applyDiskDelta({
      seq: 1,
      spaces: snapshot.spaces,
      journalSpaceId: null,
      pages: [{ ...snapshot.pages[1], file: { id: 'b', title: 'B', blocks: [] } }],
      removed: [],
    }),
  );
  sync.markDirty(['b']);
  await sync.flush();
  expect(batches).toHaveLength(1);
  expect(batches[0].saves.map((s) => s.id)).toEqual(['b']);
  expect(JSON.parse(batches[0].saves[0].json!)).toMatchObject({ id: 'b', title: 'B', position: 0, created: expect.any(String), updated: expect.any(String) });
});

const fromDisk = (record: WorkspaceSnapshot['pages'][number]) =>
  sync.applyFromDisk(() => useStore.getState().applyDiskDelta({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [record], removed: [] }), 1);

test('a page written back only to fill in what the disk left is sent as a repair', async () => {
  fromDisk({ ...snapshot.pages[1], file: { id: 'b', title: 'B', blocks: [] } });
  sync.markDirty(['b']);
  await sync.flush();
  expect(batches).toHaveLength(1);
  expect(batches[0].saves.map((s) => s.id)).toEqual(['b']);
  expect(batches[0].repairs).toEqual(['b']);
});

test('a repair the owner edits before it is saved is an edit, not a repair', async () => {
  fromDisk({ ...snapshot.pages[1], file: { id: 'b', title: 'B', blocks: [] } });
  sync.markDirty(['b']);
  useStore.getState().updateNotebook('b', { title: 'B edited' });
  await sync.flush();
  expect(batches[0].saves.map((s) => s.id)).toEqual(['b']);
  expect(batches[0]).not.toHaveProperty('repairs');
});

test('drawings written to their files for a page from disk make that page a repair too', async () => {
  const inline = { type: 'drawing', id: 'd1', strokes: [{ tool: 'pen', points: '10,10,0.5 60,60,0.5' }] };
  fromDisk({ ...snapshot.pages[1], file: { ...file('b', 'B'), blocks: [inline] } });
  sync.writeDrawings('b', ['d1']);
  await sync.flush();
  expect(batches[0].saves.map((s) => s.id)).toEqual(['b']);
  expect(Object.keys(batches[0].saves[0].sidecars)).toEqual(['drawing-d1.svg']);
  expect(batches[0].repairs).toEqual(['b']);
});

test('an edit never sends repairs, and a repair saved beside an edit is the only one named', async () => {
  useStore.getState().updateNotebook('a', { title: 'A edited' });
  await sync.flush();
  expect(batches[0].saves.map((s) => s.id)).toEqual(['a']);
  expect(batches[0]).not.toHaveProperty('repairs');

  fromDisk({ ...snapshot.pages[1], file: { id: 'b', title: 'B', blocks: [] } });
  sync.markDirty(['b']);
  useStore.getState().updateNotebook('a', { title: 'A edited again' });
  await sync.flush();
  expect(batches[1].saves.map((s) => s.id).sort()).toEqual(['a', 'b']);
  expect(batches[1].repairs).toEqual(['b']);

  // Once sent, the page is no longer a repair: an edit to it later is an edit.
  useStore.getState().updateNotebook('b', { title: 'B edited' });
  await sync.flush();
  expect(batches[2].saves.map((s) => s.id)).toEqual(['b']);
  expect(batches[2]).not.toHaveProperty('repairs');
});

test('a repair whose save failed is still a repair when it is tried again', async () => {
  vi.useFakeTimers();
  flushResult = async () => ({ ok: false, error: 'Disk full', paths: {} });
  fromDisk({ ...snapshot.pages[1], file: { id: 'b', title: 'B', blocks: [] } });
  sync.markDirty(['b']);
  await sync.flush();
  expect(batches[0].repairs).toEqual(['b']);
  flushResult = async () => ({ ok: true, paths: { b: 'Markets/B.json' } });
  await vi.advanceTimersByTimeAsync(3000);
  expect(batches).toHaveLength(2);
  expect(batches[1].repairs).toEqual(['b']);
});

test('pages missing fields when the workspace loads are written back without waiting for an edit', async () => {
  sync.stop();
  vi.useFakeTimers();
  const loaded = snapshotToState({ ...snapshot, pages: [{ ...snapshot.pages[0], file: { id: 'a', title: 'A', blocks: [] } }] });
  useStore.getState().loadWorkspace('/w', 'W', loaded);
  sync = startSync(api, useStore, loaded.repaired);
  await vi.advanceTimersByTimeAsync(400);
  expect(batches).toHaveLength(1);
  expect(batches[0].saves.map((s) => s.id)).toEqual(['a']);
  // Nothing was edited here: the page is only filled in.
  expect(batches[0].repairs).toEqual(['a']);
});

test('a window that loaded the workspace after outside changes starts out having seen them', async () => {
  sync.stop();
  const loaded = snapshotToState(snapshot);
  useStore.getState().loadWorkspace('/w', 'W', loaded);
  sync = startSync(api, useStore, loaded.repaired, new Map(), 7);
  useStore.getState().updateNotebook('a', { title: 'A after reload' });
  await sync.flush();
  expect(batches[0].seenSeq).toBe(7);
});

test('batches say which disk change the window has seen, and saves refused as stale are planned again', async () => {
  vi.useFakeTimers();
  sync.applyFromDisk(() => useStore.getState().applyDiskDelta({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [], removed: [] }), 4);
  flushResult = async () => ({ ok: true, paths: {}, stale: ['a'] });
  useStore.getState().updateNotebook('a', { title: 'A3' });
  await sync.flush();
  expect(batches[0].seenSeq).toBe(4);
  flushResult = async () => ({ ok: true, paths: { a: 'Markets/A3.json' } });
  await vi.advanceTimersByTimeAsync(400);
  expect(batches).toHaveLength(2);
  expect(batches[1].saves.map((s) => s.id)).toEqual(['a']);
});

test('a page whose save failed or was refused as stale counts as unsaved until it is saved', async () => {
  vi.useFakeTimers();
  flushResult = async () => ({ ok: false, error: 'Disk full', paths: {} });
  useStore.getState().updateNotebook('a', { title: 'A failed' });
  await sync.flush();
  expect(sync.pendingIds().has('a')).toBe(true);
  flushResult = async () => ({ ok: true, paths: {}, stale: ['a'] });
  await vi.advanceTimersByTimeAsync(3000);
  expect(sync.pendingIds().has('a')).toBe(true);
  flushResult = async () => ({ ok: true, paths: { a: 'Markets/A.json' } });
  await vi.advanceTimersByTimeAsync(400);
  expect(sync.pendingIds().has('a')).toBe(false);
});

test('a page delete whose save failed is sent again', async () => {
  vi.useFakeTimers();
  flushResult = async () => ({ ok: false, error: 'Disk full', paths: {} });
  useStore.getState().deletePage('b');
  await sync.flush();
  expect(batches[0].deletes).toEqual(['b']);
  flushResult = async () => ({ ok: true, paths: {} });
  await vi.advanceTimersByTimeAsync(3000);
  expect(batches).toHaveLength(2);
  expect(batches[1].deletes).toEqual(['b']);
  await vi.advanceTimersByTimeAsync(3000);
  expect(batches).toHaveLength(2);
});

test('a page delete is sent again when main could not be reached', async () => {
  vi.useFakeTimers();
  flushResult = async () => {
    throw new Error('No answer');
  };
  useStore.getState().deletePage('b');
  await sync.flush();
  flushResult = async () => ({ ok: true, paths: {} });
  await vi.advanceTimersByTimeAsync(3000);
  expect(batches.map((b) => b.deletes)).toEqual([['b'], ['b']]);
});

test('a page delete refused as stale is planned again, and a page that comes back from disk stays', async () => {
  vi.useFakeTimers();
  flushResult = async () => ({ ok: true, paths: {}, stale: ['b'] });
  useStore.getState().deletePage('b');
  await sync.flush();
  // Not an edit waiting to be saved: the outside change to the page still reaches the window.
  expect(sync.pendingIds().has('b')).toBe(false);
  await vi.advanceTimersByTimeAsync(400);
  expect(batches.map((b) => b.deletes)).toEqual([['b'], ['b']]);

  flushResult = async () => ({ ok: true, paths: {} });
  sync.applyFromDisk(
    () =>
      useStore.getState().applyDiskDelta({
        seq: 1,
        spaces: snapshot.spaces,
        journalSpaceId: null,
        pages: [{ ...snapshot.pages[1], file: file('b', 'B', 'written by an AI') }],
        removed: [],
      }),
    1,
  );
  await vi.advanceTimersByTimeAsync(400);
  await sync.flush();
  expect(batches).toHaveLength(2);
  expect(useStore.getState().notebooks.some((n) => n.id === 'b')).toBe(true);
});

test('a space made in a save that failed is made on the next try', async () => {
  vi.useFakeTimers();
  flushResult = async () => ({ ok: false, error: 'Disk full', paths: {} });
  const id = useStore.getState().createSpace('Ideas');
  await sync.flush();
  expect(batches[0].createdSpaces).toEqual([id]);
  flushResult = async () => ({ ok: true, paths: {} });
  await vi.advanceTimersByTimeAsync(3000);
  expect(batches).toHaveLength(2);
  expect(batches[1].createdSpaces).toEqual([id]);
});

test('a space deleted or renamed in a save that failed is sent again', async () => {
  vi.useFakeTimers();
  const id = useStore.getState().createSpace('Ideas');
  await sync.flush();
  flushResult = async () => {
    throw new Error('No answer');
  };
  useStore.getState().deleteSpace(id);
  useStore.getState().renameSpace('sm', 'Crypto');
  await sync.flush();
  expect(batches[1]).toMatchObject({ deletedSpaces: [id], spaces: [{ id: 'sm', name: 'Crypto' }] });
  flushResult = async () => ({ ok: true, paths: {} });
  await vi.advanceTimersByTimeAsync(3000);
  expect(batches).toHaveLength(3);
  expect(batches[2]).toMatchObject({ createdSpaces: [], deletedSpaces: [id], spaces: [{ id: 'sm', name: 'Crypto' }] });
});

test('a drawing-only save refused as stale is sent next time as the whole page, with its drawing', async () => {
  sync.stop();
  vi.useFakeTimers();
  const stroke = { id: 's', tool: 'pen' as const, color: 'ink' as const, size: 3, pressure: true, points: [10, 10, 0.5, 60, 60, 0.5] };
  const drawn = { ...file('a', 'A'), blocks: [{ type: 'drawing', id: 'd1', file: 'drawing-d1.svg' }] };
  const record = { ...snapshot.pages[0], file: drawn, drawings: { 'drawing-d1.svg': drawingToSvg({ height: 400, background: 'blank', strokes: [stroke] }) } };
  const loaded = snapshotToState({ ...snapshot, pages: [record] });
  useStore.getState().loadWorkspace('/w', 'W', loaded);
  sync = startSync(api, useStore, loaded.repaired, loaded.drawingsToWrite);

  flushResult = async () => ({ ok: true, paths: {}, stale: ['a'] });
  sync.writeDrawings('a', ['d1']);
  await sync.flush();
  expect(batches[0].saves[0].json).toBeUndefined();
  flushResult = async () => ({ ok: true, paths: { a: 'Markets/A.json' } });
  await vi.advanceTimersByTimeAsync(400);
  expect(batches).toHaveLength(2);
  expect(batches[1].saves[0].json).toBeDefined();
  expect(Object.keys(batches[1].saves[0].sidecars)).toEqual(['drawing-d1.svg']);
});

test('folded spaces are saved with what the window shows, by folder name, and follow a rename', async () => {
  vi.useFakeTimers();
  useStore.getState().toggleSpace('sm');
  await vi.advanceTimersByTimeAsync(1100);
  expect(uiSaves.at(-1)?.collapsedSpaces).toEqual(['Markets']);
  useStore.getState().renameSpace('sm', 'Crypto');
  await vi.advanceTimersByTimeAsync(1100);
  expect(uiSaves.at(-1)?.collapsedSpaces).toEqual(['Crypto']);
});
