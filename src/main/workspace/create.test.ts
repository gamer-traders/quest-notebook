import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AdoptDeclined, adoptFolder, createWorkspace } from './create';

const tmp = () => mkdtemp(join(tmpdir(), 'quest-create-'));

test('a new workspace gets its settings, three spaces and a README', async () => {
  const parent = await tmp();
  const root = await createWorkspace(parent, 'Quest: Trading');
  expect(root).toBe(join(parent, 'Quest- Trading'));
  expect((await readdir(root)).sort()).toEqual(['.quest', 'Journal', 'Lessons', 'Markets', 'README.md']);
  expect(JSON.parse(await readFile(join(root, '.quest/workspace.json'), 'utf8'))).toEqual({
    format: 1,
    name: 'Quest: Trading',
    spaces: ['Journal', 'Markets', 'Lessons'],
    journalSpace: 'Journal',
  });
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  expect(readme).toContain('## Block types');
  expect(readme).toContain('[[Page title]]');
});

test('an empty existing folder can become a workspace, one with files cannot', async () => {
  const parent = await tmp();
  await mkdir(join(parent, 'Empty'));
  await expect(createWorkspace(parent, 'Empty')).resolves.toBe(join(parent, 'Empty'));
  await mkdir(join(parent, 'Full'));
  await writeFile(join(parent, 'Full', 'x.txt'), 'x');
  await expect(createWorkspace(parent, 'Full')).rejects.toThrow('A folder with that name already has files in it');
});

test('opening a plain folder makes it a workspace once, and keeps its own README', async () => {
  const root = await tmp();
  await writeFile(join(root, 'README.md'), 'mine');
  expect(await adoptFolder(root)).toEqual({ isNew: true });
  expect(JSON.parse(await readFile(join(root, '.quest/workspace.json'), 'utf8'))).toEqual({ format: 1, name: root.split('/').at(-1), spaces: [], journalSpace: null });
  expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('mine');
  expect(await adoptFolder(root)).toEqual({ isNew: false });
});

test('opening a folder without a README writes one', async () => {
  const root = await tmp();
  await adoptFolder(root);
  expect(await readFile(join(root, 'README.md'), 'utf8')).toContain('Quest Notebook');
});

test('a folder that is gone is not made again', async () => {
  const root = await tmp();
  await rm(root, { recursive: true });
  await expect(adoptFolder(root)).rejects.toThrow(`Couldn't find ${root}`);
  await expect(readdir(root)).rejects.toThrow();
});

test('a folder with files in it becomes a workspace only once the person agrees', async () => {
  const root = await tmp();
  await writeFile(join(root, 'notes.txt'), 'x');
  let asked = 0;
  await expect(adoptFolder(root, async () => (asked++, false))).rejects.toThrow(AdoptDeclined);
  expect(asked).toBe(1);
  expect((await readdir(root)).sort()).toEqual(['notes.txt']);
  expect(await adoptFolder(root, async () => true)).toEqual({ isNew: true });
});

test('an empty folder or an existing workspace is opened without asking', async () => {
  const root = await tmp();
  const never = async () => {
    throw new Error('asked');
  };
  expect(await adoptFolder(root, never)).toEqual({ isNew: true });
  await writeFile(join(root, 'x.txt'), 'x');
  expect(await adoptFolder(root, never)).toEqual({ isNew: false });
});

test('the workspace README explains drawings and their picture copies', async () => {
  const root = await createWorkspace(await tmp(), 'Draw');
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  expect(readme).toContain('## Drawings');
  expect(readme).toContain('drawing-<id>.svg');
});
