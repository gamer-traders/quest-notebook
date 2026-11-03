import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AdoptDeclined, adoptFolder, createWorkspace } from './create';
import { WORKSPACE_README } from '@shared/readme';
import { GUIDE_FILES } from '@shared/guide';

const tmp = () => mkdtemp(join(tmpdir(), 'quest-create-'));

test('a new workspace gets its settings, three spaces and a README', async () => {
  const parent = await tmp();
  const root = await createWorkspace(parent, 'Quest: Trading');
  expect(root).toBe(join(parent, 'Quest- Trading'));
  expect((await readdir(root)).sort()).toEqual(['.agents', '.claude', '.quest', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'Journal', 'Lessons', 'Markets', 'README.md']);
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

test('the workspace README explains drawings and their files', async () => {
  const root = await createWorkspace(await tmp(), 'Draw');
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  expect(readme).toContain('## Drawings');
  expect(readme).toContain('"file": "drawing-d81k2m0q.svg"');
  expect(readme).toContain('data-points');
});

test('a README an earlier version of the app wrote is brought up to date, and anyone else’s is left alone', async () => {
  const old = await tmp();
  await adoptFolder(old);
  await writeFile(join(old, 'README.md'), '# Quest Notebook workspace\n\nOld advice: edit the strokes, not the SVG.\n');
  await adoptFolder(old);
  expect(await readFile(join(old, 'README.md'), 'utf8')).toBe(WORKSPACE_README);

  const mine = await tmp();
  await adoptFolder(mine);
  await writeFile(join(mine, 'README.md'), '# My trading notes\n');
  await adoptFolder(mine);
  expect(await readFile(join(mine, 'README.md'), 'utf8')).toBe('# My trading notes\n');
});

test('the README says which version of it this is', () => {
  expect(WORKSPACE_README).toMatch(/<!-- quest-notebook-readme: \d+ -->/);
});

const GUIDE_PATHS = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.claude/skills/quest-notebook/SKILL.md', '.agents/rules/quest-notebook.md'];
const read = (root: string, rel: string) => readFile(join(root, rel), 'utf8');

test('a new workspace gets the guides AI tools read: the full guide, and pointers to it where a tool looks elsewhere', async () => {
  const root = await createWorkspace(await tmp(), 'Guided');
  expect(Object.keys(GUIDE_FILES).sort()).toEqual([...GUIDE_PATHS].sort());
  for (const rel of GUIDE_PATHS) expect(await read(root, rel)).toBe(GUIDE_FILES[rel]);
  const agents = await read(root, 'AGENTS.md');
  expect(agents).toContain('"type": "tradePlan"');
  expect(agents).toContain('## Drawings');
  // Claude Code and Gemini read their own file, which brings in AGENTS.md.
  expect(await read(root, 'CLAUDE.md')).toMatch(/^@AGENTS\.md$/m);
  expect(await read(root, 'GEMINI.md')).toMatch(/^@AGENTS\.md$/m);
  // A Claude Code skill starts with its name and when to use it.
  expect(await read(root, '.claude/skills/quest-notebook/SKILL.md')).toMatch(/^---\nname: quest-notebook\ndescription: .+\n---\n/);
  expect(await read(root, '.claude/skills/quest-notebook/SKILL.md')).toContain('"type": "tradePlan"');
});

test('a folder that becomes a workspace gets the guides too, unless the person declines', async () => {
  const root = await tmp();
  await adoptFolder(root);
  for (const rel of GUIDE_PATHS) expect(await read(root, rel)).toBe(GUIDE_FILES[rel]);
});

test('opening a workspace brings the app’s older guides up to date and writes missing ones', async () => {
  const root = await tmp();
  await adoptFolder(root);
  await writeFile(join(root, 'AGENTS.md'), '# Old guide\n<!-- quest-notebook-guide: 0 -->\nOld advice.\n');
  await rm(join(root, 'GEMINI.md'));
  await rm(join(root, '.claude'), { recursive: true });
  await adoptFolder(root);
  for (const rel of GUIDE_PATHS) expect(await read(root, rel)).toBe(GUIDE_FILES[rel]);
});

test('a guide someone else wrote, or one whose version mark was removed to keep edits, is left alone', async () => {
  const root = await tmp();
  await adoptFolder(root);
  await writeFile(join(root, 'CLAUDE.md'), '# My own rules\n');
  const edited = GUIDE_FILES['AGENTS.md'].replace(/<!-- quest-notebook-guide: \d+ -->\n/, '') + '\nMy own note.\n';
  await writeFile(join(root, 'AGENTS.md'), edited);
  await adoptFolder(root);
  expect(await read(root, 'CLAUDE.md')).toBe('# My own rules\n');
  expect(await read(root, 'AGENTS.md')).toBe(edited);
});

test('a guide written by a newer version of the app is left alone', async () => {
  const root = await tmp();
  await adoptFolder(root);
  const newer = '# Newer guide\n<!-- quest-notebook-guide: 999 -->\n';
  await writeFile(join(root, 'AGENTS.md'), newer);
  await adoptFolder(root);
  expect(await read(root, 'AGENTS.md')).toBe(newer);
});
