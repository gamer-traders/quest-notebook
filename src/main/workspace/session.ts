import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { formatJson } from '@shared/formatJson';
import type { DiskDelta, FileChange, FlushBatch, FlushResult, UiState, WorkspaceSnapshot } from '@shared/ipc';
import { applyFlush } from './apply';
import { insideRoot, writeFileAtomic } from './paths';
import { STATE_PATH, scanWorkspace, type ScanIndex } from './scan';
import { diffScans, fileChanges, knownAfterFlush, knownFromScan, watchWorkspace, type Known } from './watch';

/** A page or drawing file the app rewrote. `path` is relative to the workspace folder, with '/' between parts. */
export interface RepairedFile {
  path: string;
  /** Null for a file that is new. */
  before: string | null;
  after: string;
}

export interface SessionEvents {
  /** Something changed on disk outside the app. */
  change(delta: DiskDelta): void;
  /** The workspace folder is gone. */
  lost(message: string): void;
  /** The page and drawing files that changed on disk outside the app, by what they held before. */
  fileChanges?(changes: FileChange[]): void;
  /**
   * The window saved pages only to fill in or tidy what an outside write left (a batch's `repairs`): the files of each
   * such page that changed, by what they held before and after. The page file comes first, and is listed whenever any of
   * its files changed, even if it didn't, so its text can be checked too.
   */
  repaired?(files: RepairedFile[]): void;
}

/** A page's file and drawing files as main knows them, copied, so a flush updating the index in place leaves them be. */
interface PageFiles {
  path: string;
  text: string;
  /** Drawing file path → text. */
  drawings: Map<string, string>;
}

function pageFiles(index: ScanIndex, id: string): PageFiles | null {
  const entry = index.pages.get(id);
  if (!entry || entry.error !== undefined) return null;
  const folder = entry.path.replace(/\.json$/i, '');
  return { path: entry.path, text: entry.text, drawings: new Map(Object.entries(entry.sidecars ?? {}).map(([name, file]) => [`${folder}/${name}`, file.text])) };
}

/** What a save changed in a page's files: the page file, then its drawing files that changed. Nothing for a page that moved. */
function changedFiles(before: PageFiles, after: PageFiles | null): RepairedFile[] {
  if (!after || after.path !== before.path) return [];
  const drawings = [...after.drawings]
    .filter(([path, text]) => before.drawings.get(path) !== text)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, text]) => ({ path, before: before.drawings.get(path) ?? null, after: text }));
  if (before.text === after.text && drawings.length === 0) return [];
  return [{ path: after.path, before: before.text, after: after.text }, ...drawings];
}

/**
 * One open workspace: its folder, what main knows is in it, and a watcher. Scans and writes take turns,
 * so a rescan never reads a folder half way through the app's own changes.
 */
export class WorkspaceSession {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private stopWatching: () => void = () => {};
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  /** How many changes have been reported, and which one last touched each page. */
  private seq = 0;
  private changedAt = new Map<string, number>();

  private constructor(
    readonly root: string,
    private known: Known,
    public snapshot: WorkspaceSnapshot,
    private readonly events: SessionEvents,
    private readonly trash: (abs: string) => Promise<void>,
  ) {}

  /** `checkMs` is how often to look that the folder is still there: deleting it sends no change event. */
  static async open(root: string, isNew: boolean, events: SessionEvents, trash: (abs: string) => Promise<void>, checkMs = 2000): Promise<WorkspaceSession> {
    const scanned = await scanWorkspace(root);
    const session = new WorkspaceSession(root, knownFromScan(scanned), { ...scanned.snapshot, isNew }, events, trash);
    session.stopWatching = watchWorkspace(root, () => void session.rescan());
    session.presenceTimer = setInterval(() => void session.checkPresent(), checkMs);
    return session;
  }

  private async checkPresent(): Promise<void> {
    if (this.closed) return;
    if (!(await this.present())) void this.rescan();
  }

  private present(): Promise<boolean> {
    return stat(this.root).then((s) => s.isDirectory(), () => false);
  }

  /** The folder went away: nothing more is written, and the window is told. */
  private gone(): void {
    if (this.closed) return;
    this.close();
    this.events.lost(`Couldn't find ${this.root}`);
  }

  private turn<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  get name(): string {
    return this.snapshot.name;
  }

  /** A fresh read of the whole workspace, for a window that is loading it from scratch. */
  fresh(): Promise<WorkspaceSnapshot> {
    return this.turn(async () => {
      const scanned = await scanWorkspace(this.root, this.known.index);
      this.known = knownFromScan(scanned);
      this.snapshot = { ...scanned.snapshot, isNew: this.snapshot.isNew };
      return this.snapshot;
    });
  }

