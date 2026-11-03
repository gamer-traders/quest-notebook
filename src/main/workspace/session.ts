import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { formatJson } from '@shared/formatJson';
import type { DiskDelta, FlushBatch, FlushResult, MarkdownSave, MarkdownSaveResult, UiState, WorkspaceSnapshot } from '@shared/ipc';
import { applyFlush } from './apply';
import { insideRoot, writeFileAtomic } from './paths';
import { STATE_PATH, scanWorkspace } from './scan';
import { diffScans, knownAfterFlush, knownFromScan, watchWorkspace, type Known } from './watch';

export interface SessionEvents {
  /** Something changed on disk outside the app. */
  change(delta: DiskDelta): void;
  /** The workspace folder is gone. */
  lost(message: string): void;
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
      const result = await applyFlush(this.root, this.known.index, fresh, { trash: this.trash, now: () => new Date() });
      this.known = knownAfterFlush(this.known, fresh);
      const all = [...stale, ...(result.stale ?? [])];
      return all.length ? { ...result, stale: all } : result;
    });
  }

  /**
   * Writes a Markdown file edited in the window. Only a file main found in a space can be written, and never over a
   * change made on disk since the window read it (`base`): that save is refused as stale, and the file left as it is.
   */
  saveMarkdown(save: MarkdownSave): Promise<MarkdownSaveResult> {
    return this.turn(async (): Promise<MarkdownSaveResult> => {
      if (this.closed) return { ok: false, error: 'This workspace is closed' };
      if (typeof save?.path !== 'string' || typeof save.text !== 'string' || typeof save.base !== 'string') return { ok: false, error: 'Not a Markdown save' };
      if (save.root !== undefined && save.root !== this.root) return { ok: false, error: 'This file belongs to another workspace' };
      if (!(await this.present())) {
        this.gone();
        return { ok: false, error: `Couldn't find ${this.root}` };
      }
      if (!this.known.index.markdown.has(save.path)) return { ok: false, error: `${save.path} isn't a Markdown file in this workspace` };
      try {
        const abs = insideRoot(this.root, save.path);
        const current = await readFile(abs, 'utf8').catch(() => null);
        if (current === null) return { ok: false, error: `Couldn't find ${save.path}` };
        if (current !== save.base) return { ok: false, stale: true, error: `${save.path} changed on disk` };
        await writeFileAtomic(abs, save.text);
        const info = await stat(abs);
        // Known as written, so the watcher doesn't take it for a change made outside.
        this.known.index.markdown.set(save.path, { text: save.text, mtimeMs: info.mtimeMs, size: info.size });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
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

  private rescan(): Promise<void> {
    return this.turn(async () => {
      if (this.closed) return;
      if (!(await this.present())) return this.gone();
      try {
        const next = await scanWorkspace(this.root, this.known.index);
        const delta = diffScans(this.known, next);
        this.known = knownFromScan(next);
        this.snapshot = { ...next.snapshot, isNew: false };
        if (delta) {
          const seq = ++this.seq;
          for (const page of delta.pages) this.changedAt.set(page.id, seq);
          for (const id of delta.removed) this.changedAt.set(id, seq);
          this.events.change({ ...delta, seq });
        }
      } catch (error) {
        console.error('Reading the workspace after a change failed:', error);
      }
    });
  }

  close(): void {
    this.closed = true;
    this.stopWatching();
    if (this.presenceTimer) clearInterval(this.presenceTimer);
  }
}
