import { create } from 'zustand';
import type { DiskDelta, OpenResult, WorkspaceSnapshot } from '@shared/ipc';
import { useStore } from '../store';
import { seedFor } from '../lib/seed';
import { childrenOf, displayTitle, positionBetween } from '../page/tree';
import { unsavedEditors } from '../editor/pending';
import { markdownSaves } from '../markdown/saving';
import { deltaToNotebooks, drawingsIn, snapshotToState } from './load';
import { startSync, useSaveStatus, type SyncHandle } from './sync';
import type { Notebook } from '../types';

let sync: SyncHandle | null = null;

/** Which screen shows, and why a workspace couldn't be opened, if it couldn't. 'loading' is the moment before main answers. */
export const useWorkspaceUi = create<{ error: string | null; screen: 'loading' | 'app' | 'welcome' | 'create' }>(() => ({ error: null, screen: 'loading' }));

/** What to tell the owner about a change from disk the app didn't simply take in, until they dismiss it. */
export const useDiskNotice = create<{ text: string | null }>(() => ({ text: null }));

/** The notice for pages deleted outside the app that were kept, because they were being edited. */
export function keptNotice(titles: string[]): string {
  const names = titles.map((t) => `“${displayTitle(t)}”`);
  if (names.length === 1) return `${names[0]} was deleted outside the app while you were editing it, so it was saved again.`;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)} were deleted outside the app while you were editing them, so they were saved again.`;
}

/**
 * Pages kept after their files were deleted outside, whose parent or space went too: each moves to the top of its
 * space, or of the first space left, so it shows and can be saved. One under a page that stayed goes with it.
 */
function rehome(ids: string[]): void {
  useStore.setState((s) => {
    const pages = new Map(s.notebooks.map((n) => [n.id, n]));
    const spaces = new Set(s.spaces.map((sp) => sp.id));
    const depth = (id: string) => {
      let d = 0;
      for (let p = pages.get(id)?.parentId; p && d < pages.size; p = pages.get(p)?.parentId) d++;
      return d;
    };
    const moved = new Map<string, Notebook>();
    // Parents first, so a page under one that moved goes where its parent went.
    for (const id of [...ids].sort((a, b) => depth(a) - depth(b))) {
      const nb = pages.get(id);
      if (!nb) continue;
      const parent = nb.parentId === null ? undefined : pages.get(nb.parentId);
      let next: Notebook | null = null;
      if (parent) {
        if (parent.spaceId !== nb.spaceId) next = { ...nb, spaceId: parent.spaceId };
      } else if (nb.parentId !== null || !spaces.has(nb.spaceId)) {
        const spaceId = spaces.has(nb.spaceId) ? nb.spaceId : s.spaces[0]?.id;
        if (spaceId === undefined) continue;
        const top = childrenOf([...pages.values()], spaceId, null).filter((n) => n.id !== id);
        next = { ...nb, spaceId, parentId: null, position: positionBetween(top.at(-1)?.position, undefined) };
      }
      if (next) {
        pages.set(id, next);
        moved.set(id, next);
      }
    }
    return moved.size ? { notebooks: s.notebooks.map((n) => moved.get(n.id) ?? n) } : {};
  });
}

/** Shows a workspace read from disk, and from then on keeps the disk in step with it. */
export function startWorkspace(snapshot: WorkspaceSnapshot): void {
  sync?.stop();
  useSaveStatus.setState({ error: null });
  useDiskNotice.setState({ text: null });
  const loaded = snapshotToState(snapshot);
  useStore.getState().loadWorkspace(snapshot.root, snapshot.name, loaded);
  sync = startSync(window.quest.workspace, useStore, loaded.repaired, loaded.drawingsToWrite);
}

/** Stops keeping a workspace in step, after sending what it hasn't yet. */
export async function stopWorkspace(): Promise<void> {
  await sync?.flush();
  sync?.stop();
  sync = null;
}

/** Pages to write back on the next save. */
export function markDirty(ids: Iterable<string>): void {
  sync?.markDirty(ids);
}

/** Sends everything not yet sent, including words still waiting in an editor or a Markdown file. Main asks for this before the window closes. */
export async function flushWorkspace(): Promise<void> {
  unsavedEditors.flushAll();
  await Promise.all([sync?.flush(), markdownSaves.flushAll()]);
}

/**
 * Takes in a change made on disk outside the app. A page with edits not yet saved keeps them: they're saved
 * over the outside change a moment later.
 */
export function applyDisk(delta: DiskDelta): void {
  if (!sync) return;
  const pending = sync.pendingIds();
  for (const id of unsavedEditors.ids()) pending.add(id);
  const current = useStore.getState().notebooks;
  const filtered: DiskDelta = {
    ...delta,
    pages: delta.pages.filter((p) => !pending.has(p.id)),
    removed: delta.removed.filter((id) => !pending.has(id)),
  };
  const { repaired, drawingsToWrite } = deltaToNotebooks(filtered, current);
  sync.applyFromDisk(() => useStore.getState().applyDiskDelta(filtered), delta.seq);
  // Pages renamed through their file name, or missing fields, are written back whole.
  if (repaired.size) sync.markDirty(repaired);
  // Drawing files written by hand, or missing, are written in the app's form.
  for (const [pageId, ids] of drawingsToWrite) sync.writeDrawings(pageId, ids);

  // A page being edited that was deleted outside stays, and is written again whole, drawings and all. The owner
  // is told, since the delete didn't happen.
  const kept = delta.removed.filter((id) => pending.has(id) && current.some((n) => n.id === id));
  if (kept.length) {
    rehome(kept);
    sync.rewritePages(kept);
    const pages = new Map(useStore.getState().notebooks.map((n) => [n.id, n]));
    useDiskNotice.setState({ text: keptNotice(kept.map((id) => pages.get(id)?.title ?? '')) });
  }

  // A page being edited keeps its edits, but takes the outside version of each drawing it didn't touch.
  for (const record of delta.pages) if (pending.has(record.id)) sync.adoptDrawings(record.id, drawingsIn(record));

  // A page being edited keeps its edit, but goes where its file went, so the edit is saved there.
  const moved = new Map(delta.pages.filter((p) => pending.has(p.id) && p.error === undefined).map((p) => [p.id, p]));
  if (moved.size) {
    useStore.setState((s) => ({
      notebooks: s.notebooks.map((nb) => {
        const to = moved.get(nb.id);
        return to && (nb.spaceId !== to.spaceId || nb.parentId !== to.parentId) ? { ...nb, spaceId: to.spaceId, parentId: to.parentId, path: to.path } : nb;
      }),
    }));
  }
}

/**
 * Shows an open result: the workspace, or the welcome screen with what went wrong. A brand-new, empty
 * workspace gets the sample pages when asked, opened on the lesson with its sub-page showing.
 */
export function openResult(result: OpenResult | null, opts: { samples?: boolean } = {}): void {
  if (result && !result.ok && result.cancelled) return;
  if (!result?.ok) {
    useWorkspaceUi.setState({ error: result ? result.error : null, screen: 'welcome' });
    return;
  }
  const { snapshot } = result;
  startWorkspace(snapshot);
  useWorkspaceUi.setState({ error: null, screen: 'app' });
  if (opts.samples && snapshot.isNew && snapshot.pages.length === 0) {
    const samples = seedFor(useStore.getState().spaces);
    const lesson = samples.find((p) => p.parentId === null && childrenOf(samples, p.spaceId, p.id).length > 0);
    useStore.setState((s) => ({
      notebooks: [...s.notebooks, ...samples],
      activeId: lesson?.id ?? samples[0]?.id ?? s.activeId,
      expanded: lesson ? { ...s.expanded, [lesson.id]: true } : s.expanded,
    }));
  }
}

/** Opens a folder as the workspace, after saving the one open now. */
export async function openFolder(path: string): Promise<void> {
  await flushWorkspace();
  openResult(await window.quest.workspaces.open(path));
}

/** Asks for a folder and opens it. */
export async function pickAndOpen(): Promise<void> {
  const path = await window.quest.workspaces.pickFolder('Open a folder as a workspace');
  if (path) await openFolder(path);
}

/** Makes a new workspace in `parentDir` and opens it. */
export async function createAndOpen(parentDir: string, name: string, samples: boolean): Promise<void> {
  await flushWorkspace();
  openResult(await window.quest.workspaces.create(parentDir, name), { samples });
}

/** At start: listens to main, and shows the workspace main reopened, if any. */
export async function bootWorkspace(): Promise<void> {
  const { workspace, app } = window.quest;
  workspace.onDiskChange(applyDisk);
  workspace.onLost((message) => {
    sync?.stop();
    sync = null;
    useStore.getState().closeWorkspace();
    useWorkspaceUi.setState({ error: message, screen: 'welcome' });
  });
  app.onFlushRequest(flushWorkspace);
  app.onMenu((cmd) => {
    if (cmd === 'new-workspace') useWorkspaceUi.setState({ screen: 'create' });
    else if (cmd === 'open-workspace') void pickAndOpen();
    else void window.quest.workspaces.reveal();
  });
  openResult(await window.quest.workspaces.current());
}
