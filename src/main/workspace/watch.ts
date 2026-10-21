import { watch, type FSWatcher } from 'node:fs';
import type { DiskDelta, FileChange, FlushBatch, SpaceRecord } from '@shared/ipc';
import { safeName } from '@shared/names';
import type { PageEntry, ScanIndex, ScanResult } from './scan';
import { spaceOrder } from './apply';
import { STATE_PATH } from './scan';

/**
 * What main last knew to be on disk: from a scan, kept up to date by the app's own writes. Changes made
 * outside the app are whatever a fresh scan finds beyond it.
 */
export interface Known {
  spaces: SpaceRecord[];
  journalSpaceId: string | null;
  index: ScanIndex;
}

export const knownFromScan = (result: ScanResult): Known => ({
  spaces: result.snapshot.spaces,
  journalSpaceId: result.snapshot.journalSpaceId,
  index: result.index,
});

/** After the app's own flush: the spaces in the order it wrote them, under their folder names. The index is already up to date. */
export function knownAfterFlush(known: Known, batch: FlushBatch): Known {
  if (batch.spaces.length === 0) return known;
  const spaces = spaceOrder(batch, known.index).map((folder) => ({ id: known.index.spaceIds.get(folder)!, name: folder }));
  const journalKnown = spaces.some((s) => s.id === batch.journalSpaceId);
  return { ...known, spaces, journalSpaceId: batch.journalSpaceId === null ? null : journalKnown ? batch.journalSpaceId : known.journalSpaceId };
}

const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/i, '');

/** A file name the app would give a page with this title, numbered or not. */
function namedFor(base: string, title: unknown): boolean {
  if (typeof title !== 'string') return false;
  const name = safeName(title);
  return base === name || (base.startsWith(`${name} `) && /^\d+$/.test(base.slice(name.length + 1)));
}

function titleIn(text: string): unknown {
  try {
    return (JSON.parse(text) as { title?: unknown }).title;
  } catch {
    return undefined;
  }
}

/** Whether a page's drawing files are the same: the same names, holding the same text. */
function sameDrawings(a: PageEntry, b: PageEntry): boolean {
  const x = a.sidecars ?? {};
  const y = b.sidecars ?? {};
  const names = Object.keys(x);
  return names.length === Object.keys(y).length && names.every((n) => y[n]?.text === x[n].text);
}

const sameSpaces = (a: SpaceRecord[], b: SpaceRecord[]) => a.length === b.length && a.every((s, i) => s.id === b[i].id && s.name === b[i].name);

/** What a fresh scan found that main didn't know: pages added, changed, moved or gone, and the spaces. Null for nothing. */
export function diffScans(prev: Known, next: ScanResult): Omit<DiskDelta, 'seq'> | null {
  const pages = next.snapshot.pages.flatMap((record) => {
    const before = prev.index.pages.get(record.id);
    const now = next.index.pages.get(record.id);
    if (before && now && before.path === now.path && before.text === now.text && !!before.error === !!now.error && sameDrawings(before, now)) return [];
    if (before && before.path !== record.path) {
      const oldBase = baseOf(before.path);
      const newBase = baseOf(record.path);
      const title = titleIn(before.text);
      // Renamed outside the app: the new file name is the new title.
      if (oldBase !== newBase && namedFor(oldBase, title) && !namedFor(newBase, title)) return [{ ...record, titleFromPath: newBase }];
    }
    return [record];
  });
  const present = new Set(next.snapshot.pages.map((p) => p.id));
  const removed = [...prev.index.pages.keys()].filter((id) => !present.has(id));
  const spacesChanged = !sameSpaces(prev.spaces, next.snapshot.spaces) || prev.journalSpaceId !== next.snapshot.journalSpaceId;
  if (!pages.length && !removed.length && !spacesChanged) return null;
  return { spaces: next.snapshot.spaces, journalSpaceId: next.snapshot.journalSpaceId, pages, removed };
}

/** Every page file and drawing file in an index, by path: its text, and its page's id. */
function filesByPath(index: ScanIndex): Map<string, { text: string; pageId: string; drawing: boolean }> {
  const files = new Map<string, { text: string; pageId: string; drawing: boolean }>();
  for (const [pageId, entry] of index.pages) {
    files.set(entry.path, { text: entry.text, pageId, drawing: false });
    const folder = entry.path.replace(/\.json$/i, '');
    for (const [name, sidecar] of Object.entries(entry.sidecars ?? {})) files.set(`${folder}/${name}`, { text: sidecar.text, pageId, drawing: true });
  }
  return files;
}

/**
 * The page and drawing files whose text differs, by path, between what main knew and a fresh scan. A file
 * that was removed isn't listed. Paths are compared, not ids: a page that stops parsing changes its id.
 */
export function fileChanges(prev: Known, next: ScanResult): FileChange[] {
  const before = filesByPath(prev.index);
  const changes: FileChange[] = [];
  for (const [path, now] of filesByPath(next.index)) {
    const was = before.get(path);
    if (was && was.text === now.text) continue;
    changes.push({
      path,
      ...(now.pageId.startsWith('bad:') ? {} : { pageId: now.pageId }),
      kind: was ? 'edited' : 'created',
      drawing: now.drawing,
      before: was ? was.text : null,
      after: now.text,
    });
  }
  return changes;
}

/**
 * Calls back a moment after anything in the workspace changes, once for a burst of changes. The app's
 * own UI state file and half-written temporary files don't count. Returns a function that stops watching.
 */
export function watchWorkspace(root: string, onChange: () => void, debounceMs = 150): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      const name = filename?.toString().split('\\').join('/');
      // Writing into .quest/chats makes the OS report .quest and its folder as changed too.
      if (name === STATE_PATH || name?.endsWith('.tmp') || name === '.quest' || name === '.quest/chats' || name?.startsWith('.quest/chats/')) return;
      schedule();
    });
    watcher.on('error', (error) => console.error('Watching the workspace failed:', error));
  } catch (error) {
    console.error('The workspace folder could not be watched:', error);
  }
  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}
