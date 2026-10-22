import { expect, test } from 'vitest';
import type { ChatMessage, FileChange } from '@shared/ipc';
import {
  MAX_MESSAGE,
  atQuery,
  changeVerb,
  changedTitles,
  conflictQuestion,
  drawableMessage,
  errorText,
  isClaudeShortcut,
  isTooLong,
  isWebUrl,
  pagePathFor,
  referenceLabel,
  referenceTooltip,
  relativeDate,
  undoablePaths,
  withoutQuery,
} from './panel';

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

test("a page the reply's changes didn't reach isn't undoable: the file holds the owner's words", () => {
  const onPage = (path: string, pageId: string, drawing = false): FileChange => ({ ...change(path, 'edited', drawing), pageId });
  const message: ChatMessage = {
    id: 'm',
    role: 'assistant',
    text: '',
    created: 'c',
    changes: [onPage('M/A.json', 'a'), onPage('M/A/drawing-x.svg', 'a', true), onPage('M/B.json', 'b'), change('M/Bad.json', 'edited')],
  };
  expect(undoablePaths(message, ['a'])).toEqual(['M/B.json', 'M/Bad.json']);
  expect(undoablePaths(message, [])).toEqual(['M/A.json', 'M/A/drawing-x.svg', 'M/B.json', 'M/Bad.json']);
});

test('the undo question names the pages that changed since the reply, each once', () => {
  const message: ChatMessage = {
    id: 'm',
    role: 'assistant',
    text: '',
    created: 'c',
    changes: [
      { ...change('M/A.json', 'edited'), pageId: 'a' },
      { ...change('M/A/drawing-x.svg', 'edited', true), pageId: 'a' },
      { ...change('M/B.json', 'created'), pageId: 'b' },
      { ...change('M/Gone.json', 'edited'), pageId: 'gone' },
    ],
  };
  const titleOf = (id: string) => ({ a: 'Support and resistance', b: 'Weekly levels' })[id] ?? null;
  expect(changedTitles(message, ['M/A.json', 'M/A/drawing-x.svg'], titleOf)).toEqual(['Support and resistance']);
  // A page no longer in the notebook, or a path the reply didn't list, goes by its path.
  expect(changedTitles(message, ['M/B.json', 'M/Gone.json', 'M/Other.json'], titleOf)).toEqual(['Weekly levels', 'M/Gone.json', 'M/Other.json']);
  expect(changedTitles(undefined, ['M/A.json'], titleOf)).toEqual(['M/A.json']);

  expect(conflictQuestion(['Weekly levels'])).toBe("This page changed since Claude's reply: “Weekly levels”. Undo anyway?");
  expect(conflictQuestion(['Support and resistance', 'Weekly levels'])).toBe("These pages changed since Claude's reply: “Support and resistance”, “Weekly levels”. Undo anyway?");
});

test('a message is too long to send past 100,000 characters, as main counts them', () => {
  expect(MAX_MESSAGE).toBe(100_000);
  expect(isTooLong('x'.repeat(100_000))).toBe(false);
  expect(isTooLong('x'.repeat(100_001))).toBe(true);
  expect(isTooLong('')).toBe(false);
});

test('a damaged message is drawn from what can be drawn, and the rest is left out', () => {
  const odd = {
    id: 'm',
    role: 'assistant',
    text: { not: 'text' },
    created: 7,
    references: 'nope',
    actions: { verb: 'read' },
    changes: 'x',
    undone: 3,
    error: { message: 'boom' },
  } as unknown as ChatMessage;
  expect(drawableMessage(odd)).toEqual({ id: 'm', role: 'assistant', text: '', created: '', references: [], actions: [], changes: [], undone: [] });

  const mixed = {
    id: 'm',
    role: 'user',
    text: 'hi',
    created: 'c',
    references: [null, { kind: 'page', pageId: 'a', title: 'A' }, { kind: 'selection', pageId: 'a', title: 'A' }, { kind: 'page', pageId: 'b', title: 5 }],
    actions: [{ verb: 'read', path: 'M/A.json' }, 'read', { verb: 'searched', detail: ['x'] }, { verb: 'edited', path: { p: 1 } }],
    changes: [{ path: 'M/A.json', pageId: 'a', kind: 'edited', drawing: false, before: null, after: null }, { path: 9 }, null, { path: 'M/B.json', pageId: 4 }],
    undone: ['M/A.json', 2, null],
    error: 'Usage limit reached',
  } as unknown as ChatMessage;
  expect(drawableMessage(mixed)).toEqual({
    id: 'm',
    role: 'user',
    text: 'hi',
    created: 'c',
    references: [{ kind: 'page', pageId: 'a', title: 'A' }],
    actions: [{ verb: 'read', path: 'M/A.json' }],
    changes: [{ path: 'M/A.json', pageId: 'a', kind: 'edited', drawing: false, before: null, after: null }],
    undone: ['M/A.json'],
    error: 'Usage limit reached',
  });
});

test('a reference chip names the page, or where the passage came from', () => {
  expect(referenceLabel({ kind: 'page', pageId: 'a', title: 'Weekly levels' })).toBe('Weekly levels');
  expect(referenceLabel({ kind: 'selection', pageId: 'a', title: 'Weekly levels', text: 'x' })).toBe('Selection from Weekly levels');
  expect(referenceLabel({ kind: 'page', pageId: 'a', title: ' ' })).toBe('Untitled');
});

test('a block reference chip reads the block, and its tooltip says the page and where', () => {
  const ref = { kind: 'block', pageId: 'a', title: 'Weekly levels', text: '{ "type": "paragraph", "text": "Entry at the **weekly** open" }', where: 'block 4 of 12' } as const;
  expect(referenceLabel(ref)).toBe('Block: Entry at the weekly open');
  expect(referenceTooltip(ref)).toBe('Weekly levels, block 4 of 12');
  expect(referenceTooltip({ kind: 'selection', pageId: 'a', title: 'W', text: 'x'.repeat(400) })).toBe('x'.repeat(300));
  expect(referenceTooltip({ kind: 'page', pageId: 'a', title: 'W' })).toBeUndefined();
});

test("a saved message keeps its block references and images, and leaves out ones it can't draw", () => {
  const block = { kind: 'block', pageId: 'a', title: 'A', text: '{}', where: 'block 1 of 2' };
  const message = {
    id: 'm',
    role: 'user',
    text: 'hi',
    created: 'c',
    references: [block, { ...block, where: 3 }, { ...block, text: null }],
    images: [{ file: 'c1abcdef-aaaaaaaa.png', type: 'image/png' }, { file: 'x.bmp', type: 'image/bmp' }, { file: 5, type: 'image/png' }, null, 'x.png'],
  } as unknown as ChatMessage;
  expect(drawableMessage(message)).toMatchObject({ references: [block], images: [{ file: 'c1abcdef-aaaaaaaa.png', type: 'image/png' }] });
  expect(drawableMessage({ ...message, images: 'nope' } as unknown as ChatMessage)).not.toHaveProperty('images');
});
