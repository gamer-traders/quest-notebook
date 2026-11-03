// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { FlushBatch, QuestApi, WorkspaceSnapshot } from '@shared/ipc';
import { useStore } from '../store';
import { useClaude } from '../claude/store';
import type { DrawingCell } from '../types';
import { unsavedEditors } from '../editor/pending';
import { markdownSaves } from '../markdown/saving';
import type { PageBlock } from '../page/blockTypes';
import { applyDisk, flushWorkspace, startWorkspace, stopWorkspace, useDiskNotice } from './session';

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
    saveMarkdown: async () => ({ ok: true }),
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
    unsavedEditors.clear('a');
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

const handmade = '<svg viewBox="0 0 1000 300"><path data-points="10,10 90,90,0.8"/></svg>';
const drawingPageFile = (text: string) => ({ ...file('b', 'B', text), blocks: [{ type: 'paragraph', text }, { type: 'drawing', id: 'd1', file: 'drawing-d1.svg' }] });
const d1 = () => useStore.getState().notebooks.find((n) => n.id === 'b')!.items.d1 as DrawingCell;

test('a drawing file written by hand is shown, and left as it is', async () => {
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...snapshot.pages[1], file: drawingPageFile('bee'), drawings: { 'drawing-d1.svg': handmade } }], removed: [] });
  expect(d1().strokes).toHaveLength(1);
  await flushWorkspace();
  expect(batches.flatMap((b) => b.saves).filter((s) => s.id === 'b')).toEqual([]);
});

test('a page written back for a missing field doesn’t rewrite its drawings', async () => {
  const missing = { blocks: [{ type: 'drawing', id: 'd1', file: 'drawing-d1.svg' }] };
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...snapshot.pages[1], file: missing, drawings: { 'drawing-d1.svg': handmade } }], removed: [] });
  await flushWorkspace();
  const save = batches.flatMap((b) => b.saves).find((s) => s.id === 'b')!;
  expect(save.json).toBeDefined();
  expect(save.sidecars).toEqual({});
});

test('a page from disk tidied by the window (fields filled in, inline strokes moved to their file) is saved as a repair', async () => {
  const inline = { blocks: [{ type: 'paragraph', text: 'bee' }, { type: 'drawing', id: 'd1', strokes: [{ tool: 'pen', points: '10,10,0.5 60,60,0.5' }] }] };
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...snapshot.pages[1], file: inline }, pageC], removed: [] });
  await flushWorkspace();
  const saves = batches.flatMap((b) => b.saves);
  expect(saves.map((s) => s.id)).toEqual(['b']);
  expect(Object.keys(saves[0].sidecars)).toEqual(['drawing-d1.svg']);
  expect(JSON.parse(saves[0].json!).blocks[1]).toEqual({ type: 'drawing', id: 'd1', file: 'drawing-d1.svg' });
  expect(batches.flatMap((b) => b.repairs ?? [])).toEqual(['b']);
});

test('an outside change to a drawing reaches a page that is being typed on', async () => {
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...snapshot.pages[1], file: drawingPageFile('bee'), drawings: { 'drawing-d1.svg': handmade } }], removed: [] });
  await flushWorkspace();
  batches = [];
  useStore.getState().updateNotebook('b', { title: 'B edited' });
  const threeStrokes = '<svg viewBox="0 0 1000 300"><path data-points="10,10 90,90,0.8"/><path data-points="20,20 30,30"/><path data-points="40,40 50,50"/></svg>';
  applyDisk({ seq: 2, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...snapshot.pages[1], file: drawingPageFile('bee'), drawings: { 'drawing-d1.svg': threeStrokes } }], removed: [] });
  // The typed title stays, and the drawing shows the outside strokes.
  expect(useStore.getState().notebooks.find((n) => n.id === 'b')!.title).toBe('B edited');
  expect(d1().strokes).toHaveLength(3);
  await flushWorkspace();
  const save = batches.flatMap((b) => b.saves).find((s) => s.id === 'b')!;
  expect(JSON.parse(save.json!).title).toBe('B edited');
  // The outside drawing is on disk already: it isn't sent back.
  expect(save.sidecars).toEqual({});
});

test('a drawing file whose block was removed on disk is left alone', async () => {
  const page = { ...file('b', 'B', 'bee'), blocks: [{ type: 'drawing', id: 'd1', file: 'drawing-d1.svg' }] };
  const svg = '<svg viewBox="0 0 1000 400"><path data-points="10,10 90,90,0.8"/></svg>';
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...snapshot.pages[1], file: page, drawings: { 'drawing-d1.svg': svg } }], removed: [] });
  await flushWorkspace();
  batches = [];
  applyDisk({ seq: 2, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...snapshot.pages[1], file: file('b', 'B', 'no drawing now'), drawings: { 'drawing-d1.svg': svg } }], removed: [] });
  await flushWorkspace();
  expect(batches.flatMap((b) => b.saves).filter((s) => s.id === 'b')).toEqual([]);
});

