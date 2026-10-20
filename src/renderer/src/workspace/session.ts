import { create } from 'zustand';
import type { DiskDelta, OpenResult, WorkspaceSnapshot } from '@shared/ipc';
import { useStore } from '../store';
import { unsavedEditors } from '../editor/pending';
import { deltaToNotebooks, snapshotToState } from './load';
import { startSync, useSaveStatus, type SyncHandle } from './sync';

let sync: SyncHandle | null = null;

/** Which screen shows, and why a workspace couldn't be opened, if it couldn't. */
export const useWorkspaceUi = create<{ error: string | null; screen: 'app' | 'welcome' | 'create' }>(() => ({ error: null, screen: 'app' }));

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
  sync.applyFromDisk(() => useStore.getState().applyDiskDelta(filtered));
  // Pages renamed through their file name, or missing fields, are written back whole.
  if (repaired.size) sync.markDirty(repaired);
}

/** Shows an open result: the workspace, or the welcome screen with what went wrong. */
export function openResult(result: OpenResult | null): void {
  if (result?.ok) {
    startWorkspace(result.snapshot);
    useWorkspaceUi.setState({ error: null, screen: 'app' });
  } else {
    useWorkspaceUi.setState({ error: result ? result.error : null, screen: 'welcome' });
  }
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
  openResult(await window.quest.workspaces.current());
}
