// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { FlushBatch, QuestApi, WorkspaceSnapshot } from '@shared/ipc';
import { useStore } from '../store';
import { unsavedEditors } from '../editor/pending';
import type { PageBlock } from '../page/blockTypes';
import { applyDisk, flushWorkspace, startWorkspace, stopWorkspace } from './session';

const file = (id: string, title: string, text: string) => ({ id, title, position: 0, created: '2026-10-20T00:00:00Z', updated: '2026-10-20T00:00:00Z', blocks: [{ type: 'paragraph', text }] });

const snapshot: WorkspaceSnapshot = {
  root: '/w',
  name: 'W',
  spaces: [{ id: 'sm', name: 'Markets' }, { id: 'sl', name: 'Lessons' }],
  journalSpaceId: null,
  pages: [
    { id: 'a', spaceId: 'sm', parentId: null, path: 'Markets/A.json', mtimeMs: 0, file: file('a', 'A', 'first') },
    { id: 'b', spaceId: 'sm', parentId: null, path: 'Markets/B.json', mtimeMs: 0, file: file('b', 'B', 'bee') },
  ],
  ui: { openPageId: 'a', expanded: [], collapsedPanels: [] },
  isNew: false,
};

let batches: FlushBatch[];

beforeEach(() => {
  batches = [];
  const workspace: QuestApi['workspace'] = {
    flush: async (batch) => {
      batches.push(batch);
      return { ok: true, paths: {} };
    },
    saveUi: async () => {},
    onDiskChange: () => () => {},
    onLost: () => () => {},
  };
  (window as unknown as { quest: Partial<QuestApi> }).quest = { workspace };
  startWorkspace(snapshot);
});

afterEach(async () => {
  await stopWorkspace();
});

const textOf = (json: string) => JSON.parse(json).blocks[0].text;

test('saving before the window closes takes in words still waiting in the editor', async () => {
  // An editor that hasn't handed its last words to the store yet.
  const words: PageBlock[] = [{ id: 'x', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'last words', styles: {} }], children: [] }];
  const stop = unsavedEditors.register('a', () => useStore.getState().setBlocks('a', words));
  unsavedEditors.mark('a');
  try {
    await flushWorkspace();
    expect(batches).toHaveLength(1);
    expect(textOf(batches[0].saves[0].json!)).toBe('last words');
  } finally {
    stop();
  }
});

test('an outside change to a page being edited keeps the edit but follows the page to its new place', () => {
  useStore.getState().updateNotebook('a', { title: 'A edited' });
  applyDisk({
    seq: 1,
    spaces: snapshot.spaces,
    journalSpaceId: null,
    pages: [{ ...snapshot.pages[0], spaceId: 'sl', path: 'Lessons/A.json', file: file('a', 'A', 'from outside') }],
    removed: [],
  });
  const a = useStore.getState().notebooks.find((n) => n.id === 'a')!;
  expect(a.title).toBe('A edited');
  expect(a.spaceId).toBe('sl');
});

test('a page only waiting to have missing fields written back still takes an outside change', () => {
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...snapshot.pages[1], file: { id: 'b', title: 'B', blocks: [{ type: 'paragraph', text: 'v1' }] } }], removed: [] });
  applyDisk({ seq: 2, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...snapshot.pages[1], file: { id: 'b', title: 'B', blocks: [{ type: 'paragraph', text: 'v2' }] } }], removed: [] });
  const b = useStore.getState().notebooks.find((n) => n.id === 'b')!;
  expect((b.blocks[0].content as { text: string }[])[0].text).toBe('v2');
});

test('a drawing changed on disk gets its picture redrawn, without the page file being rewritten', async () => {
  const drawing = { type: 'drawing', id: 'd1', height: 400, background: 'blank', strokes: [{ tool: 'pen', color: 'ink', size: 3, pressure: true, points: '10,10,0.5 90,90,0.5' }] };
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...snapshot.pages[1], file: { ...file('b', 'B', 'bee'), blocks: [drawing] } }], removed: [] });
  await flushWorkspace();
  const save = batches.flatMap((b) => b.saves).find((s) => s.id === 'b')!;
  expect(save.json).toBeUndefined();
  expect(Object.keys(save.sidecars)).toEqual(['drawing-d1.svg']);
});
