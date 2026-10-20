import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import type { FlushBatch, PageSave, SpaceRecord } from '@shared/ipc';
import { scanWorkspace, type ScanIndex } from './scan';
import { applyFlush } from './apply';

let root: string;
let index: ScanIndex;
let spaces: SpaceRecord[];
let trashed: string[];

const page = (id: string, title: string) => `${JSON.stringify({ id, title, position: 0, blocks: [] })}\n`;

async function setup(files: Record<string, string>) {
  root = await mkdtemp(join(tmpdir(), 'quest-apply-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, rel);
    if (rel.endsWith('/')) await mkdir(abs, { recursive: true });
    else {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, text);
    }
  }
  const scanned = await scanWorkspace(root);
  index = scanned.index;
  spaces = scanned.snapshot.spaces;
}

const deps = () => ({
  trash: async (abs: string) => {
    trashed.push(relative(root, abs));
    await rm(abs, { recursive: true });
  },
  now: () => new Date('2026-10-20T12:00:00Z'),
});

const space = (name: string) => spaces.find((s) => s.name === name)!.id;
const save = (id: string, title: string, spaceName = 'Markets', parentId: string | null = null, json = page(id, title)): PageSave => ({ id, spaceId: space(spaceName), parentId, title, json });
const batch = (patch: Partial<FlushBatch>): FlushBatch => ({ spaces, journalSpaceId: null, saves: [], deletes: [], ...patch });
const apply = (patch: Partial<FlushBatch>) => applyFlush(root, index, batch(patch), deps());
const read = (rel: string) => readFile(join(root, rel), 'utf8');
const exists = (rel: string) => access(join(root, rel)).then(() => true, () => false);
const list = async (rel: string) => (await readdir(join(root, rel))).sort();

beforeEach(() => {
  trashed = [];
});

test('a new page is written where its space and title say', async () => {
  await setup({ 'Markets/': '' });
  const json = '{\n  "id": "n1"\n}\n';
  const result = await apply({ saves: [save('n1', 'Weekly levels', 'Markets', null, json)] });
  expect(result).toEqual({ ok: true, paths: { n1: 'Markets/Weekly levels.json' } });
  expect(await read('Markets/Weekly levels.json')).toBe(json);
  expect(index.pages.get('n1')).toMatchObject({ path: 'Markets/Weekly levels.json', text: json });
});

test('renaming a page moves its file and its sub-page folder', async () => {
  await setup({ 'Markets/A.json': page('a', 'A'), 'Markets/A/B.json': page('b', 'B') });
  const result = await apply({ saves: [save('a', 'A2')] });
  expect(result.ok).toBe(true);
  expect(await list('Markets')).toEqual(['A2', 'A2.json']);
  expect(await list('Markets/A2')).toEqual(['B.json']);
  expect(index.pages.get('b')!.path).toBe('Markets/A2/B.json');
  expect(JSON.parse(await read('Markets/A2.json')).title).toBe('A2');
});

test('a rename that only changes case works on a case-insensitive disk', async () => {
  await setup({ 'Markets/notes.json': page('n', 'notes'), 'Markets/notes/Sub.json': page('s', 'Sub') });
  await apply({ saves: [save('n', 'Notes')] });
  expect(await list('Markets')).toEqual(['Notes', 'Notes.json']);
  expect(index.pages.get('s')!.path).toBe('Markets/Notes/Sub.json');
});

test('nesting a page under another makes the parent a folder', async () => {
  await setup({ 'Markets/A.json': page('a', 'A'), 'Markets/C.json': page('c', 'C') });
  await apply({ saves: [save('c', 'C', 'Markets', 'a')] });
  expect(await list('Markets')).toEqual(['A', 'A.json']);
  expect(await list('Markets/A')).toEqual(['C.json']);
});

test('moving the last sub-page out removes the empty folder', async () => {
  await setup({ 'Markets/A.json': page('a', 'A'), 'Markets/A/B.json': page('b', 'B') });
  await apply({ saves: [save('b', 'B')] });
  expect(await list('Markets')).toEqual(['A.json', 'B.json']);
});

test('moving a page to another space brings its sub-pages', async () => {
  await setup({ 'Markets/A.json': page('a', 'A'), 'Markets/A/B.json': page('b', 'B'), 'Lessons/': '' });
  await apply({ saves: [save('a', 'A', 'Lessons')] });
  expect(await list('Markets')).toEqual([]);
  expect(await list('Lessons')).toEqual(['A', 'A.json']);
  expect(await list('Lessons/A')).toEqual(['B.json']);
});

test('pages with the same title get numbered file names', async () => {
  await setup({ 'Markets/': '' });
  const result = await apply({ saves: [save('x', 'Notes'), save('y', 'Notes')] });
  expect(result.paths).toEqual({ x: 'Markets/Notes.json', y: 'Markets/Notes 2.json' });
  // Saving again doesn't shuffle them.
  const again = await apply({ saves: [save('y', 'Notes', 'Markets', null, page('y', 'Notes!'))] });
  expect(again.paths).toEqual({ y: 'Markets/Notes 2.json' });
});

