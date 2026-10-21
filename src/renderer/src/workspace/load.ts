import type { DiskDelta, PageRecord, WorkspaceSnapshot } from '@shared/ipc';
import type { DrawingCell, Notebook, Space } from '../types';
import { childrenOf } from '../page/tree';
import { fileToPage } from '../files/convert';
import { resolveLinks } from '../files/links';

/** A workspace as the store holds it, plus the pages whose files were missing fields and should be written back. */
export interface LoadedState {
  notebooks: Notebook[];
  spaces: Space[];
  journalSpaceId: string | null;
  expanded: Record<string, true>;
  panelCollapsed: Record<string, true>;
  activeId: string | null;
  repaired: Set<string>;
  /** Drawings whose files need writing in the app's form, by page. */
  drawingsToWrite: Map<string, Set<string>>;
}

const baseName = (path: string) => (path.split('/').at(-1) ?? path).replace(/\.json$/i, '');
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One page from its record. A file that couldn't be read, or isn't a page, becomes a page that shows why. */
function recordToNotebook(record: PageRecord, fallbackPosition: number): { notebook: Notebook; repaired: boolean; drawingsToWrite?: Set<string> } {
  const meta = { id: record.id, spaceId: record.spaceId, parentId: record.parentId, path: record.path, fileTimeMs: record.mtimeMs, fallbackPosition };
  if (record.error === undefined) {
    try {
      const loaded = fileToPage(record.file, meta, record.drawings ?? {});
      if (record.titleFromPath !== undefined) return { ...loaded, notebook: { ...loaded.notebook, title: record.titleFromPath }, repaired: true };
      return loaded;
    } catch (error) {
      return { notebook: unreadable(record, fallbackPosition, message(error)), repaired: false };
    }
  }
  return { notebook: unreadable(record, fallbackPosition, record.error), repaired: false };
}

function unreadable(record: PageRecord, position: number, loadError: string): Notebook {
  return {
    id: record.id,
    title: baseName(record.path),
    spaceId: record.spaceId,
    parentId: record.parentId,
    position,
    createdAt: record.mtimeMs,
    updatedAt: record.mtimeMs,
    blocks: [],
    items: {},
    path: record.path,
    loadError,
  };
}

const ownPosition = (record: PageRecord): number | null => {
  const p = (record.file as { position?: unknown } | undefined)?.position;
  return typeof p === 'number' && Number.isFinite(p) ? p : null;
};

/** Pages from records. A page without a position goes after its siblings, in the order the records come. */
function recordsToNotebooks(records: PageRecord[], positionOf: (record: PageRecord) => number | null, siblingsOf: (record: PageRecord) => number[]) {
  const highest = new Map<string, number>();
  const group = (r: PageRecord) => `${r.spaceId}\u0000${r.parentId ?? ''}`;
  for (const r of records) {
    const p = positionOf(r);
    const key = group(r);
    const top = Math.max(highest.get(key) ?? -1, p ?? -1, ...siblingsOf(r));
    highest.set(key, top);
  }
  const repaired = new Set<string>();
  const drawingsToWrite = new Map<string, Set<string>>();
  const notebooks = records.map((r) => {
    const key = group(r);
    let fallback = positionOf(r);
    if (fallback === null) {
      fallback = (highest.get(key) ?? -1) + 1;
      highest.set(key, fallback);
    }
    const loaded = recordToNotebook(r, fallback);
    if (loaded.repaired) repaired.add(r.id);
    if (loaded.drawingsToWrite?.size) drawingsToWrite.set(r.id, loaded.drawingsToWrite);
    return loaded.notebook;
  });
  return { notebooks, repaired, drawingsToWrite };
}

const flags = (ids: string[], present: Set<string>): Record<string, true> => Object.fromEntries(ids.filter((id) => present.has(id)).map((id) => [id, true as const]));

function firstPage(notebooks: Notebook[], spaces: Space[]): string | null {
  for (const space of spaces) {
    const first = childrenOf(notebooks, space.id, null)[0];
    if (first) return first.id;
  }
  return null;
}

/** A whole workspace, as main read it, turned into the store's pages and spaces. */
export function snapshotToState(snapshot: WorkspaceSnapshot): LoadedState {
  const { notebooks: loaded, repaired, drawingsToWrite } = recordsToNotebooks(snapshot.pages, ownPosition, () => []);
  const spaces = snapshot.spaces.map((s) => ({ ...s }));
  const notebooks = resolveLinks(loaded, spaces);
  const present = new Set(notebooks.map((n) => n.id));
  const open = snapshot.ui.openPageId;
  return {
    notebooks,
    spaces,
    journalSpaceId: snapshot.journalSpaceId,
    expanded: flags(snapshot.ui.expanded, present),
    panelCollapsed: flags(snapshot.ui.collapsedPanels, present),
    activeId: open && present.has(open) ? open : firstPage(notebooks, spaces),
    repaired,
    drawingsToWrite,
  };
}

/**
 * Pages changed on disk, ready to go in the store. A page that lost its position keeps the one it had;
 * a new one without a position goes after its siblings. Links are resolved later, over every page.
 */
export function deltaToNotebooks(
  delta: DiskDelta,
  current: Notebook[],
): { upserts: Notebook[]; removed: string[]; repaired: Set<string>; drawingsToWrite: Map<string, Set<string>> } {
  const byId = new Map(current.map((n) => [n.id, n]));
  const positionOf = (r: PageRecord) => ownPosition(r) ?? byId.get(r.id)?.position ?? null;
  const siblingsOf = (r: PageRecord) => current.filter((n) => n.spaceId === r.spaceId && n.parentId === r.parentId && n.id !== r.id).map((n) => n.position);
  const { notebooks, repaired, drawingsToWrite } = recordsToNotebooks(delta.pages, positionOf, siblingsOf);
  return { upserts: notebooks, removed: delta.removed, repaired, drawingsToWrite };
}

/** The drawings a page record holds, read from its file and its drawing files. None when the file can't be read. */
export function drawingsIn(record: PageRecord): DrawingCell[] {
  if (record.error !== undefined) return [];
  try {
    const meta = { id: record.id, spaceId: record.spaceId, parentId: record.parentId, path: record.path, fileTimeMs: record.mtimeMs, fallbackPosition: 0 };
    const { notebook } = fileToPage(record.file, meta, record.drawings ?? {});
    return Object.values(notebook.items).filter((item): item is DrawingCell => item.type === 'drawing');
  } catch {
    return [];
  }
}
