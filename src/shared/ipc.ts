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
  /** The page's drawing files (drawing-<id>.svg in its folder), by file name. */
  drawings?: Record<string, string>;
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
  /** The page file's text. Left out when only the page's drawing files need writing. */
  json?: string;
  /** Drawing files to write in the page's folder, by file name (drawing-<id>.svg). Only changed drawings are sent. */
  sidecars: Record<string, string>;
  /** Drawing files the page no longer has: moved to the Trash. Files not named here are never touched. */
  removedSidecars?: string[];
}

/** The names main accepts for a drawing file beside a page. */
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
  /** Pages saved only to fill in or tidy what an outside write left, not edited here. Left out when there are none. */
  repairs?: string[];
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

/** One thing Claude did in a turn. `path` is relative to the workspace, with `/` separators. */
export interface ChatAction {
  /** The tool_use id. */
  id?: string;
  verb: 'read' | 'edited' | 'created' | 'searched' | 'other';
  path?: string;
  detail?: string;
  /** Set later, when the CLI reports the call as refused. */
  refused?: boolean;
}

/** What the setup check found about the claude CLI. */
export interface ClaudeStatus {
  state: 'ready' | 'missing' | 'logged-out' | 'error';
  path?: string;
  version?: string;
  message?: string;
}

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
  /** Claude, run as the claude CLI in the open workspace. One turn at a time. */
  claude: {
    /** Looks for the CLI again, and whether it's logged in. */
    status(): Promise<ClaudeStatus>;
    /** Starts a turn. `messageId` is the id of the reply the events will carry. */
    send(req: SendRequest): Promise<{ chatId: string; messageId: string } | { error: string }>;
    /** Stops the running turn. It still ends with a `done` event. */
    stop(): Promise<void>;
    onEvent(cb: (e: ClaudeEvent) => void): () => void;
    listChats(): Promise<ChatSummary[]>;
    readChat(id: string): Promise<Chat | null>;
    deleteChat(id: string): Promise<void>;
    /** Puts back what a reply changed: the given paths, or all of them for null. `force` overwrites files changed since. */
    undo(chatId: string, messageId: string, paths: string[] | null, force: boolean): Promise<UndoResult>;
    /** An image saved with a chat's message, by its file name. Null when it's gone or the name isn't one of that chat's. */
    image(chatId: string, file: string): Promise<ImageData | null>;
  };
}

/** The image types Claude can see. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
/** At most this many images per message, each at most this many bytes. */
export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** An image's bytes, as base64 without a `data:` prefix. */
export interface ImageData {
  type: ImageType;
  data: string;
}

/** A message for Claude. `chatId` null starts a new chat. `openPageId` is the page open in the window, if any. */
export interface SendRequest {
  chatId: string | null;
  message: string;
  references: ChatReference[];
  openPageId: string | null;
  /** Images pasted or dropped into the message. */
  images?: ImageData[];
}

/**
 * What a running turn reports. An `action` with an id already sent replaces that action (a refusal arrives this way,
 * as the same action with `refused: true`). `done` carries the finished reply.
 */
export type ClaudeEvent = { chatId: string; messageId: string } & (
  | { kind: 'text'; text: string }
  | { kind: 'action'; action: ChatAction }
  | { kind: 'done'; message: ChatMessage }
);

/** A page or drawing file that changed on disk, as Claude's turn left it. `before` is null for a file that is new. */
export interface FileChange {
  /** Relative to the workspace folder, with '/' between parts. */
  path: string;
  /** The page's id, or for a drawing its page's. Left out for a page file that can't be read. */
  pageId?: string;
  kind: 'edited' | 'created';
  drawing: boolean;
  /** The file's top folder (its space) didn't exist before the turn. Set by the turn's service, not by the scanner. */
  newSpace?: boolean;
  before: string | null;
  after: string | null;
}

/** What undoing a turn did: the files put back, and the files left alone because they changed since. */
export interface UndoResult {
  undone: string[];
  conflicts: string[];
}

/**
 * What a chat message pointed Claude at: a whole page, a passage of it, or blocks of it. A block reference's `text` is
 * the blocks as they're written in the page file (JSON), and `where` says where they sit on the page, in words.
 */
export type ChatReference =
  | { kind: 'page'; pageId: string; title: string }
  | { kind: 'selection'; pageId: string; title: string; text: string }
  | { kind: 'block'; pageId: string; title: string; text: string; where: string };

/** An image saved with a message, in .quest/chats/images/. `file` is its name there: `<chat id>-<8 letters or digits>.<ext>`. */
export interface ChatImage {
  file: string;
  type: ImageType;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  created: string;
  references?: ChatReference[];
  images?: ChatImage[];
  actions?: ChatAction[];
  changes?: FileChange[];
  /** Paths of the changes that were undone. */
  undone?: string[];
  error?: string;
}

/** A saved conversation, kept in .quest/chats/<id>.json. `sessionId` is the CLI session to resume. */
export interface Chat {
  id: string;
  title: string;
  sessionId: string | null;
  created: string;
  updated: string;
  messages: ChatMessage[];
}

export interface ChatSummary {
  id: string;
  title: string;
  updated: string;
}
