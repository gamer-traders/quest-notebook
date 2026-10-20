import { expect, test } from 'vitest';
import { safeName, uniqueName, UNTITLED } from './names';

test('safeName makes a title safe as a file or folder name', () => {
  expect(safeName('BTC/USDT: levels?')).toBe('BTC-USDT- levels-');
  expect(safeName('')).toBe(UNTITLED);
  expect(safeName('   ')).toBe('Untitled');
  expect(safeName('..hidden. ')).toBe('hidden');
  expect(safeName('a\u0000b\nc')).toBe('abc');
  expect(safeName('x'.repeat(200))).toHaveLength(120);
  expect(safeName('Weekly levels')).toBe('Weekly levels');
  expect(safeName('../../evil')).toBe('-..-evil');
  expect(safeName('a\\b*c"d<e>f|g')).toBe('a-b-c-d-e-f-g');
});

test('uniqueName adds a number when a sibling has the name, ignoring case', () => {
  expect(uniqueName('Notes', [])).toBe('Notes');
  expect(uniqueName('Notes', ['notes'])).toBe('Notes 2');
  expect(uniqueName('Notes', ['Notes', 'NOTES 2'])).toBe('Notes 3');
  expect(uniqueName('Notes', new Set(['Other']))).toBe('Notes');
});

test('uniqueName treats composed and decomposed accents as the same name', () => {
  expect(uniqueName('Caf\u00e9', ['Cafe\u0301'])).toBe('Caf\u00e9 2');
});
