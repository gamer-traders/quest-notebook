import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { formatJson } from '@shared/formatJson';
import type { WorkspaceConfig } from '@shared/ipc';
import { safeName } from '@shared/names';
import { README_MARKER, WORKSPACE_README } from '@shared/readme';
import { GUIDE_FILES, GUIDE_VERSION, guideVersionOf } from '@shared/guide';
import { writeFileAtomic } from './paths';
import { CONFIG_PATH } from './scan';

const FIRST_SPACES = ['Journal', 'Markets', 'Lessons'];

const exists = (path: string) => stat(path).then(() => true, () => false);

/** Writes the README unless the folder already has one of its own. */
async function writeReadme(root: string) {
  const path = join(root, 'README.md');
  if (!(await exists(path))) await writeFile(path, WORKSPACE_README, 'utf8');
}

/** A README an earlier version of the app wrote is brought up to date. One someone else wrote is left alone. */
async function refreshReadme(root: string) {
  const path = join(root, 'README.md');
  const current = await readFile(path, 'utf8').catch(() => null);
  if (current !== null && current.startsWith('# Quest Notebook workspace') && !current.includes(README_MARKER) && current !== WORKSPACE_README) {
    await writeFile(path, WORKSPACE_README, 'utf8');
  }
}

/**
 * The guides AI tools read, kept as the app writes them: a missing one is written, and one an older version of the
 * app wrote is replaced. A file someone else wrote, or one whose version mark was taken out, is theirs. A guide that
 * can't be written never stops the workspace from opening.
 */
async function writeGuides(root: string) {
  for (const [rel, text] of Object.entries(GUIDE_FILES)) {
    const path = join(root, rel);
    try {
      const info = await stat(path).catch(() => null);
      if (info && !info.isFile()) continue;
      if (info) {
        const version = guideVersionOf(await readFile(path, 'utf8'));
        if (version === null || version >= GUIDE_VERSION) continue;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFileAtomic(path, text);
    } catch (error) {
      console.error(`Couldn't write the AI guide ${rel}:`, error);
    }
  }
}

async function writeConfig(root: string, config: WorkspaceConfig) {
  await mkdir(join(root, '.quest'), { recursive: true });
  await writeFile(join(root, CONFIG_PATH), formatJson(config), 'utf8');
}

/** Makes `<parentDir>/<name>` a new workspace with the first three spaces. Returns its folder. */
export async function createWorkspace(parentDir: string, name: string): Promise<string> {
  const root = join(parentDir, safeName(name));
  if ((await exists(root)) && (await readdir(root)).length > 0) throw new Error('A folder with that name already has files in it');
  await mkdir(root, { recursive: true });
  for (const space of FIRST_SPACES) await mkdir(join(root, space), { recursive: true });
  await writeConfig(root, { format: 1, name: name.trim() || basename(root), spaces: FIRST_SPACES, journalSpace: 'Journal' });
  await writeReadme(root);
  await writeGuides(root);
  return root;
}

/** The person chose not to make a folder with files in it a workspace. */
export class AdoptDeclined extends Error {
  constructor(root: string) {
    super(`${root} was not opened`);
  }
}

/**
 * Makes an existing folder a workspace, if it isn't one yet. A folder that already has files in it is only
 * made one if `confirm` agrees: its folders become spaces, and folders without a page file get one. A folder
 * that's gone is never made again.
 */
export async function adoptFolder(root: string, confirm?: (root: string) => Promise<boolean>): Promise<{ isNew: boolean }> {
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`Couldn't find ${root}`);
  if (await exists(join(root, CONFIG_PATH))) {
    await refreshReadme(root);
    await writeGuides(root);
    return { isNew: false };
  }
  const hasFiles = (await readdir(root)).some((name) => !name.startsWith('.'));
  if (hasFiles && confirm && !(await confirm(root))) throw new AdoptDeclined(root);
  await writeConfig(root, { format: 1, name: basename(root), spaces: [], journalSpace: null });
  await writeReadme(root);
  await writeGuides(root);
  return { isNew: true };
}
