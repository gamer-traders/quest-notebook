import type { StoreApi, UseBoundStore } from 'zustand';
import { create } from 'zustand';
import { formatJson } from '@shared/formatJson';
import { SIDECAR_NAME, type FlushBatch, type PageSave, type QuestApi, type UiState } from '@shared/ipc';
import type { DrawingCell, Notebook, Space } from '../types';
import { flattenBlocks } from '../page/blocks';
import { drawingToSvg } from '../drawing/svg';
import { drawingFileName } from '../drawing/model';
import { displayTitle } from '../page/tree';
import { pageToFile } from '../files/convert';
import { linkWriter, linksTo } from '../files/links';

/** The part of the store that lives on disk. */
export interface SyncSlice {
  notebooks: Notebook[];
  spaces: Space[];
  journalSpaceId: string | null;
}

/**
 * What was last sent for a page: its file text, where it sits, and the drawings on disk as they were sent. A page
 * is saved when its text or place differs; a drawing is sent when it isn't the one on disk.
 */
interface Sent {
  json: string;
  spaceId: string;
  parentId: string | null;
  drawings: Map<string, DrawingCell>;
}

export type Baseline = Map<string, Sent>;

/** Whether saving to disk is working, for the banner that says when it isn't. */
export const useSaveStatus = create<{ error: string | null }>(() => ({ error: null }));

const serialize = (nb: Notebook, write: ReturnType<typeof linkWriter>) => formatJson(pageToFile(nb, write));

/**
 * What's on disk for these pages, as far as the window knows. Pages in `unsaved` are left out, so they're saved,
 * and so are drawings in `drawingsToWrite`, by page.
 */
export function baselineFor(slice: SyncSlice, unsaved: Set<string>, drawingsToWrite: Map<string, Set<string>> = new Map()): Baseline {
  const write = linkWriter(slice.notebooks, slice.spaces);
  const baseline: Baseline = new Map();
  for (const nb of slice.notebooks) {
    if (nb.loadError) continue;
    const drawings = drawingsOf(nb);
    for (const id of drawingsToWrite.get(nb.id) ?? []) drawings.delete(id);
    // A page to write back gets its file written; its drawings are on disk as they are, and stay so.
    baseline.set(nb.id, { json: unsaved.has(nb.id) ? '' : serialize(nb, write), spaceId: nb.spaceId, parentId: nb.parentId, drawings });
  }
  return baseline;
}

// A drawing's file is made once per version of it: drawings change by being replaced, so the object is the key.
const svgs = new WeakMap<DrawingCell, string>();
const svgOf = (drawing: DrawingCell) => {
  let svg = svgs.get(drawing);
  if (svg === undefined) {
    svg = drawingToSvg(drawing);
    svgs.set(drawing, svg);
  }
  return svg;
};

/** The page's drawings, by id. Drawings whose id can't be a file name are left out: they get no file. */
function drawingsOf(nb: Notebook): Map<string, DrawingCell> {
  const out = new Map<string, DrawingCell>();
  for (const block of flattenBlocks(nb.blocks)) {
    const item = nb.items[block.id];
    if (block.type === 'drawing' && item?.type === 'drawing' && SIDECAR_NAME.test(drawingFileName(item.id))) out.set(item.id, item);
  }
  return out;
}

/** The drawing files to write, those that aren't on disk as they are now, and the files of drawings that went. */
function drawingChanges(drawings: Map<string, DrawingCell>, onDisk: Map<string, DrawingCell> | undefined) {
  const sidecars: Record<string, string> = {};
  for (const [id, drawing] of drawings) if (onDisk?.get(id) !== drawing) sidecars[drawingFileName(id)] = svgOf(drawing);
  const removed = [...(onDisk?.keys() ?? [])].filter((id) => !drawings.has(id)).map(drawingFileName);
  return { sidecars, removed };
}

const titleKey = (nb: Notebook) => displayTitle(nb.title).trim().toLowerCase();

/**
 * What to send main: pages whose file text or place changed, pages that are gone, and the spaces when they
 * changed. A page counts as possibly changed when its object did, when it's in `dirty`, or when it links to
 * a page whose title or place changed, since its links are written by title, or by path when titles clash.
 */
