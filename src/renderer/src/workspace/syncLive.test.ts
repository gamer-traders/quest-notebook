// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { FlushBatch, QuestApi, WorkspaceSnapshot } from '@shared/ipc';
import { useStore } from '../store';
import { snapshotToState } from './load';
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

const api: QuestApi['workspace'] = {
  flush: async (batch) => {
    batches.push(batch);
    return flushResult();
  },
  saveUi: async () => {},
  onDiskChange: () => () => {},
  onLost: () => () => {},
};

beforeEach(() => {
  batches = [];
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
  expect(JSON.parse(batches[0].saves[0].json).title).toBe('A12');
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
  expect(JSON.parse(batches[0].saves[0].json)).toMatchObject({ id: 'b', title: 'B', position: 0, created: expect.any(String), updated: expect.any(String) });
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
});