test('new parent and child in one batch land together', async () => {
  await setup({ 'Markets/': '' });
  const result = await apply({ saves: [save('c', 'Child', 'Markets', 'p'), save('p', 'Parent')] });
  expect(result.paths).toEqual({ c: 'Markets/Parent/Child.json', p: 'Markets/Parent.json' });
});

test('text that has not changed is not written again', async () => {
  await setup({ 'Markets/': '' });
  await apply({ saves: [save('n', 'N')] });
  const before = (await stat(join(root, 'Markets/N.json'))).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  await apply({ saves: [save('n', 'N')] });
  expect((await stat(join(root, 'Markets/N.json'))).mtimeMs).toBe(before);
});

test('deleting a page and its sub-pages trashes the file and folder once', async () => {
  await setup({ 'Markets/A.json': page('a', 'A'), 'Markets/A/B.json': page('b', 'B'), 'Markets/A/B/C.json': page('c', 'C'), 'Markets/Z.json': page('z', 'Z') });
  const result = await apply({ deletes: ['a', 'b', 'c'] });
  expect(result.ok).toBe(true);
  expect(trashed).toEqual(['Markets/A.json', 'Markets/A']);
  expect(await list('Markets')).toEqual(['Z.json']);
  expect([...index.pages.keys()]).toEqual(['z']);
});

test('deleting the last sub-page removes the empty folder', async () => {
  await setup({ 'Markets/A.json': page('a', 'A'), 'Markets/A/B.json': page('b', 'B') });
  await apply({ deletes: ['b'] });
  expect(await list('Markets')).toEqual(['A.json']);
});

test('renaming a space renames its folder, and workspace.json follows', async () => {
  await setup({ 'Markets/A.json': page('a', 'A'), 'Lessons/': '' });
  const renamed = spaces.map((s) => (s.name === 'Markets' ? { ...s, name: 'Crypto: alts' } : s));
  const result = await applyFlush(root, index, batch({ spaces: renamed, journalSpaceId: renamed[1].id }), deps());
  expect(result.ok).toBe(true);
  expect(await list('')).toEqual(['.quest', 'Crypto- alts', 'Lessons']);
  expect(index.pages.get('a')!.path).toBe('Crypto- alts/A.json');
  expect(JSON.parse(await read('.quest/workspace.json'))).toMatchObject({ format: 1, spaces: ['Lessons', 'Crypto- alts'], journalSpace: 'Crypto- alts' });
});

test('a new space makes a folder, and a space left out goes to the trash', async () => {
  await setup({ 'Markets/A.json': page('a', 'A'), 'Lessons/': '' });
  const next = [...spaces.filter((s) => s.name !== 'Markets'), { id: 's_new', name: 'Ideas' }];
  await applyFlush(root, index, batch({ spaces: next }), deps());
  expect(trashed).toEqual(['Markets']);
  expect(await list('')).toEqual(['.quest', 'Ideas', 'Lessons']);
  expect(index.pages.has('a')).toBe(false);
  expect(index.spaceIds.get('Ideas')).toBe('s_new');
});

test('a batch with no spaces leaves the spaces alone', async () => {
  await setup({ 'Markets/A.json': page('a', 'A') });
  const result = await applyFlush(root, index, batch({ spaces: [] }), deps());
  expect(result.ok).toBe(false);
  expect(trashed).toEqual([]);
  expect(await exists('Markets/A.json')).toBe(true);
});

test('a title cannot write outside its folder', async () => {
  await setup({ 'Markets/': '' });
  const result = await apply({ saves: [save('e', '../../evil')] });
  expect(result.paths.e).toBe('Markets/-..-evil.json');
  expect(await exists('Markets/-..-evil.json')).toBe(true);
});

test('a page whose file could not be read is never written', async () => {
  await setup({ 'Markets/Bad.json': '{ nope' });
  const result = await apply({ saves: [{ id: 'bad:Markets/Bad.json', spaceId: space('Markets'), parentId: null, title: 'Bad', json: '{}' }] });
  expect(result.ok).toBe(false);
  expect(result.error).toBe('Page file is unreadable');
  expect(await read('Markets/Bad.json')).toBe('{ nope');
});

test('a save to a space that is not there fails alone', async () => {
  await setup({ 'Markets/': '' });
  const result = await apply({ saves: [{ id: 'x', spaceId: 's_missing', parentId: null, title: 'X', json: '{}' }, save('ok', 'Fine')] });
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/space/i);
  expect(result.paths).toEqual({ ok: 'Markets/Fine.json' });
});

test('two pages swapping titles both survive', async () => {
  await setup({ 'Markets/A.json': page('a', 'A'), 'Markets/B.json': page('b', 'B') });
  const result = await apply({ saves: [save('a', 'B'), save('b', 'A')] });
  expect(result.ok).toBe(true);
  const files = await list('Markets');
  expect(files).toHaveLength(2);
  const titles = await Promise.all(files.map(async (f) => JSON.parse(await read(`Markets/${f}`))));
  expect(titles.map((t) => [t.id, t.title]).sort()).toEqual([['a', 'B'], ['b', 'A']]);
});
