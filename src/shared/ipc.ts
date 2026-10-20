/*
  What the main process and the app's window say to each other. Main owns the workspace folder; the window
  owns the pages. Pages travel as their parsed file contents one way and as finished JSON text the other.
*/

/** A space: a top-level folder of the workspace. Its name is the folder's name. */
export interface SpaceRecord {
  id: string;
  name: string;
}

/** A page file as main found it. */
export interface PageRecord {
  id: string;
  spaceId: string;
  /** The page whose folder holds this one, or null at the top of its space. */
  parentId: string | null;
  /** Relative to the workspace folder, with '/' between parts. */
  path: string;
  mtimeMs: number;
  /** The parsed file, when it could be read. */
  file?: unknown;
  /** Why the file couldn't be read. */
  error?: string;
  /** Set when the file was renamed outside the app: its new name, which becomes its title. */
  titleFromPath?: string;
}

/** What the window was showing, kept in .quest/state.json. */
export interface UiState {
  openPageId: string | null;
  expanded: string[];
  collapsedPanels: string[];
}

export interface WorkspaceSnapshot {
  root: string;
  name: string;
  spaces: SpaceRecord[];
  journalSpaceId: string | null;
  pages: PageRecord[];
  ui: UiState;
  /** True when the folder only just became a workspace. */
  isNew: boolean;
}

/** .quest/workspace.json */
export interface WorkspaceConfig {
  format: 1;
  name: string;
  /** Space folder names, in sidebar order. */
  spaces: string[];
  /** The folder "Today's journal" adds pages to. */
  journalSpace: string | null;
}

export const EMPTY_UI: UiState = { openPageId: null, expanded: [], collapsedPanels: [] };

/** A page the window wants on disk: where it belongs, and its finished file text. */
export interface PageSave {
  id: string;
  spaceId: string;
  parentId: string | null;
  title: string;
  json: string;
}

/** Everything that changed since the last flush. `spaces` is always the whole list, in order. */
export interface FlushBatch {
  spaces: SpaceRecord[];
  journalSpaceId: string | null;
  saves: PageSave[];
  deletes: string[];
}

export interface FlushResult {
  ok: boolean;
  /** The first thing that went wrong. Everything else in the batch was still applied. */
  error?: string;
  /** Where each saved page now is. */
  paths: Record<string, string>;
}
