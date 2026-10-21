import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { scanWorkspace } from './scan';
import { insideRoot } from './paths';

/** A workspace folder from paths: a path ending in '/' is a folder, anything else a file with that text. */
async function tmpWorkspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'quest-scan-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, rel);
    if (rel.endsWith('/')) await mkdir(abs, { recursive: true });
    else {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, text);
    }
  }
  return root;
}

const read = (root: string, rel: string) => readFile(join(root, rel), 'utf8');
const page = (id: string, title: string, extra: object = {}) => JSON.stringify({ id, title, position: 0, created: '2026-10-20T00:00:00Z', updated: '2026-10-20T00:00:00Z', blocks: [], ...extra });
const config = (spaces: string[], journalSpace: string | null = null) => JSON.stringify({ format: 1, name: 'Quest', spaces, journalSpace });

test('spaces follow workspace.json, then new folders alphabetically', async () => {
  const root = await tmpWorkspace({ '.quest/workspace.json': config(['Markets', 'Journal', 'Gone'], 'Journal'), 'Journal/': '', 'Lessons/': '', 'Markets/': '', 'Ideas/': '' });
  const { snapshot } = await scanWorkspace(root);
  expect(snapshot.name).toBe('Quest');
  expect(snapshot.spaces.map((s) => s.name)).toEqual(['Markets', 'Journal', 'Ideas', 'Lessons']);
  expect(snapshot.journalSpaceId).toBe(snapshot.spaces[1].id);
});

test('without workspace.json the name is the folder name', async () => {
  const root = await tmpWorkspace({ 'B/': '', 'A/': '' });
  const { snapshot } = await scanWorkspace(root);
  expect(snapshot.name).toBe(root.split('/').at(-1));
  expect(snapshot.spaces.map((s) => s.name)).toEqual(['A', 'B']);
  expect(snapshot.journalSpaceId).toBeNull();
});

test('space ids stay the same from one scan to the next', async () => {
  const root = await tmpWorkspace({ 'A/': '' });
  const first = await scanWorkspace(root);
  const second = await scanWorkspace(root, first.index);
  expect(second.snapshot.spaces[0].id).toBe(first.snapshot.spaces[0].id);
  expect(first.snapshot.spaces[0].id).toMatch(/^s_[a-z0-9]{8}$/);
});

test('sub-pages sit in a folder named like their parent', async () => {
  const root = await tmpWorkspace({ 'Markets/A.json': page('a', 'A'), 'Markets/A/B.json': page('b', 'B'), 'Markets/A/B/C.json': page('c', 'C') });
  const { snapshot } = await scanWorkspace(root);
  const byId = Object.fromEntries(snapshot.pages.map((p) => [p.id, p]));
  const markets = snapshot.spaces[0].id;
  expect(byId.a).toMatchObject({ spaceId: markets, parentId: null, path: 'Markets/A.json' });
  expect(byId.b).toMatchObject({ spaceId: markets, parentId: 'a', path: 'Markets/A/B.json' });
  expect(byId.c).toMatchObject({ spaceId: markets, parentId: 'b', path: 'Markets/A/B/C.json' });
  expect(byId.a.file).toMatchObject({ id: 'a', title: 'A' });
  expect(byId.a.mtimeMs).toBeGreaterThan(0);
});

test('a folder with no page file becomes a page', async () => {
  const root = await tmpWorkspace({ 'Markets/Old.json': page('o', 'Old', { position: 4 }), 'Markets/Ideas/C.json': page('c', 'C') });
  const { snapshot } = await scanWorkspace(root);
  const ideas = snapshot.pages.find((p) => p.path === 'Markets/Ideas.json')!;
  expect(JSON.parse(await read(root, 'Markets/Ideas.json'))).toMatchObject({ id: ideas.id, title: 'Ideas', position: 5, blocks: [] });
  expect(snapshot.pages.find((p) => p.id === 'c')!.parentId).toBe(ideas.id);
});

test('a file that is not valid JSON is reported and left alone', async () => {
  const root = await tmpWorkspace({ 'Markets/Bad.json': '{ nope' });
  const { snapshot, index } = await scanWorkspace(root);
  expect(snapshot.pages).toHaveLength(1);
  expect(snapshot.pages[0]).toMatchObject({ id: 'bad:Markets/Bad.json', path: 'Markets/Bad.json' });
  expect(snapshot.pages[0].error).toBeTruthy();
  expect(snapshot.pages[0].file).toBeUndefined();
  expect(index.pages.get('bad:Markets/Bad.json')!.error).toBeTruthy();
  expect(await read(root, 'Markets/Bad.json')).toBe('{ nope');
});