export function planFlush(prev: SyncSlice, next: SyncSlice, baseline: Baseline, dirty: Set<string>): { batch: FlushBatch | null; baseline: Baseline } {
  const before = new Map(prev.notebooks.map((n) => [n.id, n]));
  const after = new Map(next.notebooks.map((n) => [n.id, n]));
  const out: Baseline = new Map(baseline);

  const candidates = new Set<string>(dirty);
  const moved = new Set<string>();
  const clashTitles = new Set<string>();
  for (const nb of next.notebooks) {
    const old = before.get(nb.id);
    if (old === nb) continue;
    candidates.add(nb.id);
    if (!old || old.title !== nb.title || old.spaceId !== nb.spaceId || old.parentId !== nb.parentId) {
      moved.add(nb.id);
      clashTitles.add(titleKey(nb));
      if (old) clashTitles.add(titleKey(old));
    }
  }
  const deletes = prev.notebooks.filter((n) => !after.has(n.id)).map((n) => n.id);
  for (const id of deletes) clashTitles.add(titleKey(before.get(id)!));
  if (prev.spaces !== next.spaces) for (const nb of next.notebooks) moved.add(nb.id);

  // Pages linking to a page that was renamed, moved or deleted, or to one sharing such a page's title.
  if (moved.size || deletes.length) {
    const deleted = new Set(deletes);
    for (const nb of next.notebooks) {
      for (const target of linksTo(nb)) {
        const page = after.get(target);
        if (moved.has(target) || deleted.has(target) || (page && clashTitles.has(titleKey(page)))) {
          candidates.add(nb.id);
          break;
        }
      }
    }
  }

  const write = linkWriter(next.notebooks, next.spaces);
  const saves: PageSave[] = [];
  for (const id of candidates) {
    const nb = after.get(id);
    if (!nb || nb.loadError) continue;
    const json = serialize(nb, write);
    const sent = out.get(id);
    const drawings = drawingsOf(nb);
    const { sidecars, removed } = drawingChanges(drawings, sent?.drawings);
    const pageChanged = !sent || sent.json !== json || sent.spaceId !== nb.spaceId || sent.parentId !== nb.parentId;
    if (!pageChanged && !Object.keys(sidecars).length && !removed.length) continue;
    // A drawing changed alone goes without the page file, which hasn't changed.
    saves.push({
      id,
      spaceId: nb.spaceId,
      parentId: nb.parentId,
      title: nb.title,
      ...(pageChanged ? { json } : {}),
      sidecars,
      ...(removed.length ? { removedSidecars: removed } : {}),
    });
    out.set(id, { json, spaceId: nb.spaceId, parentId: nb.parentId, drawings });
  }
  for (const id of deletes) out.delete(id);

  const spacesChanged = prev.spaces !== next.spaces || prev.journalSpaceId !== next.journalSpaceId;
  if (!saves.length && !deletes.length && !spacesChanged) return { batch: null, baseline: out };
  const had = new Set(prev.spaces.map((s) => s.id));
  const has = new Set(next.spaces.map((s) => s.id));
  return {
    batch: {
      spaces: next.spaces,
      createdSpaces: next.spaces.filter((s) => !had.has(s.id)).map((s) => s.id),
      deletedSpaces: prev.spaces.filter((s) => !has.has(s.id)).map((s) => s.id),
      journalSpaceId: next.journalSpaceId,
      saves,
      deletes,
    },
    baseline: out,
  };
}

/**
 * The batch, naming the saves that only fill in or tidy what came from disk: pages marked for that and not edited here
 * since, so their object is still the one taken in from disk. Main tells Claude's undo about them.
 */
function withRepairs(batch: FlushBatch, prev: SyncSlice, next: SyncSlice, marked: Set<string>): FlushBatch {
  if (!marked.size) return batch;
  const before = new Map(prev.notebooks.map((n) => [n.id, n]));
  const after = new Map(next.notebooks.map((n) => [n.id, n]));
  const repairs = batch.saves.filter((s) => marked.has(s.id) && before.has(s.id) && before.get(s.id) === after.get(s.id)).map((s) => s.id);
  return repairs.length ? { ...batch, repairs } : batch;
}

interface SyncedState extends SyncSlice {
  workspace: { root: string } | null;
  activeId: string | null;
  expanded: Record<string, boolean>;
  panelCollapsed: Record<string, boolean>;
}

