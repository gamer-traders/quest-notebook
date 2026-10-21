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

/** The paths a reply changed that haven't been undone yet. */
export function undoablePaths(message: ChatMessage): string[] {
  const undone = message.undone ?? [];
  return (message.changes ?? []).filter((c) => !undone.includes(c.path)).map((c) => c.path);
}

/** A reference as its chip says it: the page's title, or where a passage came from. */
export function referenceLabel(ref: ChatReference): string {
  const title = ref.title.trim() || 'Untitled';
  return ref.kind === 'page' ? title : `Selection from ${title}`;
}
