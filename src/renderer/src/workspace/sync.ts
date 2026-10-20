import type { StoreApi, UseBoundStore } from 'zustand';
import { create } from 'zustand';
import { formatJson } from '@shared/formatJson';
import type { FlushBatch, PageSave, QuestApi, UiState } from '@shared/ipc';
import type { Notebook, Space } from '../types';
import { displayTitle } from '../page/tree';
import { pageToFile } from '../files/convert';
import { linkWriter, linksTo } from '../files/links';

/** The part of the store that lives on disk. */
export interface SyncSlice {
  notebooks: Notebook[];
  spaces: Space[];
  journalSpaceId: string | null;
}

/** What was last sent for a page: its file text and where it sits. A page is saved when either differs. */
interface Sent {
  json: string;
  spaceId: string;
  parentId: string | null;
}

export type Baseline = Map<string, Sent>;

/** Whether saving to disk is working, for the banner that says when it isn't. */
export const useSaveStatus = create<{ error: string | null }>(() => ({ error: null }));

const serialize = (nb: Notebook, write: ReturnType<typeof linkWriter>) => formatJson(pageToFile(nb, write));

/** What's on disk for these pages, as far as the window knows. Pages in `unsaved` are left out, so they're saved. */
export function baselineFor(slice: SyncSlice, unsaved: Set<string>): Baseline {
  const write = linkWriter(slice.notebooks, slice.spaces);
  const baseline: Baseline = new Map();
  for (const nb of slice.notebooks) {
    if (nb.loadError || unsaved.has(nb.id)) continue;
    baseline.set(nb.id, { json: serialize(nb, write), spaceId: nb.spaceId, parentId: nb.parentId });
  }
  return baseline;
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
    if (sent && sent.json === json && sent.spaceId === nb.spaceId && sent.parentId === nb.parentId) continue;
    saves.push({ id, spaceId: nb.spaceId, parentId: nb.parentId, title: nb.title, json });
    out.set(id, { json, spaceId: nb.spaceId, parentId: nb.parentId });
  }
  for (const id of deletes) out.delete(id);

  const spacesChanged = prev.spaces !== next.spaces || prev.journalSpaceId !== next.journalSpaceId;
  if (!saves.length && !deletes.length && !spacesChanged) return { batch: null, baseline: out };
  return { batch: { spaces: next.spaces, journalSpaceId: next.journalSpaceId, saves, deletes }, baseline: out };
}

interface SyncedState extends SyncSlice {
  activeId: string | null;
  expanded: Record<string, boolean>;
  panelCollapsed: Record<string, boolean>;
}

export interface SyncHandle {
  /** Sends everything not yet sent, and waits until main has written it. */
  flush(): Promise<void>;
  /** Runs a store update that came from disk: nothing in it is sent back. */
  applyFromDisk(update: () => void): void;
  /** Pages to write back even if nothing in them changes, such as files that were missing fields. */
  markDirty(ids: Iterable<string>): void;
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
export function startSync<S extends SyncedState>(api: QuestApi['workspace'], store: UseBoundStore<StoreApi<S>>, unsaved: Set<string>): SyncHandle {
  let prev = slice(store.getState());
  let baseline = baselineFor(prev, unsaved);
  let dirty = new Set(unsaved);
  let fromDisk = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let uiTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let lastUi = JSON.stringify(uiOf(store.getState()));

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
      await api.saveUi(ui);
    } catch (error) {
      console.error('Saving what the window shows failed:', error);
    }
  };

  async function send(batch: FlushBatch) {
    let failed: string[] = [];
    try {
      const result = await api.flush(batch);
      useSaveStatus.setState({ error: result.ok ? null : (result.error ?? 'Saving failed') });
      if (!result.ok) failed = batch.saves.filter((s) => !(s.id in result.paths)).map((s) => s.id);
    } catch (error) {
      useSaveStatus.setState({ error: message(error) });
      failed = batch.saves.map((s) => s.id);
    }
    // Pages that didn't reach the disk are tried again.
    if (failed.length) {
      for (const id of failed) {
        baseline.delete(id);
        dirty.add(id);
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
    prev = next;
    baseline = planned.baseline;
    dirty = new Set();
    if (!planned.batch) return;
    inFlight = send(planned.batch);
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

    applyFromDisk(update) {
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
        else baseline.set(nb.id, { json: serialize(nb, write), spaceId: nb.spaceId, parentId: nb.parentId });
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
      // Forgetting what was sent makes the page's file differ, so it's written whatever it holds.
      for (const id of ids) {
        dirty.add(id);
        baseline.delete(id);
      }
      if (dirty.size) schedule();
    },

    pendingIds() {
      const pending = new Set(dirty);
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
