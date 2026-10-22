import type { ChatMessage, ChatReference, FileChange } from '@shared/ipc';

// The Claude panel's small rules, kept apart from its components so they can be tested.

type ShortcutKeys = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

/** Cmd+J on a Mac, Ctrl+J elsewhere. The J is also known by its key, for layouts that type another letter there. */
export function isClaudeShortcut(e: ShortcutKeys, mac: boolean): boolean {
  const command = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return command && !e.altKey && !e.shiftKey && (e.key === 'j' || e.code === 'KeyJ');
}

export const claudeShortcutLabel = (mac: boolean) => (mac ? '⌘J' : 'Ctrl+J');

// Past this, the words after an @ are more likely a sentence than a page's name.
const MAX_QUERY = 60;

/**
 * The `@query` being typed: an @ at the start or after white space, then the words up to the caret, on one line.
 * Page titles have spaces, so the query can too; it just can't start with one.
 */
export function atQuery(text: string, caret: number): { start: number; query: string } | null {
  const start = text.lastIndexOf('@', caret - 1);
  if (start < 0 || caret - start - 1 > MAX_QUERY) return null;
  if (start > 0 && !/\s/.test(text[start - 1])) return null;
  const query = text.slice(start + 1, caret);
  if (query.includes('\n') || /^\s/.test(query)) return null;
  return { start, query };
}

/** The text with the typed `@query` (from `start` to the caret) taken out, and where the caret goes. */
export function withoutQuery(text: string, start: number, caret: number): { text: string; caret: number } {
  return { text: text.slice(0, start) + text.slice(caret), caret: start };
}

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** When a chat was last written to, the way the chat list says it: "40 min ago", "yesterday", "Monday", "3 Oct". */
export function relativeDate(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days === 0) return `${Math.floor(minutes / 60)} h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return weekday.format(then);
  return then.getFullYear() === now.getFullYear() ? dayMonth.format(then) : dayMonthYear.format(then);
}

/** Only these open, in the browser. Anything else in a reply is shown as plain text. */
export const isWebUrl = (url: string): boolean => /^https?:\/\/\S+$/i.test(url);

/** What went wrong, without the "Error invoking remote method" wrapping a rejection from main comes in. */
export function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^Error invoking remote method '[^']*': /, '').replace(/^Error: /, '');
}

const DRAWING = /^(.*)\/drawing-[^/]+\.svg$/;

/** The page file a path belongs to: itself, or for a drawing the page whose folder holds it. */
export function pagePathFor(path: string): string {
  const drawing = DRAWING.exec(path);
  return drawing ? `${drawing[1]}.json` : path;
}

/** The word for one line under "Changed:". */
export function changeVerb(change: FileChange): 'Edited' | 'Created' | 'Drew in' {
  if (change.drawing) return 'Drew in';
  return change.kind === 'created' ? 'Created' : 'Edited';
}

/**
 * The paths a reply changed that haven't been undone yet. Pages in `notApplied` are left out: the reply's changes
 * didn't reach them, so their files hold the owner's own words, which an undo would put back to before the reply.
 */
export function undoablePaths(message: ChatMessage, notApplied: readonly string[] = []): string[] {
  const undone = message.undone ?? [];
  const reached = (c: FileChange) => c.pageId === undefined || !notApplied.includes(c.pageId);
  return (message.changes ?? []).filter((c) => !undone.includes(c.path) && reached(c)).map((c) => c.path);
}

/** The pages behind some changed paths, by title and each once: a page and its drawings are one page. A path whose page isn't known goes by itself. */
export function changedTitles(message: ChatMessage | undefined, paths: string[], titleOf: (pageId: string) => string | null): string[] {
  const changes = Array.isArray(message?.changes) ? message.changes : [];
  const titles = new Map<string, string>();
  for (const path of paths) {
    const pageId = changes.find((c) => c.path === path)?.pageId;
    const title = pageId ? titleOf(pageId) : null;
    const key = title === null ? `path:${path}` : `page:${pageId}`;
    if (!titles.has(key)) titles.set(key, title ?? path);
  }
  return [...titles.values()];
}

/** Asked before an undo puts back pages written to since Claude's reply. */
export function conflictQuestion(titles: string[]): string {
  const names = titles.map((t) => `“${t}”`).join(', ');
  return `${titles.length === 1 ? 'This page' : 'These pages'} changed since Claude's reply: ${names}. Undo anyway?`;
}

/** Main refuses a longer message, so the box doesn't send one. Counted as main counts it, in UTF-16 units. */
export const MAX_MESSAGE = 100_000;

export const isTooLong = (text: string): boolean => text.length > MAX_MESSAGE;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string';
const isTextOrNone = (v: unknown) => v === undefined || isText(v);
const kept = <T>(list: unknown, keep: (item: unknown) => boolean): T[] => (Array.isArray(list) ? (list.filter(keep) as T[]) : []);

const isReference = (r: unknown) => isRecord(r) && isText(r.pageId) && isText(r.title) && (r.kind === 'page' || (r.kind === 'selection' && isText(r.text)));
const isAction = (a: unknown) => isRecord(a) && isText(a.verb) && isTextOrNone(a.id) && isTextOrNone(a.path) && isTextOrNone(a.detail);
const isChange = (c: unknown) => isRecord(c) && isText(c.path) && isTextOrNone(c.pageId);

/**
 * A saved message as the panel can draw it. A damaged chat file can hold anything, such as a list that isn't one
 * or an error that isn't words: what can't be drawn is left out, so one bad message doesn't take the panel with it.
 */
export function drawableMessage(message: ChatMessage): ChatMessage {
  const m = message as unknown as Record<string, unknown>;
  return {
    id: String(m.id),
    role: m.role === 'user' ? 'user' : 'assistant',
    text: isText(m.text) ? m.text : '',
    created: isText(m.created) ? m.created : '',
    references: kept(m.references, isReference),
    actions: kept(m.actions, isAction),
    changes: kept(m.changes, isChange),
    undone: kept(m.undone, isText),
    ...(isText(m.error) ? { error: m.error } : {}),
  };
}

/** A reference as its chip says it: the page's title, or where a passage came from. */
export function referenceLabel(ref: ChatReference): string {
  const title = ref.title.trim() || 'Untitled';
  return ref.kind === 'page' ? title : `Selection from ${title}`;
}
