import { create } from 'zustand';
import type { DiskDelta, OpenResult, WorkspaceSnapshot } from '@shared/ipc';
import { useStore } from '../store';
import { seedFor } from '../lib/seed';
import { childrenOf } from '../page/tree';
import { unsavedEditors } from '../editor/pending';
import { deltaToNotebooks, snapshotToState } from './load';
import { startSync, useSaveStatus, type SyncHandle } from './sync';

let sync: SyncHandle | null = null;

/** Which screen shows, and why a workspace couldn't be opened, if it couldn't. 'loading' is the moment before main answers. */
export const useWorkspaceUi = create<{ error: string | null; screen: 'loading' | 'app' | 'welcome' | 'create' }>(() => ({ error: null, screen: 'loading' }));

/** Shows a workspace read from disk, and from then on keeps the disk in step with it. */
export function startWorkspace(snapshot: WorkspaceSnapshot): void {
  sync?.stop();
  useSaveStatus.setState({ error: null });
  const loaded = snapshotToState(snapshot);
  useStore.getState().loadWorkspace(snapshot.root, snapshot.name, loaded);
  sync = startSync(window.quest.workspace, useStore, loaded.repaired);
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

/** Sends everything not yet sent. Main asks for this before the window closes. */
export async function flushWorkspace(): Promise<void> {
  await sync?.flush();
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
  const { repaired } = deltaToNotebooks(filtered, current);
  sync.applyFromDisk(() => useStore.getState().applyDiskDelta(filtered), delta.seq);
  // Pages renamed through their file name, or missing fields, are written back whole.
  if (repaired.size) sync.markDirty(repaired);
}

/**
 * Shows an open result: the workspace, or the welcome screen with what went wrong. A brand-new, empty
 * workspace gets the sample pages when asked, opened on the lesson with its sub-page showing.
 */
export function openResult(result: OpenResult | null, opts: { samples?: boolean } = {}): void {
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