test('a page without an id gets one, written back with everything else kept', async () => {
  const root = await tmpWorkspace({ 'Markets/T.json': JSON.stringify({ title: 'T', blocks: [{ type: 'paragraph', text: 'Hi' }] }) });
  const { snapshot, index } = await scanWorkspace(root);
  const saved = JSON.parse(await read(root, 'Markets/T.json'));
  expect(saved.id).toMatch(/^[a-z0-9]{8}$/);
  expect(saved).toEqual({ id: saved.id, title: 'T', blocks: [{ type: 'paragraph', text: 'Hi' }] });
  expect(snapshot.pages[0].id).toBe(saved.id);
  expect(index.pages.get(saved.id)!.text).toBe(await read(root, 'Markets/T.json'));
});

test('of two pages with the same id, the later path gets a new one', async () => {
  const root = await tmpWorkspace({ 'Markets/A.json': page('same', 'A'), 'Markets/B.json': page('same', 'B') });
  const { snapshot } = await scanWorkspace(root);
  const ids = snapshot.pages.map((p) => p.id);
  expect(new Set(ids).size).toBe(2);
  expect(snapshot.pages.find((p) => p.path === 'Markets/A.json')!.id).toBe('same');
  expect(JSON.parse(await read(root, 'Markets/B.json')).id).not.toBe('same');
});

test('dot folders, hidden files, temporary files, other files and files at the root are not pages', async () => {
  const root = await tmpWorkspace({
    '.git/x.json': page('g', 'G'),
    'Markets/.hidden.json': page('h', 'H'),
    'Markets/a.json.tmp': page('t', 'T'),
    'Markets/notes.md': '# hi',
    'top.json': page('r', 'R'),
  });
  const { snapshot } = await scanWorkspace(root);
  expect(snapshot.pages).toEqual([]);
  expect(snapshot.spaces.map((s) => s.name)).toEqual(['Markets']);
});

test('ui state is read from .quest/state.json, and anything unreadable there is ignored', async () => {
  const root = await tmpWorkspace({ '.quest/state.json': JSON.stringify({ openPageId: 'p1', expanded: ['p1'], collapsedPanels: [] }) });
  expect((await scanWorkspace(root)).snapshot.ui).toEqual({ openPageId: 'p1', expanded: ['p1'], collapsedPanels: [] });
  const broken = await tmpWorkspace({ '.quest/state.json': 'nope' });
  expect((await scanWorkspace(broken)).snapshot.ui).toEqual({ openPageId: null, expanded: [], collapsedPanels: [] });
});

test('paths outside the workspace are refused', () => {
  expect(() => insideRoot('/w', '../x')).toThrow('Path outside workspace');
  expect(() => insideRoot('/w', '/etc/passwd')).toThrow('Path outside workspace');
  expect(insideRoot('/w', 'Markets/A.json')).toBe('/w/Markets/A.json');
});

test('JSON that is not a page is reported and never written to', async () => {
  const pkg = '{\n  "name": "web",\n  "big": 12345678901234567890,\n  "version": 1.10\n}\n';
  const root = await tmpWorkspace({ 'Markets/package.json': pkg, 'Markets/list.json': '[1, 2]' });
  const { snapshot } = await scanWorkspace(root);
  expect(snapshot.pages.map((p) => [p.path, !!p.error])).toEqual([['Markets/list.json', true], ['Markets/package.json', true]]);
  expect(snapshot.pages[1].error).toMatch(/not a page/);
  expect(await read(root, 'Markets/package.json')).toBe(pkg);
  expect(await read(root, 'Markets/list.json')).toBe('[1, 2]');
});

test('a sub-page folder named in a different case still belongs to its page, which is never written over', async () => {
  const notes = page('n', 'Notes', { blocks: [{ type: 'paragraph', text: 'keep me' }] });
  const root = await tmpWorkspace({ 'Markets/Notes.json': notes, 'Markets/notes/Sub.json': page('s', 'Sub') });
  const { snapshot } = await scanWorkspace(root);
  expect(await read(root, 'Markets/Notes.json')).toBe(notes);
  expect(snapshot.pages.map((p) => p.id).sort()).toEqual(['n', 's']);
  expect(snapshot.pages.find((p) => p.id === 's')!.parentId).toBe('n');
});