export interface SyncHandle {
  /** Sends everything not yet sent, and waits until main has written it. */
  flush(): Promise<void>;
  /** Runs a store update that came from disk, change number `seq`: nothing in it is sent back. */
  applyFromDisk(update: () => void, seq?: number): void;
  /**
   * Pages to write back even if nothing in them changes, such as files that were missing fields. The save says it only
   * fills them in, unless they're edited here first.
   */
  markDirty(ids: Iterable<string>): void;
  /**
   * Drawings to write to their files, by page, such as strokes moving out of the page. The page files are left as they
   * are. Like `markDirty`, the save says it only tidies the page, unless it's edited here first.
   */
  writeDrawings(pageId: string, drawingIds: Iterable<string>): void;
  /**
   * Drawings changed on disk, for a page with unsent edits: each one not touched here since it was last on disk
   * takes the disk's version. The page's other edits stay.
   */
  adoptDrawings(pageId: string, drawings: DrawingCell[]): void;
  /** Pages with edits not yet sent to disk. An outside change to one of them loses to the edit. */
  pendingIds(): Set<string>;
  stop(): void;
}

const SAVE_DELAY = 300;
const UI_DELAY = 1000;
const RETRY_DELAY = 3000;

const slice = (s: SyncSlice): SyncSlice => ({ notebooks: s.notebooks, spaces: s.spaces, journalSpaceId: s.journalSpaceId });
const uiOf = (s: SyncedState): UiState => ({
  openPageId: s.activeId,
  expanded: Object.keys(s.expanded).filter((id) => s.expanded[id]),
  collapsedPanels: Object.keys(s.panelCollapsed).filter((id) => s.panelCollapsed[id]),
});
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Keeps the workspace folder in step with the store: a burst of edits is sent once, a moment after the last
 * one, with only the pages whose files change. What the window shows (open page, expanded rows) is saved
 * separately and less often.
 */