  flush(batch: FlushBatch): Promise<FlushResult> {
    return this.turn(async () => {
      if (this.closed) return { ok: false, error: 'This workspace is closed', paths: {} };
      // Writing into a folder that's gone would make it again, at the old place.
      if (!(await this.present())) {
        this.gone();
        return { ok: false, error: `Couldn't find ${this.root}`, paths: {} };
      }
      if (batch.root !== undefined && batch.root !== this.root) return { ok: false, error: 'These changes belong to another workspace', paths: {} };
      // A page changed on disk after the window planned this batch is left for the window to plan again.
      const seen = batch.seenSeq ?? this.seq;
      const isStale = (id: string) => (this.changedAt.get(id) ?? 0) > seen;
      const stale = [...batch.saves.map((s) => s.id), ...batch.deletes].filter(isStale);
      const fresh = { ...batch, saves: batch.saves.filter((s) => !isStale(s.id)), deletes: batch.deletes.filter((id) => !isStale(id)) };
      // Pages saved only to tidy what an outside write left, as they were on disk before.
      const repairs = new Set(Array.isArray(batch.repairs) ? batch.repairs : []);
      const tidied = fresh.saves.flatMap((s) => {
        const files = repairs.has(s.id) ? pageFiles(this.known.index, s.id) : null;
        return files ? [{ id: s.id, files }] : [];
      });
      const result = await applyFlush(this.root, this.known.index, fresh, { trash: this.trash, now: () => new Date() });
      this.known = knownAfterFlush(this.known, fresh);
      const repaired = tidied.flatMap(({ id, files }) => changedFiles(files, pageFiles(this.known.index, id)));
      if (repaired.length) {
        // What was saved stays saved, whatever the listener does.
        try {
          this.events.repaired?.(repaired);
        } catch (error) {
          console.error('Reporting a tidy-up failed:', error);
        }
      }
      const all = [...stale, ...(result.stale ?? [])];
      return all.length ? { ...result, stale: all } : result;
    });
  }

  saveUi(ui: UiState, root?: string): Promise<void> {
    return this.turn(async () => {
      if (this.closed || (root !== undefined && root !== this.root)) return;
      if (!(await this.present())) return this.gone();
      await mkdir(join(this.root, '.quest'), { recursive: true });
      await writeFileAtomic(insideRoot(this.root, STATE_PATH), formatJson(ui));
    });
  }

  /** Reads the folder again now, in turn: afterwards every outside write made before the call has been seen and reported. */
  settle(): Promise<void> {
    return this.rescan();
  }

  /**
   * Runs `work` in the queue, so no scan reads the folder half way through it. With `rescanAfter`, the folder is read
   * again in the same turn of the queue, even if `work` fails: what it wrote is reported before anything queued behind
   * it runs, so a save planned before it is refused as stale.
   */
  exclusive<T>(work: () => Promise<T>, opts: { rescanAfter?: boolean } = {}): Promise<T> {
    return this.turn(async () => {
      if (this.closed) throw new Error('This workspace is closed');
      try {
        return await work();
      } finally {
        if (opts.rescanAfter) await this.rescanNow();
      }
    });
  }

  pageIdForPath(path: string): string | undefined {
    return this.snapshot.pages.find((p) => p.path === path)?.id;
  }

  pageInfo(id: string): { path: string; title: string } | undefined {
    const record = this.snapshot.pages.find((p) => p.id === id);
    if (!record) return undefined;
    const title = (record.file as { title?: unknown } | undefined)?.title;
    const name = record.path.slice(record.path.lastIndexOf('/') + 1).replace(/\.json$/i, '');
    return { path: record.path, title: typeof title === 'string' && title.trim() ? title : name };
  }

  private rescan(): Promise<void> {
    return this.turn(() => this.rescanNow());
  }

  /** A rescan's body, for a caller already holding the queue. */
  private async rescanNow(): Promise<void> {
    if (this.closed) return;
    if (!(await this.present())) return this.gone();
    try {
      const next = await scanWorkspace(this.root, this.known.index);
      const delta = diffScans(this.known, next);
      const changes = fileChanges(this.known, next);
      this.known = knownFromScan(next);
      this.snapshot = { ...next.snapshot, isNew: false };
      if (delta) {
        const seq = ++this.seq;
        for (const page of delta.pages) this.changedAt.set(page.id, seq);
        for (const id of delta.removed) this.changedAt.set(id, seq);
        this.events.change({ ...delta, seq });
      }
      if (changes.length) this.events.fileChanges?.(changes);
    } catch (error) {
      console.error('Reading the workspace after a change failed:', error);
    }
  }

  close(): void {
    this.closed = true;
    this.stopWatching();
    if (this.presenceTimer) clearInterval(this.presenceTimer);
  }
}
