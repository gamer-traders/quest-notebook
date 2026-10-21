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
  /** The page file's text. Left out when only the page's pictures need writing, as after a change from disk. */
  json?: string;
  /**
   * Every picture copy the page has, by file name (drawing-<id>.svg), written in the page's folder. Copies in
   * that folder no longer listed are removed.
   */
  sidecars: Record<string, string>;
}

/** The names main accepts for a picture copy beside a page. */
export const SIDECAR_NAME = /^drawing-[A-Za-z0-9_-]{1,64}\.svg$/;

/**
 * Everything that changed since the last flush. `spaces` is the window's whole list, in order, for names and
 * order. Spaces are only ever made or trashed when named in `createdSpaces` or `deletedSpaces`: a batch
 * planned just before a folder changed on disk mustn't undo that change.
 */
export interface FlushBatch {
  /** The workspace the batch was made for. Main refuses it if another workspace is open by now. */
  root?: string;
  spaces: SpaceRecord[];
  createdSpaces: string[];
  deletedSpaces: string[];
  /** The last disk change the window had taken in when it planned this. */
  seenSeq?: number;
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
  /** Pages left alone because they changed on disk after the batch was planned: the window plans them again. */
  stale?: string[];
}

/** What changed on disk, outside the app. `spaces` is always the whole list, in order. */
export interface DiskDelta {
  /** Counts up with each change main reports, so a batch can say which ones it was planned after. */
  seq: number;
  spaces: SpaceRecord[];
  journalSpaceId: string | null;
  /** Pages added or changed, with where they are now. */
  pages: PageRecord[];
  /** Ids of pages whose files are gone. */
  removed: string[];
}

export interface RecentWorkspace {
  path: string;
  name: string;
  /** ISO time. */
  lastOpened: string;
}

/** `cancelled`: the person chose not to open it, so there's nothing to show. */
export type OpenResult = { ok: true; snapshot: WorkspaceSnapshot } | { ok: false; error: string; path?: string; cancelled?: boolean };

export type MenuCommand = 'new-workspace' | 'open-workspace' | 'reveal-workspace';

/** `window.quest`: everything the window can ask of the main process. */
export interface QuestApi {
  workspaces: {
    /** The workspace open now (main reopens the last one at launch), or why it couldn't be opened, or null for none. */
    current(): Promise<OpenResult | null>;
    recent(): Promise<RecentWorkspace[]>;
    /** Asks for a folder. Null when the person cancels. */
    pickFolder(title: string): Promise<string | null>;
    create(parentDir: string, name: string): Promise<OpenResult>;
    open(path: string): Promise<OpenResult>;
    forget(path: string): Promise<void>;
    reveal(): Promise<void>;
  };
  workspace: {
    flush(batch: FlushBatch): Promise<FlushResult>;
    /** `root` is the workspace the state belongs to: it's dropped if another one is open by now. */
    saveUi(ui: UiState, root?: string): Promise<void>;
    onDiskChange(cb: (delta: DiskDelta) => void): () => void;
    /** The open workspace's folder went away. */
    onLost(cb: (message: string) => void): () => void;
  };
  app: {
    /** Main asks for pending saves before the window closes or the workspace switches. */
    onFlushRequest(cb: () => Promise<void>): () => void;
    onMenu(cb: (cmd: MenuCommand) => void): () => void;
    openExternal(url: string): Promise<void>;
  };
}