test('a copy of a page made while the app watches gets a new id, and the original keeps its own', async () => {
  const root = await tmpWorkspace({ 'Markets/A.json': page('orig', 'A') });
  const first = await scanWorkspace(root);
  await writeFile(join(root, 'Markets/A copy.json'), page('orig', 'A'));
  const { snapshot } = await scanWorkspace(root, first.index);
  expect(snapshot.pages.find((p) => p.path === 'Markets/A.json')!.id).toBe('orig');
  const copy = snapshot.pages.find((p) => p.path === 'Markets/A copy.json')!;
  expect(copy.id).not.toBe('orig');
  expect(JSON.parse(await read(root, 'Markets/A copy.json')).id).toBe(copy.id);
});

test('a folder holding only drawing pictures is not a page', async () => {
  // Left behind when a page with drawings is deleted or renamed outside the app.
  const root = await tmpWorkspace({ 'Markets/New.json': page('n', 'New'), 'Markets/Old/drawing-d1.svg': '<svg/>', 'Markets/Old/.DS_Store': '' });
  const { snapshot } = await scanWorkspace(root);
  expect(snapshot.pages.map((p) => p.path)).toEqual(['Markets/New.json']);
  await expect(read(root, 'Markets/Old.json')).rejects.toThrow();
});

test('an empty folder still becomes a page', async () => {
  const root = await tmpWorkspace({ 'Markets/Ideas/': '' });
  const { snapshot } = await scanWorkspace(root);
  expect(snapshot.pages.map((p) => p.path)).toEqual(['Markets/Ideas.json']);
});

test('a page’s drawing files come with it', async () => {
  const root = await tmpWorkspace({ 'Markets/A.json': page('a', 'A'), 'Markets/A/drawing-d1.svg': '<svg>1</svg>', 'Markets/A/notes.txt': 'x', 'Markets/A/B.json': page('b', 'B') });
  const { snapshot, index } = await scanWorkspace(root);
  expect(snapshot.pages.find((p) => p.id === 'a')!.drawings).toEqual({ 'drawing-d1.svg': '<svg>1</svg>' });
  expect(snapshot.pages.find((p) => p.id === 'b')!.drawings).toEqual({});
  expect(index.pages.get('a')!.sidecars!['drawing-d1.svg'].text).toBe('<svg>1</svg>');
});

test('a folder named like a drawing file never breaks the scan', async () => {
  const root = await tmpWorkspace({ 'Markets/Q.json': page('q', 'Q'), 'Markets/Q/drawing-old.svg/': '', 'Markets/Q/drawing-a.svg': '<svg>a</svg>' });
  const { snapshot } = await scanWorkspace(root);
  expect(snapshot.pages.find((p) => p.id === 'q')!.drawings).toEqual({ 'drawing-a.svg': '<svg>a</svg>' });
});

test('a page file renamed outside the app takes its drawings folder along', async () => {
  const root = await tmpWorkspace({ 'Markets/Foo.json': page('p', 'Foo'), 'Markets/Foo/drawing-d1.svg': '<svg>strokes</svg>' });
  const first = await scanWorkspace(root);
  await rename(join(root, 'Markets/Foo.json'), join(root, 'Markets/Bar.json'));
  const { snapshot } = await scanWorkspace(root, first.index);
  expect(await read(root, 'Markets/Bar/drawing-d1.svg')).toBe('<svg>strokes</svg>');
  await expect(read(root, 'Markets/Foo/drawing-d1.svg')).rejects.toThrow();
  expect(snapshot.pages.find((p) => p.id === 'p')).toMatchObject({ path: 'Markets/Bar.json', drawings: { 'drawing-d1.svg': '<svg>strokes</svg>' } });
});

test('a drawings folder never moves onto a folder that is already there', async () => {
  const root = await tmpWorkspace({ 'Markets/Foo.json': page('p', 'Foo'), 'Markets/Foo/drawing-d1.svg': '<svg>1</svg>', 'Markets/Bar/drawing-x.svg': '<svg>x</svg>' });
  const first = await scanWorkspace(root);
  await rename(join(root, 'Markets/Foo.json'), join(root, 'Markets/Bar.json'));
  await scanWorkspace(root, first.index);
  expect(await read(root, 'Markets/Foo/drawing-d1.svg')).toBe('<svg>1</svg>');
  expect(await read(root, 'Markets/Bar/drawing-x.svg')).toBe('<svg>x</svg>');
});
