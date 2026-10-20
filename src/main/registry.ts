import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { formatJson } from '@shared/formatJson';
import type { RecentWorkspace } from '@shared/ipc';
import { writeFileAtomic } from './workspace/paths';

/** The workspaces this computer has opened, kept in the app's own data folder. */
export interface Registry {
  recent: RecentWorkspace[];
  /** The workspace to reopen at launch. */
  last: string | null;
}

const KEEP = 10;

export async function readRegistry(file: string): Promise<Registry> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<Registry>;
    const recent = Array.isArray(raw.recent)
      ? raw.recent.filter((w): w is RecentWorkspace => typeof w?.path === 'string' && typeof w.name === 'string' && typeof w.lastOpened === 'string')
      : [];
    return { recent, last: typeof raw.last === 'string' ? raw.last : null };
  } catch {
    return { recent: [], last: null };
  }
}

async function write(file: string, registry: Registry): Promise<Registry> {
  await mkdir(dirname(file), { recursive: true });
  await writeFileAtomic(file, formatJson(registry));
  return registry;
}

/** Moves the workspace to the top of the list and makes it the one to reopen. */
export async function touchWorkspace(file: string, path: string, name: string, now: Date): Promise<Registry> {
  const { recent } = await readRegistry(file);
  const entry: RecentWorkspace = { path, name, lastOpened: now.toISOString() };
  return write(file, { recent: [entry, ...recent.filter((w) => w.path !== path)].slice(0, KEEP), last: path });
}

/** Takes the workspace off the list. Its files are left alone. */
export async function forgetWorkspace(file: string, path: string): Promise<Registry> {
  const { recent, last } = await readRegistry(file);
  const rest = recent.filter((w) => w.path !== path);
  return write(file, { recent: rest, last: last === path ? (rest[0]?.path ?? null) : last });
}