export function startSync<S extends SyncedState>(
  api: QuestApi['workspace'],
  store: UseBoundStore<StoreApi<S>>,
  unsaved: Set<string>,
  drawingsToWrite: Map<string, Set<string>> = new Map(),
  /** The last disk change the loaded workspace already holds. */
  seenAtStart = 0,
): SyncHandle {
  // Everything this sync sends is for the workspace open when it started.
  const root = store.getState().workspace?.root;
  let prev = slice(store.getState());
  let baseline = baselineFor(prev, unsaved, drawingsToWrite);
  let dirty = new Set([...unsaved, ...drawingsToWrite.keys()]);
  // Pages to be saved only to fill in or tidy what came from disk, starting with those that loaded that way.
  let repairs = new Set(dirty);
  let fromDisk = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let uiTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let lastUi = JSON.stringify(uiOf(store.getState()));
  // The last disk change taken in. Main refuses saves of pages that changed on disk after it.
  let seenSeq = seenAtStart;

  const schedule = (delay = SAVE_DELAY) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flushPages(), delay);
  };

  const saveUi = async () => {
    if (uiTimer) clearTimeout(uiTimer);
    uiTimer = null;
    const ui = uiOf(store.getState());
    const text = JSON.stringify(ui);
    if (text === lastUi) return;
    lastUi = text;
    try {
      await api.saveUi(ui, root);
    } catch (error) {
      console.error('Saving what the window shows failed:', error);
    }
  };

  // Pages whose save failed or was refused as stale: their edits are still only here.
  const unsent = new Set<string>();

  async function send(batch: FlushBatch) {
    let failed: string[] = [];
    try {
      const result = await api.flush({ ...batch, root, seenSeq });
      useSaveStatus.setState({ error: result.ok ? null : (result.error ?? 'Saving failed') });
      for (const id of Object.keys(result.paths)) unsent.delete(id);
      if (!result.ok) failed = batch.saves.filter((s) => !(s.id in result.paths)).map((s) => s.id);
      // Saves of pages that changed on disk meanwhile are planned again, from the page as it is now.
      for (const id of result.stale ?? []) {
        baseline.delete(id);
        dirty.add(id);
        unsent.add(id);
        if (batch.repairs?.includes(id)) repairs.add(id);
      }
      if (result.stale?.length) schedule();
    } catch (error) {
      useSaveStatus.setState({ error: message(error) });
      failed = batch.saves.map((s) => s.id);
    }
    // Pages that didn't reach the disk are tried again.
    if (failed.length) {
      for (const id of failed) {
        baseline.delete(id);
        dirty.add(id);
        unsent.add(id);
        // Still only a repair when it's tried again, unless it's edited meanwhile.
        if (batch.repairs?.includes(id)) repairs.add(id);
      }
      schedule(RETRY_DELAY);
    }
  }

  async function flushPages(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    while (inFlight) await inFlight;
    if (stopped) return;
    const next = slice(store.getState());
    const planned = planFlush(prev, next, baseline, dirty);
    const batch = planned.batch && withRepairs(planned.batch, prev, next, repairs);
    prev = next;
    baseline = planned.baseline;
    dirty = new Set();
    repairs = new Set();
    if (!batch) return;
    inFlight = send(batch);
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }

  const unsubscribe = store.subscribe((s, old) => {
    if (fromDisk) return;
    if (s.notebooks !== old.notebooks || s.spaces !== old.spaces || s.journalSpaceId !== old.journalSpaceId) schedule();
    if (s.activeId !== old.activeId || s.expanded !== old.expanded || s.panelCollapsed !== old.panelCollapsed) {
      if (uiTimer) clearTimeout(uiTimer);
      uiTimer = setTimeout(() => void saveUi(), UI_DELAY);
    }
  });

  // Pages that loaded with fields missing are written back whole, without waiting for an edit.
  if (dirty.size) schedule();

  return {
    async flush() {
      await flushPages();
      await saveUi();
    },

    applyFromDisk(update, seq) {
      if (seq !== undefined && seq > seenSeq) seenSeq = seq;
      const before = store.getState();
      fromDisk = true;
      try {
        update();
      } finally {
        fromDisk = false;
      }
      const after = store.getState();
      const was = new Map(before.notebooks.map((n) => [n.id, n]));
      const sent = new Map(prev.notebooks.map((n) => [n.id, n]));
      const write = linkWriter(after.notebooks, after.spaces);
      const renamed = new Set<string>();
      // What came from disk is what's on disk: it joins the last sent state, so it isn't sent back.
      for (const nb of after.notebooks) {
        if (was.get(nb.id) === nb) continue;
        const old = was.get(nb.id);
        if (old && old.title !== nb.title) renamed.add(nb.id);
        sent.set(nb.id, nb);
        if (nb.loadError) baseline.delete(nb.id);
        else baseline.set(nb.id, { json: serialize(nb, write), spaceId: nb.spaceId, parentId: nb.parentId, drawings: drawingsOf(nb) });
      }
      const present = new Set(after.notebooks.map((n) => n.id));
      for (const id of was.keys()) {
        if (present.has(id)) continue;
        sent.delete(id);
        baseline.delete(id);
      }
      prev = { notebooks: [...sent.values()], spaces: after.spaces, journalSpaceId: after.journalSpaceId };
      // Links to a page renamed outside are written with its new title.
      if (renamed.size) {
        for (const nb of after.notebooks) if ([...linksTo(nb)].some((id) => renamed.has(id))) dirty.add(nb.id);
        schedule();
      }
    },

    markDirty(ids) {
      // Forgetting the page file that was sent makes it differ, so it's written whatever it holds. Its
      // drawings are on disk as they are, and aren't written for this.
      for (const id of ids) {
        dirty.add(id);
        repairs.add(id);
        const sent = baseline.get(id);
        if (sent) baseline.set(id, { ...sent, json: '' });
      }
      if (dirty.size) schedule();
    },

    adoptDrawings(pageId, drawings) {
      const onDisk = baseline.get(pageId)?.drawings;
      const page = store.getState().notebooks.find((n) => n.id === pageId);
      if (!onDisk || !page) return;
      const fresh = drawings.filter((d) => page.items[d.id] !== undefined && page.items[d.id] === onDisk.get(d.id));
      if (!fresh.length) return;
      // The drawings weren't touched here, so the disk's version is the drawing: it's shown, and not sent back.
      for (const d of fresh) onDisk.set(d.id, d);
      const items = { ...page.items, ...Object.fromEntries(fresh.map((d) => [d.id, d])) };
      store.setState((s) => ({ notebooks: s.notebooks.map((n) => (n.id === pageId ? { ...n, items } : n)) }) as Partial<S>);
    },

    writeDrawings(pageId, drawingIds) {
      const onDisk = baseline.get(pageId)?.drawings;
      for (const id of drawingIds) onDisk?.delete(id);
      dirty.add(pageId);
      repairs.add(pageId);
      schedule();
    },

    pendingIds() {
      // Pages waiting only to have fields written back aren't edits: an outside change still reaches them.
      const pending = new Set<string>(unsent);
      const sent = new Map(prev.notebooks.map((n) => [n.id, n]));
      for (const nb of store.getState().notebooks) if (sent.get(nb.id) !== nb) pending.add(nb.id);
      return pending;
    },

    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (uiTimer) clearTimeout(uiTimer);
      unsubscribe();
    },
  };
}
