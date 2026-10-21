import { expect, test } from 'vitest';
import type { ChatMessage, FileChange } from '@shared/ipc';
import { atQuery, changeVerb, errorText, isClaudeShortcut, isWebUrl, pagePathFor, referenceLabel, relativeDate, undoablePaths, withoutQuery } from './panel';

test('an @ at the start or after a space opens the picker with what follows it, up to the caret', () => {
  expect(atQuery('@wee', 4)).toEqual({ start: 0, query: 'wee' });
  expect(atQuery('look at @wee', 12)).toEqual({ start: 8, query: 'wee' });
  expect(atQuery('two\n@we', 7)).toEqual({ start: 4, query: 'we' });
  expect(atQuery('@', 1)).toEqual({ start: 0, query: '' });
  // Titles have spaces, so the query can too.
  expect(atQuery('@weekly lev', 11)).toEqual({ start: 0, query: 'weekly lev' });
  // Only what's before the caret counts.
  expect(atQuery('@weekly levels', 4)).toEqual({ start: 0, query: 'wee' });
});

test('an @ inside a word, after a new line, before a space, or too far back is left alone', () => {
  expect(atQuery('me@mail', 7)).toBeNull();
  expect(atQuery('meet @ 5pm', 10)).toBeNull();
  expect(atQuery('@wee\nkly', 8)).toBeNull();
  expect(atQuery('no at here', 10)).toBeNull();
  expect(atQuery(`@${'x'.repeat(61)}`, 62)).toBeNull();
  expect(atQuery('', 0)).toBeNull();
});

test('choosing a page takes the typed @query out and leaves the caret where it was', () => {
  expect(withoutQuery('look at @wee please', 8, 12)).toEqual({ text: 'look at  please', caret: 8 });
  expect(withoutQuery('@wee', 0, 4)).toEqual({ text: '', caret: 0 });
});

const press = (keys: Partial<KeyboardEvent>) => ({ key: 'j', code: 'KeyJ', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...keys });

test('Cmd+J toggles the panel on a Mac, and Ctrl+J elsewhere', () => {
  expect(isClaudeShortcut(press({ metaKey: true }), true)).toBe(true);
  expect(isClaudeShortcut(press({ ctrlKey: true }), false)).toBe(true);
  expect(isClaudeShortcut(press({ ctrlKey: true }), true)).toBe(false);
  expect(isClaudeShortcut(press({ metaKey: true }), false)).toBe(false);
  expect(isClaudeShortcut(press({}), true)).toBe(false);
  expect(isClaudeShortcut(press({ metaKey: true, shiftKey: true, key: 'J' }), true)).toBe(false);
  expect(isClaudeShortcut(press({ metaKey: true, altKey: true }), true)).toBe(false);
  expect(isClaudeShortcut(press({ metaKey: true, key: 'k', code: 'KeyK' }), true)).toBe(false);
  // A layout that types another letter on the J key.
  expect(isClaudeShortcut(press({ metaKey: true, key: 'о' }), true)).toBe(true);
});

test('chat dates read as how long ago', () => {
  const now = new Date(2026, 9, 22, 15, 0);
  const at = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString();
  expect(relativeDate(new Date(now.getTime() - 30_000).toISOString(), now)).toBe('just now');
  expect(relativeDate(at(2026, 9, 22, 14, 59), now)).toBe('1 min ago');
  expect(relativeDate(at(2026, 9, 22, 14, 20), now)).toBe('40 min ago');
  expect(relativeDate(at(2026, 9, 22, 9, 0), now)).toBe('6 h ago');
  expect(relativeDate(at(2026, 9, 21, 23, 0), now)).toBe('yesterday');
  expect(relativeDate(at(2026, 9, 19, 12, 0), now)).toBe('Monday');
  expect(relativeDate(at(2026, 9, 3, 12, 0), now)).toBe('3 Oct');
  expect(relativeDate(at(2025, 11, 31, 12, 0), now)).toBe('31 Dec 2025');
  expect(relativeDate('not a date', now)).toBe('');
});

test('only http and https links open', () => {
  expect(isWebUrl('https://claude.com/claude-code')).toBe(true);
  expect(isWebUrl('HTTP://example.com')).toBe(true);
  expect(isWebUrl('javascript:alert(1)')).toBe(false);
  expect(isWebUrl('file:///etc/passwd')).toBe(false);
  expect(isWebUrl('Markets/A.json')).toBe(false);
  expect(isWebUrl('mailto:me@example.com')).toBe(false);
});

test('errors from main read without the IPC wrapping', () => {
  expect(errorText(new Error("Error invoking remote method 'claude:undo': Error: Claude is busy"))).toBe('Claude is busy');
  expect(errorText(new Error('plain'))).toBe('plain');
  expect(errorText('text')).toBe('text');
});

test("a drawing's page is the .json beside its folder", () => {
  expect(pagePathFor('Markets/A/drawing-x.svg')).toBe('Markets/A.json');
  expect(pagePathFor('Markets/A.json')).toBe('Markets/A.json');
});

const change = (path: string, kind: FileChange['kind'], drawing = false): FileChange => ({ path, kind, drawing, before: null, after: null });

test('changed lines say what happened, and which are still undoable', () => {
  expect(changeVerb(change('Markets/A.json', 'edited'))).toBe('Edited');
  expect(changeVerb(change('Markets/B.json', 'created'))).toBe('Created');
  expect(changeVerb(change('Markets/A/drawing-x.svg', 'edited', true))).toBe('Drew in');
  expect(changeVerb(change('Markets/A/drawing-y.svg', 'created', true))).toBe('Drew in');

  const message: ChatMessage = { id: 'm', role: 'assistant', text: '', created: 'c', changes: [change('a.json', 'edited'), change('b.json', 'created')], undone: ['a.json'] };
  expect(undoablePaths(message)).toEqual(['b.json']);
  expect(undoablePaths({ ...message, changes: undefined })).toEqual([]);
});

test('a reference chip names the page, or where the passage came from', () => {
  expect(referenceLabel({ kind: 'page', pageId: 'a', title: 'Weekly levels' })).toBe('Weekly levels');
  expect(referenceLabel({ kind: 'selection', pageId: 'a', title: 'Weekly levels', text: 'x' })).toBe('Selection from Weekly levels');
  expect(referenceLabel({ kind: 'page', pageId: 'a', title: ' ' })).toBe('Untitled');
});
