import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { scanWorkspace } from './scan';
import { applyFlush } from './apply';
import { diffScans, knownAfterFlush, knownFromScan, watchWorkspace, type Known } from './watch';

const page = (id: string, title: string, blocks: unknown[] = []) => `${JSON.stringify({ id, title, position: 0, blocks })}\n`;

async function workspace(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'quest-watch-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, rel);
    if (rel.endsWith('/')) await mkdir(abs, { recursive: true });
    else {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, text);
    }
  }
  const known = knownFromScan(await scanWorkspace(root));
  return { root, known };
}

const rescan = async (root: string, known: Known) => diffScans(known, await scanWorkspace(root, known.index));
const deps = { trash: (abs: string) => rm(abs, { recursive: true }), now: () => new Date() };

test('the app’s own writes are quiet', async () => {
  const { root, known } = await workspace({ 'Markets/A.json': page('a', 'A'), 'Markets/A/B.json': page('b', 'B'), 'Lessons/': '' });
  const markets = known.spaces.find((s) => s.name === 'Markets')!.id;
  const lessons = known.spaces.find((s) => s.name === 'Lessons')!.id;
  const batch = {
    spaces: [...known.spaces].reverse(),
    createdSpaces: [],
    deletedSpaces: [],
    journalSpaceId: lessons,
    saves: [
      { id: 'a', spaceId: lessons, parentId: null, title: 'A moved', json: page('a', 'A moved'), sidecars: {} },
      { id: 'n', spaceId: markets, parentId: null, title: 'New', json: page('n', 'New'), sidecars: {} },
    ],
    deletes: [],
  };
  await applyFlush(root, known.index, batch, deps);
  expect(await rescan(root, knownAfterFlush(known, batch))).toBeNull();
});

test('an edit made outside shows up with the new file', async () => {
  const { root, known } = await workspace({ 'Markets/A.json': page('a', 'A') });
  await writeFile(join(root, 'Markets/A.json'), page('a', 'A', [{ type: 'paragraph', text: 'New words' }]));
  const delta = await rescan(root, known);
  expect(delta!.pages).toHaveLength(1);
  expect(delta!.pages[0]).toMatchObject({ id: 'a', path: 'Markets/A.json', file: { blocks: [{ type: 'paragraph', text: 'New words' }] } });
  expect(delta!.removed).toEqual([]);
});

test('a file renamed outside takes its new name as its title', async () => {
  const { root, known } = await workspace({ 'Markets/A.json': page('a', 'A') });
  await rename(join(root, 'Markets/A.json'), join(root, 'Markets/Alpha.json'));
  const delta = await rescan(root, known);
  expect(delta!.pages[0]).toMatchObject({ id: 'a', path: 'Markets/Alpha.json', titleFromPath: 'Alpha' });
});

test('a file moved without a new name keeps its title', async () => {
  const { root, known } = await workspace({ 'Markets/A.json': page('a', 'A'), 'Lessons/': '' });
  await rename(join(root, 'Markets/A.json'), join(root, 'Lessons/A.json'));
  const delta = await rescan(root, known);
  expect(delta!.pages[0].path).toBe('Lessons/A.json');
  expect(delta!.pages[0].titleFromPath).toBeUndefined();
  expect(delta!.pages[0].spaceId).toBe(known.spaces.find((s) => s.name === 'Lessons')!.id);
});

test('a file deleted outside is removed', async () => {
  const { root, known } = await workspace({ 'Markets/A.json': page('a', 'A'), 'Markets/B.json': page('b', 'B') });
  await rm(join(root, 'Markets/B.json'));
  expect(await rescan(root, known)).toEqual({ spaces: known.spaces, journalSpaceId: null, pages: [], removed: ['b'] });
});

test('a new folder at the top is a new space', async () => {
  const { root, known } = await workspace({ 'Markets/': '' });
  await mkdir(join(root, 'Ideas'));
  const delta = await rescan(root, known);
  expect(delta!.spaces.map((s) => s.name)).toEqual(['Ideas', 'Markets']);
  expect(delta!.spaces[1].id).toBe(known.spaces[0].id);
});

test('a file that is invalid while being written, then valid, reports the error and then the page', async () => {
  const { root, known } = await workspace({ 'Markets/A.json': page('a', 'A') });
  await writeFile(join(root, 'Markets/A.json'), '{');
  const next1 = await scanWorkspace(root, known.index);
  const broken = diffScans(known, next1)!;
  expect(broken.removed).toEqual(['a']);
  expect(broken.pages[0]).toMatchObject({ id: 'bad:Markets/A.json' });
  expect(broken.pages[0].error).toBeTruthy();

  await writeFile(join(root, 'Markets/A.json'), page('a', 'A again'));
  const fixed = diffScans(knownFromScan(next1), await scanWorkspace(root, next1.index))!;
  expect(fixed.removed).toEqual(['bad:Markets/A.json']);
  expect(fixed.pages[0]).toMatchObject({ id: 'a', file: { title: 'A again' } });
  expect(fixed.pages[0].error).toBeUndefined();
});

test('the watcher calls back soon after a file changes', async () => {
  const { root } = await workspace({ 'Markets/': '' });
  let calls = 0;
  const stop = watchWorkspace(root, () => calls++, 50);
  try {
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(join(root, 'Markets/x.json'), page('x', 'X'));
    for (let i = 0; i < 40 && calls === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBeGreaterThan(0);
  } finally {
    stop();
  }
});

test('a drawing file edited outside changes its page', async () => {
  const { root, known } = await workspace({ 'Markets/A.json': page('a', 'A'), 'Markets/A/drawing-d1.svg': '<svg>1</svg>' });
  await writeFile(join(root, 'Markets/A/drawing-d1.svg'), '<svg>2</svg>');
  const delta = await rescan(root, known);
  expect(delta!.pages).toHaveLength(1);
  expect(delta!.pages[0]).toMatchObject({ id: 'a', drawings: { 'drawing-d1.svg': '<svg>2</svg>' } });
});

test('the app’s own drawing writes are quiet', async () => {
  const { root, known } = await workspace({ 'Markets/A.json': page('a', 'A') });
  const markets = known.spaces[0].id;
  const batch = { spaces: known.spaces, createdSpaces: [], deletedSpaces: [], journalSpaceId: null, deletes: [], saves: [{ id: 'a', spaceId: markets, parentId: null, title: 'A', json: page('a', 'A'), sidecars: { 'drawing-d1.svg': '<svg>new</svg>' } }] };
  await applyFlush(root, known.index, batch, deps);
  expect(await rescan(root, knownAfterFlush(known, batch))).toBeNull();
});
