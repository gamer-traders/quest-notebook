import { expect, test } from 'vitest';
import { edgeExit, type CaretPlace, type EdgeKey } from './codeKeys';

const key = (k: string, mods: Partial<EdgeKey> = {}): EdgeKey => ({ key: k, shift: false, alt: false, meta: false, ctrl: false, composing: false, ...mods });

// Three lines; the last one is 'abc', so its end is column 4.
const at = (line: number, column: number, more: Partial<CaretPlace> = {}): CaretPlace => ({
  line,
  column,
  lineCount: 3,
  lastColumn: 4,
  empty: true,
  cursors: 1,
  findOpen: false,
  ...more,
});

test('ArrowUp on the first line leaves for the block above, anywhere on the line', () => {
  expect(edgeExit(key('ArrowUp'), at(1, 1))).toBe('up');
  expect(edgeExit(key('ArrowUp'), at(1, 3))).toBe('up');
  expect(edgeExit(key('ArrowUp'), at(2, 1))).toBeNull();
});

test('ArrowDown on the last line leaves for the block below', () => {
  expect(edgeExit(key('ArrowDown'), at(3, 2))).toBe('down');
  expect(edgeExit(key('ArrowDown'), at(2, 2))).toBeNull();
});

test('ArrowLeft at the very start and ArrowRight at the very end leave too', () => {
  expect(edgeExit(key('ArrowLeft'), at(1, 1))).toBe('up');
  expect(edgeExit(key('ArrowLeft'), at(1, 2))).toBeNull();
  expect(edgeExit(key('ArrowRight'), at(3, 4))).toBe('down');
  expect(edgeExit(key('ArrowRight'), at(3, 3))).toBeNull();
});

test('a one-line block leaves both ways', () => {
  const only = (column: number) => at(1, column, { lineCount: 1, lastColumn: 4 });
  expect(edgeExit(key('ArrowUp'), only(2))).toBe('up');
  expect(edgeExit(key('ArrowDown'), only(2))).toBe('down');
});

test('Escape leaves and selects the block, unless it has find or extra cursors to put away first', () => {
  expect(edgeExit(key('Escape'), at(2, 2))).toBe('select');
  expect(edgeExit(key('Escape'), at(2, 2, { empty: false }))).toBe('select');
  expect(edgeExit(key('Escape'), at(2, 2, { cursors: 2 }))).toBeNull();
  expect(edgeExit(key('Escape'), at(2, 2, { findOpen: true }))).toBeNull();
});

test('a selection, extra cursors, a modifier or a composition keep the arrows in the code', () => {
  expect(edgeExit(key('ArrowUp'), at(1, 1, { empty: false }))).toBeNull();
  expect(edgeExit(key('ArrowUp'), at(1, 1, { cursors: 2 }))).toBeNull();
  expect(edgeExit(key('ArrowUp', { shift: true }), at(1, 1))).toBeNull();
  expect(edgeExit(key('ArrowUp', { alt: true }), at(1, 1))).toBeNull();
  expect(edgeExit(key('ArrowUp', { meta: true }), at(1, 1))).toBeNull();
  expect(edgeExit(key('ArrowUp', { ctrl: true }), at(1, 1))).toBeNull();
  expect(edgeExit(key('ArrowUp', { composing: true }), at(1, 1))).toBeNull();
  expect(edgeExit(key('Escape', { shift: true }), at(2, 2))).toBeNull();
});

test('other keys stay in the code', () => {
  expect(edgeExit(key('a'), at(1, 1))).toBeNull();
  expect(edgeExit(key('Enter'), at(3, 4))).toBeNull();
  expect(edgeExit(key('Tab'), at(1, 1))).toBeNull();
});
