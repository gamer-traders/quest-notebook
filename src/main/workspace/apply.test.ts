import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
const save = (id: string, title: string, spaceName = 'Markets', parentId: string | null = null, json = page(id, title)): PageSave => ({ id, spaceId: space(spaceName), parentId, title, json, sidecars: {} });
const batch = (patch: Partial<FlushBatch>): FlushBatch => ({ spaces, createdSpaces: [], deletedSpaces: [], journalSpaceId: null, saves: [], deletes: [], ...patch });
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

test('a new space makes a folder, and a deleted one goes to the trash', async () => {
  await setup({ 'Markets/A.json': page('a', 'A'), 'Lessons/': '' });
  const markets = space('Markets');
  const next = [...spaces.filter((s) => s.name !== 'Markets'), { id: 's_new', name: 'Ideas' }];
  await applyFlush(root, index, batch({ spaces: next, createdSpaces: ['s_new'], deletedSpaces: [markets] }), deps());
  expect(trashed).toEqual(['Markets']);
  expect(await list('')).toEqual(['.quest', 'Ideas', 'Lessons']);
  expect(index.pages.has('a')).toBe(false);
  expect(index.spaceIds.get('Ideas')).toBe('s_new');
});

test('a batch planned before a space changed on disk neither trashes nor re-makes spaces', async () => {
  // The window planned this with the spaces it had; since then a folder was added outside and one renamed.
  await setup({ 'Markets/A.json': page('a', 'A'), 'Lessons/': '' });
  const stale = spaces;
  await rename(join(root, 'Markets'), join(root, 'Crypto'));
  await mkdir(join(root, 'Ideas'));
  await writeFile(join(root, 'Ideas/I.json'), page('i', 'I'));
  index = (await scanWorkspace(root, index)).index;
  const result = await applyFlush(root, index, batch({ spaces: stale, saves: [save('n', 'New', 'Lessons')] }), deps());
  expect(trashed).toEqual([]);
  expect(await list('')).toEqual(['.quest', 'Crypto', 'Ideas', 'Lessons']);
  expect(await list('Ideas')).toEqual(['I.json']);
  expect(await list('Crypto')).toEqual(['A.json']);
  // The save still lands: its space is one main knows.
  expect(result.paths.n).toBe('Lessons/New.json');
  // Spaces main knows but the batch didn't list keep their place in workspace.json.
  expect(JSON.parse(await read('.quest/workspace.json')).spaces).toEqual(['Lessons', 'Crypto', 'Ideas']);
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
  const result = await apply({ saves: [{ id: 'bad:Markets/Bad.json', spaceId: space('Markets'), parentId: null, title: 'Bad', json: '{}', sidecars: {} }] });
  expect(result.ok).toBe(false);
  expect(result.error).toBe('Page file is unreadable');
  expect(await read('Markets/Bad.json')).toBe('{ nope');
});