test('a page deleted outside while being edited is saved again whole, with every drawing', async () => {
  const svg = '<svg viewBox="0 0 1000 400"><path data-points="10,10 90,90,0.8"/></svg>';
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...snapshot.pages[1], file: drawingPageFile('bee'), drawings: { 'drawing-d1.svg': svg } }], removed: [] });
  await flushWorkspace();
  batches = [];
  useStore.getState().updateNotebook('b', { title: 'B edited' });
  // The page's file and folder go, drawings and all.
  applyDisk({ seq: 2, spaces: snapshot.spaces, journalSpaceId: null, pages: [], removed: ['b'] });
  expect(useStore.getState().notebooks.some((n) => n.id === 'b')).toBe(true);
  await flushWorkspace();
  const save = batches.flatMap((b) => b.saves).find((s) => s.id === 'b')!;
  expect(JSON.parse(save.json!).title).toBe('B edited');
  expect(Object.keys(save.sidecars)).toEqual(['drawing-d1.svg']);
});

test('a page deleted outside while being edited is saved again, and a notice says so', () => {
  useStore.getState().updateNotebook('b', { title: 'B edited' });
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [], removed: ['a', 'b'] });
  expect(useDiskNotice.getState().text).toContain('“B edited”');
  expect(useDiskNotice.getState().text).not.toContain('“A”');
});

test('a page deleted outside that nobody was editing goes quietly', () => {
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [], removed: ['a'] });
  expect(useDiskNotice.getState().text).toBeNull();
});

test('opening a workspace clears the notice', () => {
  useStore.getState().updateNotebook('b', { title: 'B edited' });
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [], removed: ['b'] });
  startWorkspace(snapshot);
  expect(useDiskNotice.getState().text).toBeNull();
});

const subPage = { id: 'c', spaceId: 'sm', parentId: 'a', path: 'Markets/A/C.json', mtimeMs: 0, file: { ...file('c', 'C', 'sea'), position: 3 } };
const page = (id: string) => useStore.getState().notebooks.find((n) => n.id === id);

test('a sub-page being edited whose parent was deleted outside moves to the top of its space, and is saved there', async () => {
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [subPage], removed: [] });
  await flushWorkspace();
  batches = [];
  useStore.getState().updateNotebook('c', { title: 'C edited' });
  applyDisk({ seq: 2, spaces: snapshot.spaces, journalSpaceId: null, pages: [], removed: ['a', 'c'] });
  expect(page('a')).toBeUndefined();
  expect(page('c')).toMatchObject({ spaceId: 'sm', parentId: null });
  // After the pages already at the top.
  expect(page('c')!.position).toBeGreaterThan(page('b')!.position);
  await flushWorkspace();
  const save = batches.flatMap((b) => b.saves).find((s) => s.id === 'c')!;
  expect(save).toMatchObject({ spaceId: 'sm', parentId: null });
});

test('a page being edited whose space was deleted outside moves to the top of the first space left', async () => {
  useStore.getState().updateNotebook('b', { title: 'B edited' });
  applyDisk({ seq: 1, spaces: [{ id: 'sl', name: 'Lessons' }], journalSpaceId: null, pages: [], removed: ['a', 'b'] });
  expect(page('b')).toMatchObject({ spaceId: 'sl', parentId: null });
  await flushWorkspace();
  expect(batches.flatMap((b) => b.saves).find((s) => s.id === 'b')).toMatchObject({ spaceId: 'sl', parentId: null });
});

test('a sub-page kept with its parent, both being edited, stays under it when their space goes', async () => {
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...subPage, parentId: 'b', path: 'Markets/B/C.json' }], removed: [] });
  await flushWorkspace();
  useStore.getState().updateNotebook('b', { title: 'B edited' });
  useStore.getState().updateNotebook('c', { title: 'C edited' });
  applyDisk({ seq: 2, spaces: [{ id: 'sl', name: 'Lessons' }], journalSpaceId: null, pages: [], removed: ['a', 'b', 'c'] });
  expect(page('b')).toMatchObject({ spaceId: 'sl', parentId: null });
  expect(page('c')).toMatchObject({ spaceId: 'sl', parentId: 'b' });
  expect(useDiskNotice.getState().text).toContain('“B edited” and “C edited”');
});

test('saving before the window closes waits for Markdown files still being written', async () => {
  let saved = false;
  const forget = markdownSaves.register(async () => {
    await Promise.resolve();
    saved = true;
  });
  try {
    await flushWorkspace();
    expect(saved).toBe(true);
  } finally {
    forget();
  }
});

const pageC = { id: 'c', spaceId: 'sm', parentId: null, path: 'Markets/C.json', mtimeMs: 0, file: file('c', 'C', 'new') };

test("during a turn, a change skipped for a page's unsaved edits is marked as not applied to the reply", () => {
  useClaude.setState({ running: { chatId: 'c1', messageId: 'm1', lockedPageId: null } });
  useStore.getState().updateNotebook('a', { title: 'A edited' });
  useStore.getState().updateNotebook('b', { title: 'B edited' });
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...snapshot.pages[0], file: file('a', 'A', 'from Claude') }, pageC], removed: ['b'] });
  // a and b keep their edits; c had none, so it came in.
  expect(useClaude.getState().notApplied).toEqual({ m1: ['a', 'b'] });
  expect(useStore.getState().notebooks.some((n) => n.id === 'c')).toBe(true);
});

test('with no turn running, a skipped change is not marked', () => {
  useStore.getState().updateNotebook('a', { title: 'A edited' });
  applyDisk({ seq: 1, spaces: snapshot.spaces, journalSpaceId: null, pages: [{ ...snapshot.pages[0], file: file('a', 'A', 'from outside') }], removed: [] });
  expect(useClaude.getState().notApplied).toEqual({});
});
