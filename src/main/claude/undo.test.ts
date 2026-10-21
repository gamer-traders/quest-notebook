import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FileChange } from '@shared/ipc';
import { expect, test } from 'vitest';
import { undoChanges } from './undo';

async function workspace(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'quest-undo-'));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), text);
  }
  return root;
}
const exists = (abs: string) => stat(abs).then(() => true, () => false);
const trashed: string[] = [];
const trash = async (abs: string) => {
  trashed.push(abs);
  await rm(abs, { recursive: true });
};
const edit = (path: string, before: string, after: string): FileChange => ({ path, kind: 'edited', drawing: false, before, after });
const created = (path: string, after: string, drawing = false): FileChange => ({ path, kind: 'created', drawing, before: null, after });

test('restores the exact old text, over invalid JSON too', async () => {
  const old = '{\n  "id": "a",  "blocks": []\n}\n';
  const root = await workspace({ 'Markets/A.json': '{ not json' });
  const result = await undoChanges(root, [edit('Markets/A.json', old, '{ not json')], { force: false, trash });
  expect(result).toEqual({ undone: ['Markets/A.json'], conflicts: [] });
  expect(await readFile(join(root, 'Markets/A.json'), 'utf8')).toBe(old);
});

test('recreates a missing folder when restoring', async () => {
  const root = await workspace({ 'Markets/x.json': '' });
  await rm(join(root, 'Markets'), { recursive: true });
  // the file is gone, so it differs from after: force
  await undoChanges(root, [edit('Markets/A.json', 'old', 'new')], { force: true, trash });
  expect(await readFile(join(root, 'Markets/A.json'), 'utf8')).toBe('old');
});

test('trashes created files and the empty folder they leave, but never the space', async () => {
  const root = await workspace({ 'Markets/New.json': 'p', 'Markets/New/drawing-d.svg': '<svg/>' });
  const result = await undoChanges(root, [created('Markets/New.json', 'p'), created('Markets/New/drawing-d.svg', '<svg/>', true)], { force: false, trash });
  expect(result.undone.sort()).toEqual(['Markets/New.json', 'Markets/New/drawing-d.svg']);
  expect(await exists(join(root, 'Markets/New'))).toBe(false);
  expect(await exists(join(root, 'Markets/New.json'))).toBe(false);
  expect(await exists(join(root, 'Markets'))).toBe(true);
});

test('a created file that is already gone is not an error', async () => {
  const root = await workspace({ 'Markets/x.json': 'k' });
  const result = await undoChanges(root, [{ ...created('Markets/B.json', 'p'), after: null }], { force: false, trash });
  expect(result.conflicts).toEqual([]);
});

test('a file changed after the turn is a conflict and is left alone', async () => {
  const root = await workspace({ 'Markets/A.json': 'edited by the owner' });
  const result = await undoChanges(root, [edit('Markets/A.json', 'old', 'by claude')], { force: false, trash });
  expect(result).toEqual({ undone: [], conflicts: ['Markets/A.json'] });
  expect(await readFile(join(root, 'Markets/A.json'), 'utf8')).toBe('edited by the owner');
});

test('force overwrites anyway', async () => {
  const root = await workspace({ 'Markets/A.json': 'edited by the owner' });
  const result = await undoChanges(root, [edit('Markets/A.json', 'old', 'by claude')], { force: true, trash });
  expect(result).toEqual({ undone: ['Markets/A.json'], conflicts: [] });
  expect(await readFile(join(root, 'Markets/A.json'), 'utf8')).toBe('old');
});

test('a path outside the workspace is refused', async () => {
  const root = await workspace({});
  await expect(undoChanges(root, [edit('../x.json', 'a', 'b')], { force: true, trash })).rejects.toThrow(/outside/);
  expect(await exists(join(root, '../x.json'))).toBe(false);
});

test('a space folder the turn created goes with its created page', async () => {
  const root = await workspace({ 'Markets/x.json': 'k', 'NewSpace/Page.json': 'p' });
  await undoChanges(root, [{ ...created('NewSpace/Page.json', 'p'), newSpace: true }], { force: false, trash });
  expect(await exists(join(root, 'NewSpace'))).toBe(false);
  expect(await exists(join(root, 'Markets'))).toBe(true);
});

test('without the flag the space folder stays', async () => {
  const root = await workspace({ 'NewSpace/Page.json': 'p' });
  await undoChanges(root, [created('NewSpace/Page.json', 'p')], { force: false, trash });
  expect(await exists(join(root, 'NewSpace'))).toBe(true);
});

test('a flagged space folder that still holds another file stays', async () => {
  const root = await workspace({ 'NewSpace/Page.json': 'p', 'NewSpace/Other.json': 'o' });
  await undoChanges(root, [{ ...created('NewSpace/Page.json', 'p'), newSpace: true }], { force: false, trash });
  expect(await exists(join(root, 'NewSpace/Other.json'))).toBe(true);
});