test('a save to a space that is not there fails alone', async () => {
  await setup({ 'Markets/': '' });
  const result = await apply({ saves: [{ id: 'x', spaceId: 's_missing', parentId: null, title: 'X', json: '{}', sidecars: {} }, save('ok', 'Fine')] });
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

test('a sibling whose extension is in capitals, or whose accents are decomposed, keeps its file', async () => {
  await setup({ 'Markets/Notes.JSON': page('x', 'Notes'), 'Markets/Cafe\u0301.json': page('c', 'Caf\u00e9') });
  const result = await apply({ saves: [save('n', 'Notes'), save('k', 'Caf\u00e9')] });
  expect(result.paths).toEqual({ n: 'Markets/Notes 2.json', k: 'Markets/Caf\u00e9 2.json' });
  expect(JSON.parse(await read('Markets/Notes.JSON')).id).toBe('x');
  expect(JSON.parse(await read('Markets/Cafe\u0301.json')).id).toBe('c');
});

test('a page’s drawing files are written in its folder, rewritten only when they change, and trashed when removed', async () => {
  await setup({ 'Markets/': '' });
  await apply({ saves: [{ ...save('p', 'Page'), sidecars: { 'drawing-d1.svg': '<svg>1</svg>' } }] });
  expect(await read('Markets/Page/drawing-d1.svg')).toBe('<svg>1</svg>');
  const before = (await stat(join(root, 'Markets/Page/drawing-d1.svg'))).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  await apply({ saves: [{ ...save('p', 'Page', 'Markets', null, page('p', 'Page!')), sidecars: { 'drawing-d1.svg': '<svg>1</svg>' } }] });
  expect((await stat(join(root, 'Markets/Page/drawing-d1.svg'))).mtimeMs).toBe(before);
  // A save that doesn't mention the drawing leaves it alone.
  await apply({ saves: [save('p', 'Page', 'Markets', null, page('p', 'Page?'))] });
  expect(await read('Markets/Page/drawing-d1.svg')).toBe('<svg>1</svg>');
  await apply({ saves: [{ ...save('p', 'Page'), removedSidecars: ['drawing-d1.svg'] }] });
  expect(trashed).toEqual(['Markets/Page/drawing-d1.svg']);
  expect(await list('Markets')).toEqual(['Page.json']);
});

test('removing a drawing leaves the sub-pages and other files in the folder alone', async () => {
  await setup({ 'Markets/Page.json': page('p', 'Page'), 'Markets/Page/Sub.json': page('s', 'Sub'), 'Markets/Page/drawing-x.svg': '<svg/>', 'Markets/Page/drawing-y.svg': '<svg/>' });
  await apply({ saves: [{ ...save('p', 'Page', 'Markets', null, page('p', 'Page 2')), removedSidecars: ['drawing-x.svg'] }] });
  expect(await list('Markets/Page')).toEqual(['Sub.json', 'drawing-y.svg']);
  expect(trashed).toEqual(['Markets/Page/drawing-x.svg']);
});

test('a picture with an unsafe name is never written', async () => {
  await setup({ 'Markets/': '' });
  const result = await apply({ saves: [{ ...save('p', 'Page'), sidecars: { '../x.svg': 'a', 'drawing-a/b.svg': 'b', 'notes.svg': 'c' }, removedSidecars: ['../../y.svg'] }] });
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/drawing file/);
  expect(await list('Markets')).toEqual(['Page.json']);
  expect(await list('')).toEqual(['.quest', 'Markets']);
});

test('a save with pictures only rewrites the pictures and leaves the page file as it is', async () => {
  const original = '{"id":"p","title":"Page","blocks":[]}';
  await setup({ 'Markets/Page.json': original });
  const result = await apply({ saves: [{ id: 'p', spaceId: space('Markets'), parentId: null, title: 'Page', sidecars: { 'drawing-d1.svg': '<svg>2</svg>' } }] });
  expect(result.paths).toEqual({ p: 'Markets/Page.json' });
  expect(await read('Markets/Page.json')).toBe(original);
  expect(await read('Markets/Page/drawing-d1.svg')).toBe('<svg>2</svg>');
});

test('a pictures-only save for a page main has never seen does nothing', async () => {
  await setup({ 'Markets/': '' });
  const result = await apply({ saves: [{ id: 'ghost', spaceId: space('Markets'), parentId: null, title: 'Ghost', sidecars: { 'drawing-d1.svg': '<svg/>' } }] });
  expect(result.ok).toBe(true);
  expect(await list('Markets')).toEqual([]);
});

test('if a drawing file can’t be written, the page file isn’t either', async () => {
  // Moving strokes out of a page must never drop them: the drawing file goes first.
  const old = page('p', 'Page');
  await setup({ 'Markets/Page.json': old, 'Markets/Page': 'a file where the folder should be' });
  const result = await apply({ saves: [{ ...save('p', 'Page', 'Markets', null, page('p', 'Page, strokes moved out')), sidecars: { 'drawing-d1.svg': '<svg/>' } }] });
  expect(result.ok).toBe(false);
  expect(await read('Markets/Page.json')).toBe(old);
});

test('renaming a page onto a name a drawings folder already has picks a free name', async () => {
  await setup({ 'Markets/Bar.json': page('p', 'Bar'), 'Markets/Bar/drawing-d1.svg': '<svg>1</svg>', 'Markets/Foo/drawing-zz.svg': '<svg>zz</svg>' });
  const result = await apply({ saves: [save('p', 'Foo', 'Markets', null, page('p', 'Foo'))] });
  expect(result).toMatchObject({ ok: true, paths: { p: 'Markets/Foo 2.json' } });
  expect(await list('Markets')).toEqual(['Foo', 'Foo 2', 'Foo 2.json']);
  expect(await list('Markets/Foo 2')).toEqual(['drawing-d1.svg']);
  expect(await list('Markets/Foo')).toEqual(['drawing-zz.svg']);
});

test.skipIf(process.platform !== 'darwin')('if a page’s folder can’t move, its file moves back', async () => {
  await setup({ 'Markets/A.json': page('a', 'A'), 'Markets/A/drawing-d1.svg': '<svg>1</svg>' });
  execFileSync('chflags', ['uchg', join(root, 'Markets/A')]);
  try {
    const result = await apply({ saves: [save('a', 'B', 'Markets', null, page('a', 'B'))] });
    expect(result.ok).toBe(false);
    expect(await list('Markets')).toEqual(['A', 'A.json']);
    expect(index.pages.get('a')!.path).toBe('Markets/A.json');
  } finally {
    execFileSync('chflags', ['nouchg', join(root, 'Markets/A')]);
  }
});
