import type { ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { delimiter, dirname } from 'node:path';
import {
  SIDECAR_NAME,
  type Chat,
  type ChatAction,
  type ChatMessage,
  type ChatReference,
  type ChatSummary,
  type ClaudeEvent,
  type ClaudeStatus,
  type FileChange,
  type SendRequest,
  type UndoResult,
} from '@shared/ipc';
import type { RepairedFile, WorkspaceSession } from '../workspace/session';
import { chatTitle, deleteChat, listChats, newChatId, parseReference, readChat, writeChat } from './chats';
import { buildPrompt, claudeArgs, claudeEnv, isSessionId } from './command';
import { LineSplitter, parseStreamLine, type StreamItem } from './events';
import { WORKSPACE_GUIDE } from './guide';
import { TurnChanges, repairChanges } from './turns';
import { undoChanges } from './undo';

export interface ClaudeDeps {
  /** Where the claude CLI is, or null when it can't be found. */
  locate(): Promise<string | null>;
  spawn: typeof spawn;
  trash(abs: string): Promise<void>;
  /** Reports a running turn to the window. */
  send(e: ClaudeEvent): void;
  /** How long a stopped turn gets after SIGINT before SIGTERM, and again before SIGKILL. */
  stopGraceMs?: number;
  /** How long the child's output may stay open after it exits (held by something it started) before the turn ends anyway. */
  exitGraceMs?: number;
}

/** What the service uses of the open workspace. */
export type ClaudeSession = Pick<WorkspaceSession, 'settle' | 'exclusive' | 'pageIdForPath' | 'pageInfo' | 'snapshot'>;

const BUSY = 'Claude is still answering';
const CLOSED = 'This workspace is closed';
const CLOSED_MID_TURN = 'Stopped: the workspace was closed';
const NOT_FOUND = "Couldn't find Claude Code";
const TOO_LONG = 'That message is too long';
/** The CLI no longer has the session a chat would resume. */
const LOST_SESSION = /no conversation found|session.*not found/i;
const MAX_MESSAGE = 100_000;
const STDERR_KEEP = 4096;
const STATUS_TIMEOUT_MS = 10_000;
const STATUS_OUTPUT_KEEP = 65_536;
/** How many finished replies a tidy-up by the app can still reach. */
const KEEP_FINISHED = 10;

type Done = Extract<StreamItem, { kind: 'done' }>;
type TurnEvent = { kind: 'text'; text: string } | { kind: 'action'; action: ChatAction } | { kind: 'done'; message: ChatMessage };
/** A finished reply that recorded changes, and the paths it recorded them at. */
interface FinishedReply {
  chatId: string;
  messageId: string;
  paths: Set<string>;
}

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

/** One running turn: the child, what it has said, and what it has changed. */
interface Turn {
  chat: Chat;
  messageId: string;
  created: string;
  /** The turn passed --resume. */
  resumed: boolean;
  /** The workspace folder as the CLI sees it: it reports absolute paths in this form. */
  realRoot: string;
  /** Space folder names when the turn started. */
  spaces: Set<string>;
  changes: TurnChanges;
  /** Drawing files the app made while tidying a page this turn changed, and that page's path: they go where the page goes. */
  repairDrawings: Map<string, string>;
  /** File changes count until the reply's list of them is made. */
  recording: boolean;
  child: ChildProcess | null;
  splitter: LineSplitter;
  text: string[];
  /** Some text has come, so a new text block starts after a break. */
  hasText: boolean;
  breakPending: boolean;
  actions: ChatAction[];
  sessionId: string | null;
  done: Done | null;
  stopped: boolean;
  stderr: string;
  exiting: boolean;
  /** The reply is being written to the chat: by the end of the turn, or by close. */
  saving: boolean;
  /** That write, settled either way: what close waits for. */
  record: Promise<void> | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  exitTimer: ReturnType<typeof setTimeout> | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const firstLine = (text: string) => text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
const isRunning = (child: ChildProcess) => child.pid !== undefined && child.exitCode === null && child.signalCode === null;

/** Whether a reply that recorded these paths may have left this file: one of them, or a file in one of its pages' folders. */
const mayHaveLeft = (paths: Set<string>, path: string) =>
  paths.has(path) || [...paths].some((p) => /\.json$/i.test(p) && path.startsWith(`${p.slice(0, -'.json'.length)}/`));

/**
 * Whether undo may write a recorded change: a page file or a drawing file inside a space folder, never the top of
 * the workspace or a hidden folder such as .quest. The chat file can be edited by hand, so this is checked again here.
 */
function isUndoable(change: unknown): change is FileChange {
  if (!isObject(change)) return false;
  const { path, before, after } = change;
  if (!isString(path) || !(before === null || isString(before)) || !(after === null || isString(after))) return false;
  const parts = path.split('/');
  if (parts.length < 2 || parts.some((part) => part === '' || part.startsWith('.'))) return false;
  const name = parts[parts.length - 1];
  return /\.json$/i.test(name) || SIDECAR_NAME.test(name);
}

/**
 * A send request from the window, checked field by field and rebuilt with only the known fields; null when anything is
 * off. A message too long is the service's to refuse, so the window can say why.
 */
export function parseSendRequest(v: unknown): SendRequest | null {
  if (!isObject(v)) return null;
  const { chatId, message, references, openPageId } = v;
  if (chatId !== null && !isString(chatId)) return null;
  if (openPageId !== null && !isString(openPageId)) return null;
  if (!isString(message) || message.trim() === '') return null;
  if (!Array.isArray(references)) return null;
  const refs: ChatReference[] = [];
  for (const ref of references) {
    const parsed = parseReference(ref);
    if (!parsed) return null;
    refs.push(parsed);
  }
  return { chatId, message, references: refs, openPageId };
}

/** Undo's arguments from the window, or null when any has the wrong type. */
export function parseUndoArgs(args: unknown[]): { chatId: string; messageId: string; paths: string[] | null; force: boolean } | null {
  const [chatId, messageId, paths, force] = args;
  if (!isString(chatId) || !isString(messageId) || typeof force !== 'boolean') return null;
  if (paths !== null && !(Array.isArray(paths) && paths.every(isString))) return null;
  return { chatId, messageId, paths, force };
}

/**
 * Claude in one open workspace: runs the claude CLI one turn at a time, reports what it says and does, keeps the
 * chats, and undoes what a reply changed. Once closed it reports nothing more, and writes nothing but the record of
 * a turn the close cut short, in its own workspace.
 */
export class ClaudeService {
  private closed = false;
  /** What close is waiting for: set by the first close, and given to every later one. */
  private closing: Promise<void> | null = null;
  /** From the start of a send until its turn has ended. */
  private busy = false;
  /** Stop was asked for while a send was still starting its turn. */
  private stopRequested = false;
  private turn: Turn | null = null;
  /** The chat a send or turn is working in. */
  private activeChatId: string | null = null;
  private claudePath: string | null = null;
  /** The last turn failed because the CLI wasn't logged in. */
  private loggedOut = false;
  /** Undos run one after another, and a turn starts only after them. Updates of finished replies and deletes of chats take turns with them. */
  private undoQueue: Promise<unknown> = Promise.resolve();
  /** The last few replies that recorded changes, oldest first. */
  private finished: FinishedReply[] = [];
  /** Tidy-ups that came while a send or turn was writing its chat, for the finished replies once it's over. */
  private deferredRepairs: RepairedFile[][] = [];

  constructor(
    private readonly root: string,
    private readonly session: ClaudeSession,
    private readonly deps: ClaudeDeps,
  ) {}

  /** A send or its turn is under way. */
  get running(): boolean {
    return this.busy;
  }

  private get graceMs(): number {
    return this.deps.stopGraceMs ?? 3000;
  }

  /** The child's environment: no API keys or host variables, and claude's own folder first on the PATH. */
  private env(claudePath: string): NodeJS.ProcessEnv {
    const env = claudeEnv(process.env);
    // An npm-installed claude is a node script, and an app opened from Finder has a bare PATH. With nvm, node sits next to claude.
    env.PATH = env.PATH ? `${dirname(claudePath)}${delimiter}${env.PATH}` : dirname(claudePath);
    return env;
  }

  /** A claude that couldn't be started is looked for again next time. */
  private forget(claudePath: string): void {
    if (this.claudePath === claudePath) this.claudePath = null;
  }

  async send(req: SendRequest): Promise<{ chatId: string; messageId: string } | { error: string }> {
    if (this.closed) return { error: CLOSED };
    if (this.busy) return { error: BUSY };
    if (req.message.length > MAX_MESSAGE) return { error: TOO_LONG };
    this.busy = true;
    this.stopRequested = false;
    let started = false;
    try {
      await this.undoQueue;
      const claudePath = this.claudePath ?? (await this.deps.locate());
      if (this.closed) return { error: CLOSED };
      if (!claudePath) return { error: NOT_FOUND };
      this.claudePath = claudePath;

      const now = new Date().toISOString();
      const chat: Chat | null =
        req.chatId === null
          ? { id: newChatId(), title: chatTitle(req.message), sessionId: null, created: now, updated: now, messages: [] }
          : await readChat(this.root, req.chatId);
      if (!chat) return { error: 'That chat is gone' };
      this.activeChatId = chat.id;
      // The window saves before it sends: a page that save made or renamed is in the prompt at its path and title now.
      await this.session.settle();
      if (this.closed) return { error: CLOSED };
      const { references, prompt } = this.prompt(req);
      const realRoot = await realpath(this.root);
      if (this.closed) return { error: CLOSED };

      chat.messages.push({ id: randomUUID(), role: 'user', text: req.message, created: now, references });
      chat.updated = now;
      await writeChat(this.root, chat);
      // Whatever changed on disk before the turn (an undo, an edit in another app) isn't Claude's.
      await this.session.settle();
      if (this.closed) return { error: CLOSED };

      const turn: Turn = {
        chat,
        messageId: randomUUID(),
        created: new Date().toISOString(),
        resumed: chat.sessionId !== null,
        realRoot,
        spaces: new Set(this.session.snapshot.spaces.map((s) => s.name)),
        changes: new TurnChanges(),
        repairDrawings: new Map(),
        recording: true,
        child: null,
        splitter: new LineSplitter(),
        text: [],
        hasText: false,
        breakPending: false,
        actions: [],
        sessionId: null,
        done: null,
        stopped: false,
        stderr: '',
        exiting: false,
        saving: false,
        record: null,
        stopTimer: null,
        exitTimer: null,
      };
      this.turn = turn;
      started = true;
      this.start(turn, claudePath, prompt);
      if (this.stopRequested) this.stopTurn(turn);
      return { chatId: chat.id, messageId: turn.messageId };
    } catch (error) {
      return { error: errorText(error) };
    } finally {
      if (!started) {
        this.busy = false;
        this.activeChatId = null;
        this.stopRequested = false;
        this.repairDeferred();
      }
    }
  }

  /** The references the message keeps (the open page first; unknown pages dropped), and the prompt for the CLI. */
  private prompt(req: SendRequest): { references: ChatReference[]; prompt: string } {
    const references: ChatReference[] = [];
    const pages: { title: string; path: string }[] = [];
    const listed = new Set<string>();
    const selections: { title: string; text: string }[] = [];
    const open = req.openPageId === null ? undefined : this.session.pageInfo(req.openPageId);
    if (open && req.openPageId !== null) {
      references.push({ kind: 'page', pageId: req.openPageId, title: open.title });
      listed.add(req.openPageId);
    }
    for (const ref of req.references) {
      const info = this.session.pageInfo(ref.pageId);
      if (!info) continue;
      if (ref.kind === 'page') {
        if (listed.has(ref.pageId)) continue;
        listed.add(ref.pageId);
        pages.push(info);
      } else {
        selections.push({ title: info.title, text: ref.text });
      }
      references.push(ref);
    }
    return { references, prompt: buildPrompt({ message: req.message, openPage: open ?? null, references: pages, selections }) };
  }

  private start(turn: Turn, claudePath: string, prompt: string): void {
    let child: ChildProcess;
    try {
      child = this.deps.spawn(claudePath, claudeArgs({ prompt, sessionId: turn.chat.sessionId, guide: WORKSPACE_GUIDE }), {
        cwd: this.root,
        env: this.env(claudePath),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.forget(claudePath);
      void this.end(turn, { code: null, signal: null, error: error instanceof Error ? error : new Error(String(error)) });
      return;
    }
    turn.child = child;
    // As text, so a chunk never ends half way through a character.
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (this.closed) return;
      for (const line of turn.splitter.push(chunk)) this.line(turn, line);
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      turn.stderr = (turn.stderr + chunk).slice(-STDERR_KEEP);
    });
    // A broken pipe mustn't take the app down: the child's close still ends the turn.
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});
    child.on('error', (error) => {
      // After a spawn that worked, an error (a failed kill) leaves the child running, and its close ends the turn.
      if (child.pid !== undefined) return;
      this.forget(claudePath);
      void this.end(turn, { code: null, signal: null, error });
    });
    // Close waits for the output to close too. Something the CLI started may hold it open after the CLI is gone:
    // after a while the output is let go, so the turn still ends.
    child.on('exit', () => {
      turn.exitTimer = setTimeout(() => {
        turn.exitTimer = null;
        child.stdout?.destroy();
        child.stderr?.destroy();
      }, this.deps.exitGraceMs ?? 2000);
    });
    child.on('close', (code, signal) => void this.end(turn, { code, signal }));
  }

  private line(turn: Turn, line: string): void {
    for (const item of parseStreamLine(line, turn.realRoot)) this.item(turn, item);
  }

  private item(turn: Turn, item: StreamItem): void {
    switch (item.kind) {
      case 'session':
        // It goes on the command line of the next turn: anything but a UUID is ignored.
        if (isSessionId(item.sessionId)) turn.sessionId = item.sessionId;
        return;
      case 'text-start':
        if (turn.hasText) turn.breakPending = true;
        return;
      case 'text':
        if (item.text === '') return;
        // Text from a new block (after a tool call, say) mustn't run on from the last.
        if (turn.breakPending) {
          turn.breakPending = false;
          turn.text.push('\n\n');
          this.emit(turn, { kind: 'text', text: '\n\n' });
        }
        turn.hasText = true;
        turn.text.push(item.text);
        this.emit(turn, { kind: 'text', text: item.text });
        return;
      case 'action': {
        const action = { ...item.action };
        // Write on a page that's already there is an edit.
        if (action.verb === 'created' && action.path !== undefined && this.session.pageIdForPath(action.path) !== undefined) action.verb = 'edited';
        turn.actions.push(action);
        this.emit(turn, { kind: 'action', action: { ...action } });
        return;
      }
      case 'refused': {
        // A refusal for an action not seen is still marked at the end, from the result's list of denials.
        const action = turn.actions.find((a) => a.id === item.id);
        if (!action || action.refused) return;
        action.refused = true;
        this.emit(turn, { kind: 'action', action: { ...action } });
        return;
      }
      case 'done':
        turn.done = item;
        return;
    }
  }

  private emit(turn: Turn, event: TurnEvent): void {
    if (this.closed) return;
    this.deps.send({ chatId: turn.chat.id, messageId: turn.messageId, ...event });
  }

  /** Called with the page and drawing files that changed on disk outside the app. They count only while a turn runs. */
  fileChanges(changes: FileChange[]): void {
    const turn = this.turn;
    if (this.closed || !turn || !turn.recording) return;
    turn.changes.add(changes.map((change) => (turn.spaces.has(change.path.split('/')[0]) ? change : { ...change, newSpace: true })));
  }

  /**
   * The reply as the turn left it: refusals marked, a Write on a file that was there counted as an edit, and only the
   * changes to files Claude itself wrote. A file another app changed during the turn isn't Claude's, so it's never undone.
   * More are Claude's doing: the page the app made for a new folder Claude put a page in, so undo leaves no empty page,
   * and a drawing file the app made while tidying a page Claude wrote, so undo leaves no drawing behind.
   */
  private reply(turn: Turn, error: string | undefined): ChatMessage {
    const refused = new Set(turn.done?.refused ?? []);
    for (const action of turn.actions) if (action.id !== undefined && refused.has(action.id)) action.refused = true;
    const written = new Set(turn.actions.flatMap((a) => ((a.verb === 'edited' || a.verb === 'created') && !a.refused && a.path !== undefined ? [a.path] : [])));
    const all = turn.changes.list();
    const madeByClaude = all.filter((c) => written.has(c.path) && c.kind === 'created').map((c) => c.path);
    const isFolderPage = (c: FileChange) =>
      c.kind === 'created' && !c.drawing && /\.json$/i.test(c.path) && madeByClaude.some((path) => path.startsWith(`${c.path.slice(0, -'.json'.length)}/`));
    const own = new Set(all.filter((c) => written.has(c.path) || isFolderPage(c)).map((c) => c.path));
    const changes = all.filter((c) => own.has(c.path) || own.has(turn.repairDrawings.get(c.path) ?? ''));
    const kinds = new Map(changes.map((c) => [c.path, c.kind]));
    for (const action of turn.actions) {
      if (action.verb === 'created' && action.path !== undefined && kinds.get(action.path) === 'edited') action.verb = 'edited';
    }
    const message: ChatMessage = { id: turn.messageId, role: 'assistant', text: turn.text.join(''), created: turn.created, actions: turn.actions };
    if (changes.length) message.changes = changes;
    if (error !== undefined) message.error = error;
    return message;
  }

  /** The chat with the reply added. Only a turn that ended well gives the chat a session to resume; one the CLI lost is dropped. */
  private withReply(turn: Turn, message: ChatMessage): Chat {
    const { chat } = turn;
    if (turn.done?.ok === true && turn.sessionId) chat.sessionId = turn.sessionId;
    else if (turn.resumed && message.error !== undefined && LOST_SESSION.test(message.error)) chat.sessionId = null;
    chat.updated = new Date().toISOString();
    chat.messages.push(message);
    return chat;
  }

  /**
   * The child is gone (or never started): the reply is finished, saved, and reported. Whatever goes wrong, the window
   * gets its `done` (unless the workspace closed), and the service is free again.
   */
  private async end(turn: Turn, exit: Exit): Promise<void> {
    if (turn.exiting) return;
    turn.exiting = true;
    this.clearTimers(turn);
    try {
      const message = await this.finish(turn, exit);
      if (message && !this.closed) this.deps.send({ chatId: turn.chat.id, messageId: turn.messageId, kind: 'done', message });
    } catch (failure) {
      console.error('Reporting the end of a Claude turn failed:', failure);
    } finally {
      if (this.turn === turn) {
        this.turn = null;
        this.busy = false;
        this.activeChatId = null;
        this.stopRequested = false;
        this.repairDeferred();
      }
    }
  }

  /**
   * The reply, saved in its chat, for the window; null once the workspace is closed, as the close keeps the record. A
   * reply that couldn't be finished or saved comes back with why, and without its changes: undo reads them from the chat
   * file, so they can't be undone.
   */
  private async finish(turn: Turn, exit: Exit): Promise<ChatMessage | null> {
    let message: ChatMessage | null = null;
    try {
      if (this.closed) return null;
      for (const line of turn.splitter.end()) this.line(turn, line);
      // So the turn's last writes are seen.
      await this.session.settle().catch((error: unknown) => console.error('Reading the workspace after a turn failed:', error));
      if (this.closed) return null;
      turn.recording = false;
      message = this.reply(turn, this.errorOf(turn, exit));
      if (turn.done?.loggedOut) this.loggedOut = true;
      else if (turn.done?.ok) this.loggedOut = false;
      const chat = this.withReply(turn, message);
      turn.saving = true;
      const saving = writeChat(this.root, chat);
      turn.record = saving.then(
        () => {},
        () => {},
      );
      await saving;
      this.remember(chat.id, message);
      return message;
    } catch (failure) {
      console.error('Finishing a Claude turn failed:', failure);
      const unsaved: ChatMessage = message ? { ...message } : { id: turn.messageId, role: 'assistant', text: turn.text.join(''), created: turn.created, actions: turn.actions };
      delete unsaved.changes;
      return { ...unsaved, error: `Couldn't save this reply: ${errorText(failure)}` };
    }
  }

  /** A reply now in its chat file, which a tidy-up by the app may still reach. */
  private remember(chatId: string, message: ChatMessage): void {
    if (!message.changes?.length) return;
    this.finished.push({ chatId, messageId: message.id, paths: new Set(message.changes.map((c) => c.path)) });
    if (this.finished.length > KEEP_FINISHED) this.finished.shift();
  }

  /**
   * Called with files the window rewrote only to fill in or tidy what an outside write left, such as a page without a
   * position, or strokes moved out of a page into a drawing file. The owner changed nothing, so where the tidy-up lands
   * on what a turn left, it becomes part of that turn's change, and undo doesn't take it for an edit. A running turn takes
   * it in at once; a finished reply's chat file is updated in turn with undos. Nothing is sent to the window: the chat
   * file is what undo reads.
   */
  repaired(files: RepairedFile[]): void {
    if (this.closed || files.length === 0) return;
    const turn = this.turn;
    if (turn?.recording) for (const { path, page } of turn.changes.repair(files)) turn.repairDrawings.set(path, page);
    // A send or turn writes its chat from its own copy, read when it started: finished replies wait until it's over.
    if (this.busy) this.deferredRepairs.push(files);
    else this.repairFinished(files);
  }

  private repairDeferred(): void {
    for (const files of this.deferredRepairs.splice(0)) this.repairFinished(files);
  }

  private repairFinished(files: RepairedFile[]): void {
    if (this.closed) return;
    const replies = this.finished.filter((r) => files.some((f) => mayHaveLeft(r.paths, f.path)));
    if (replies.length === 0) return;
    const run = this.undoQueue.then(() => this.repairReplies(replies, files));
    this.undoQueue = run.catch(() => {});
  }

  /** Moves these replies' recorded changes over the tidy-up, leaving paths already undone, and writes each chat that changed. */
  private async repairReplies(replies: FinishedReply[], files: RepairedFile[]): Promise<void> {
    const byChat = new Map<string, Set<string>>();
    for (const r of replies) byChat.set(r.chatId, (byChat.get(r.chatId) ?? new Set<string>()).add(r.messageId));
    for (const [chatId, messageIds] of byChat) {
      if (this.closed) return;
      try {
        const chat = await readChat(this.root, chatId);
        if (!chat) continue;
        let changed = false;
        for (const message of chat.messages) {
          if (message.role !== 'assistant' || !messageIds.has(message.id) || !Array.isArray(message.changes)) continue;
          const recorded: unknown[] = message.changes;
          const undone = new Set(Array.isArray(message.undone) ? message.undone.filter(isString) : []);
          const out = repairChanges(recorded.filter(isUndoable), files, undone);
          if (!out.changed) continue;
          // Anything in a hand-edited chat file that undo wouldn't touch stays as it is.
          message.changes = [...(recorded.filter((c) => !isUndoable(c)) as FileChange[]), ...out.changes];
          changed = true;
        }
        if (changed && !this.closed) await writeChat(this.root, chat);
      } catch (error) {
        console.error('Updating a reply after the app tidied its pages failed:', error);
      }
    }
  }

  private clearTimers(turn: Turn): void {
    if (turn.stopTimer) clearTimeout(turn.stopTimer);
    turn.stopTimer = null;
    if (turn.exitTimer) clearTimeout(turn.exitTimer);
    turn.exitTimer = null;
  }

  private errorOf(turn: Turn, exit: Exit): string | undefined {
    const { done } = turn;
    if (done?.ok) return undefined;
    if (turn.stopped) return 'Stopped';
    if (done) return done.error || 'Claude reported an error';
    const why = turn.stderr.trim() || exit.error?.message || (exit.signal ? `signal ${exit.signal}` : `exit code ${exit.code}`);
    return `Claude stopped unexpectedly: ${why}`;
  }

  /**
   * SIGINT, then SIGTERM and SIGKILL, each after the grace period, while it's still running. Asked again, SIGKILL at
   * once. The turn ends as usual, as "Stopped".
   */
  async stop(): Promise<void> {
    if (this.closed) return;
    if (this.turn) this.stopTurn(this.turn);
    else if (this.busy) this.stopRequested = true;
  }

  private stopTurn(turn: Turn): void {
    const child = turn.child;
    if (turn.exiting || !child || !isRunning(child)) return;
    if (turn.stopped) {
      if (turn.stopTimer) clearTimeout(turn.stopTimer);
      turn.stopTimer = null;
      child.kill('SIGKILL');
      return;
    }
    turn.stopped = true;
    child.kill('SIGINT');
    turn.stopTimer = setTimeout(() => {
      turn.stopTimer = null;
      if (!isRunning(child)) return;
      child.kill('SIGTERM');
      turn.stopTimer = setTimeout(() => {
        turn.stopTimer = null;
        if (isRunning(child)) child.kill('SIGKILL');
      }, this.graceMs);
    }, this.graceMs);
  }

  /**
   * The workspace is closing: the child is ended at once, and nothing more is reported. A running turn's reply so far
   * is kept in its chat, in this workspace, so what Claude changed can still be undone after reopening it. Resolves
   * (never rejects) once that record is written, or failed to be; every later call gives the same promise.
   */
  close(): Promise<void> {
    this.closing ??= this.closeNow();
    return this.closing;
  }

  private closeNow(): Promise<void> {
    this.closed = true;
    const turn = this.turn;
    if (!turn) return Promise.resolve();
    if (turn.stopTimer) clearTimeout(turn.stopTimer);
    turn.stopTimer = null;
    const child = turn.child;
    if (child && isRunning(child)) {
      child.kill('SIGTERM');
      // Nothing may go on editing the workspace unseen: a child that ignores SIGTERM is killed.
      const timer = setTimeout(() => {
        if (isRunning(child)) child.kill('SIGKILL');
      }, this.graceMs);
      child.once('exit', () => clearTimeout(timer));
    }
    // The end of the turn is already writing its reply: that is the record.
    if (turn.saving) return turn.record ?? Promise.resolve();
    turn.saving = true;
    turn.recording = false;
    const failed = (error: unknown) => console.error('Keeping the record of a stopped turn failed:', error);
    let record: Promise<void>;
    try {
      // No settle: the session is closing too. The changes are those already seen.
      const chat = this.withReply(turn, this.reply(turn, turn.done?.ok ? undefined : CLOSED_MID_TURN));
      record = writeChat(this.root, chat).catch(failed);
    } catch (error) {
      failed(error);
      record = Promise.resolve();
    }
    turn.record = record;
    return record;
  }

  /** Looks for the CLI again, and asks it its version and whether it's logged in. */
  async status(): Promise<ClaudeStatus> {
    if (this.closed) return { state: 'error', message: CLOSED };
    const path = await this.deps.locate();
    this.claudePath = path;
    if (!path) return { state: 'missing' };
    const env = this.env(path);
    let version: string;
    try {
      const out = await this.run(path, ['--version'], env);
      version = firstLine(out.stdout);
      if (out.code !== 0 || !version) return { state: 'error', path, message: firstLine(out.stderr) || `claude --version failed (exit code ${out.code})` };
    } catch (error) {
      this.forget(path);
      return { state: 'error', path, message: errorText(error) };
    }
    // Only loggedIn is read: the rest of this output holds the owner's email and organisation.
    let loggedOut = this.loggedOut;
    try {
      const out = await this.run(path, ['auth', 'status'], env);
      const parsed: unknown = JSON.parse(out.stdout);
      const loggedIn = isObject(parsed) ? parsed.loggedIn : undefined;
      if (loggedIn === false) loggedOut = true;
      else if (loggedIn === true) loggedOut = false;
    } catch {
      // Can't tell: the last turn's answer stands.
    }
    this.loggedOut = loggedOut;
    return { state: loggedOut ? 'logged-out' : 'ready', path, version };
  }

  /** Runs the CLI for a quick answer. Rejects when it can't start or takes too long. */
  private run(path: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = this.deps.spawn(path, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`claude ${args.join(' ')} didn't answer in time`));
      }, STATUS_TIMEOUT_MS);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (stdout.length < STATUS_OUTPUT_KEEP) stdout += chunk;
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < STATUS_OUTPUT_KEEP) stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  }

  /** Puts back what a reply changed, and records it in the chat. Refused while a turn runs. */
  undo(chatId: string, messageId: string, paths: string[] | null, force: boolean): Promise<UndoResult> {
    if (this.closed) return Promise.reject(new Error(CLOSED));
    if (this.busy) return Promise.reject(new Error(BUSY));
    const run = this.undoQueue.then(() => this.undoNow(chatId, messageId, paths, force));
    this.undoQueue = run.catch(() => {});
    return run;
  }

  private async undoNow(chatId: string, messageId: string, paths: string[] | null, force: boolean): Promise<UndoResult> {
    if (this.closed) throw new Error(CLOSED);
    const chat = await readChat(this.root, chatId);
    const message = chat?.messages.find((m) => m.id === messageId && m.role === 'assistant');
    if (!chat || !message) throw new Error('That reply is gone');
    const undone = Array.isArray(message.undone) ? message.undone.filter(isString) : [];
    const wanted = paths === null ? null : new Set(paths);
    const recorded: unknown[] = Array.isArray(message.changes) ? message.changes : [];
    const changes = recorded.filter(isUndoable).filter((c) => !undone.includes(c.path) && (wanted === null || wanted.has(c.path)));
    if (this.closed) throw new Error(CLOSED);
    // The folder is read again before the queue moves on: a save the window planned before the undo is then refused as
    // stale, instead of writing over the text just put back.
    const result = await this.session.exclusive(() => undoChanges(this.root, changes, { force, trash: this.deps.trash }), { rescanAfter: true });
    if (result.undone.length && !this.closed) {
      message.undone = [...undone, ...result.undone.filter((p) => !undone.includes(p))];
      await writeChat(this.root, chat);
    }
    return result;
  }

  listChats(): Promise<ChatSummary[]> {
    return listChats(this.root);
  }

  readChat(id: string): Promise<Chat | null> {
    return readChat(this.root, id);
  }

  /** Moves a chat to the Trash, unless Claude is answering in it. */
  async deleteChat(id: string): Promise<void> {
    if (this.closed) throw new Error(CLOSED);
    if (id === this.activeChatId) throw new Error('Claude is answering in this chat');
    // After the undos and reply updates already queued, so none of them writes the chat back.
    const run = this.undoQueue.then(() => deleteChat(this.root, id, this.deps.trash));
    this.undoQueue = run.catch(() => {});
    await run;
  }
}
