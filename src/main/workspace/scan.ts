import { randomBytes } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { formatJson } from '@shared/formatJson';
import { nameKey } from '@shared/names';
import { EMPTY_UI, SIDECAR_NAME, type PageRecord, type SpaceRecord, type UiState, type WorkspaceConfig, type WorkspaceSnapshot } from '@shared/ipc';
import { insideRoot, writeFileAtomic } from './paths';

/** What main knows of each file it has seen, so it can tell its own writes from changes made outside. */
export interface PageEntry {
  path: string;
  mtimeMs: number;
  size: number;
  text: string;
  error?: string;
}

export interface ScanIndex {
  /** Space folder name → space id. */
  spaceIds: Map<string, string>;
  /** Page id → its file. */
  pages: Map<string, PageEntry>;
}

export interface ScanResult {
  snapshot: WorkspaceSnapshot;
  index: ScanIndex;
}

export const CONFIG_PATH = '.quest/workspace.json';
export const STATE_PATH = '.quest/state.json';

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Eight random lowercase letters and digits. */
export function newId(): string {
  return [...randomBytes(8)].map((b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

/** Folders and files the workspace doesn't treat as spaces or pages. */
export const isIgnoredName = (name: string) => name.startsWith('.') || name.endsWith('.tmp');

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A page file: a JSON object with a list of blocks. */
export const isPageShaped = (v: unknown): v is Record<string, unknown> & { blocks: unknown[] } => isRecord(v) && Array.isArray(v.blocks);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export async function readConfig(root: string): Promise<WorkspaceConfig> {
  try {
    const raw: unknown = JSON.parse(await readFile(insideRoot(root, CONFIG_PATH), 'utf8'));
    if (!isRecord(raw)) throw new Error('not an object');
    return {
      format: 1,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : basename(root),
      spaces: strings(raw.spaces),
      journalSpace: typeof raw.journalSpace === 'string' ? raw.journalSpace : null,
    };
  } catch {
    return { format: 1, name: basename(root), spaces: [], journalSpace: null };
  }
}

async function readUi(root: string): Promise<UiState> {
  try {
    const raw: unknown = JSON.parse(await readFile(insideRoot(root, STATE_PATH), 'utf8'));
    if (!isRecord(raw)) return EMPTY_UI;
    return {
      openPageId: typeof raw.openPageId === 'string' ? raw.openPageId : null,
      expanded: strings(raw.expanded),
      collapsedPanels: strings(raw.collapsedPanels),
    };
  } catch {
    return EMPTY_UI;
  }
}

const byName = (a: string, b: string) => a.localeCompare(b);

/** Space folders in sidebar order: those workspace.json lists first, in its order, then any others alphabetically. */
async function spaceFolders(root: string, listed: string[]): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const folders = entries.filter((e) => e.isDirectory() && !isIgnoredName(e.name)).map((e) => e.name);
  const present = new Set(folders);
  const ordered = listed.filter((name, i) => present.has(name) && listed.indexOf(name) === i);
  return [...ordered, ...folders.filter((name) => !ordered.includes(name)).sort(byName)];
}

interface Walk {
  root: string;
  pages: PageRecord[];
  index: ScanIndex;
  seenIds: Set<string>;
  /** Where each id was last time: a page copied since keeps the original's id in its file, and gives way. */
  prev?: ScanIndex;
}

async function remember(walk: Walk, id: string, rel: string, text: string, error?: string) {
  const info = await stat(insideRoot(walk.root, rel));
  walk.index.pages.set(id, { path: rel, mtimeMs: info.mtimeMs, size: info.size, text, ...(error ? { error } : {}) });
  return info.mtimeMs;
}

/** Reads one page file. A missing or repeated id is replaced and written back, with the rest of the file kept. */
async function readPage(walk: Walk, rel: string, spaceId: string, parentId: string | null): Promise<PageRecord> {
  let text = await readFile(insideRoot(walk.root, rel), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
    // Only page-shaped files are ever written to: anything else is shown with why, and left exactly as it is.
    if (!isPageShaped(parsed)) throw new Error('This file is not a page: a page is a JSON object with a "blocks" list.');
  } catch (error) {
    const id = `bad:${rel}`;
    const message = error instanceof Error ? error.message : String(error);
    const mtimeMs = await remember(walk, id, rel, text, message);
    return { id, spaceId, parentId, path: rel, mtimeMs, error: message };
  }

  let file = parsed as Record<string, unknown>;
  let id = typeof file.id === 'string' && file.id.trim() ? file.id : '';
  // Of two files with one id, the one where that id was before keeps it, if it's still there.
  const owner = id ? walk.prev?.pages.get(id)?.path : undefined;
  const ownerElsewhere = owner !== undefined && owner !== rel && (await stat(insideRoot(walk.root, owner)).then(() => true, () => false));
  if (!id || walk.seenIds.has(id) || ownerElsewhere) {
    id = newId();
    const { id: _replaced, ...rest } = file;
    file = { id, ...rest };
    text = formatJson(file);
    await writeFileAtomic(insideRoot(walk.root, rel), text);
  }
  walk.seenIds.add(id);
  const mtimeMs = await remember(walk, id, rel, text);
  return { id, spaceId, parentId, path: rel, mtimeMs, file };
}

const highestPosition = (records: PageRecord[]) =>
  records.reduce((max, r) => {
    const p = isRecord(r.file) ? r.file.position : undefined;
    return typeof p === 'number' && Number.isFinite(p) && p > max ? p : max;
  }, -1);

/** Reads the pages in a folder, and the folders of sub-pages beside them. */
async function walkFolder(walk: Walk, dir: string, spaceId: string, parentId: string | null): Promise<void> {
  const entries = (await readdir(insideRoot(walk.root, dir), { withFileTypes: true })).filter((e) => !isIgnoredName(e.name));
  const fileNames = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json')).map((e) => e.name).sort(byName);
  const folderNames = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(byName);

  const records: PageRecord[] = [];
  for (const name of fileNames) records.push(await readPage(walk, `${dir}/${name}`, spaceId, parentId));

  // A folder with no page file of its own becomes a page, so the pages in it have somewhere to sit.
  const pageNames = new Set(fileNames.map((name) => nameKey(name.slice(0, -'.json'.length))));
  let position = highestPosition(records);
  for (const folder of folderNames) {
    if (pageNames.has(nameKey(folder))) continue;
    // Drawing pictures left behind by a page deleted or renamed outside the app don't make a page.
    const inside = (await readdir(insideRoot(walk.root, `${dir}/${folder}`))).filter((name) => !isIgnoredName(name));
    if (inside.length > 0 && inside.every((name) => SIDECAR_NAME.test(name))) continue;
    const id = newId();
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const rel = `${dir}/${folder}.json`;
    const file = { id, title: folder, position: ++position, created: now, updated: now, blocks: [] };
    const text = formatJson(file);
    await writeFileAtomic(insideRoot(walk.root, rel), text);
    walk.seenIds.add(id);
    const mtimeMs = await remember(walk, id, rel, text);
    records.push({ id, spaceId, parentId, path: rel, mtimeMs, file });
    pageNames.add(nameKey(folder));
  }

  walk.pages.push(...records);
  for (const record of records) {
    const base = nameKey(record.path.slice(dir.length + 1, -'.json'.length));
    const folder = folderNames.find((name) => nameKey(name) === base);
    if (folder !== undefined) await walkFolder(walk, `${dir}/${folder}`, spaceId, record.id);
  }
}

/** Reads a workspace folder: its spaces, every page file in them, and what the window last showed. */
export async function scanWorkspace(root: string, prev?: ScanIndex): Promise<ScanResult> {
  const config = await readConfig(root);
  const folders = await spaceFolders(root, config.spaces);
  const index: ScanIndex = { spaceIds: new Map(), pages: new Map() };
  const spaces: SpaceRecord[] = folders.map((name) => {
    const id = prev?.spaceIds.get(name) ?? `s_${newId()}`;
    index.spaceIds.set(name, id);
    return { id, name };
  });

  const walk: Walk = { root, pages: [], index, seenIds: new Set(), prev };
  for (const space of spaces) await walkFolder(walk, space.name, space.id, null);

  const journal = config.journalSpace === null ? undefined : spaces.find((s) => s.name === config.journalSpace);
  return {
    snapshot: {
      root,
      name: config.name,
      spaces,
      journalSpaceId: journal?.id ?? null,
      pages: walk.pages,
      ui: await readUi(root),
      isNew: false,
    },
    index,
  };
}
