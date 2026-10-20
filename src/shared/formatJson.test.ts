import { expect, test } from 'vitest';
import { formatJson } from './formatJson';

test('leaf containers stay on one line', () => {
  expect(formatJson({ a: 1, b: [1, 2], c: { x: 'y' } })).toBe('{\n  "a": 1,\n  "b": [1, 2],\n  "c": { "x": "y" }\n}\n');
});

test('empty containers', () => {
  expect(formatJson({ a: [], b: {} })).toBe('{\n  "a": [],\n  "b": {}\n}\n');
});

test('containers holding containers break over lines', () => {
  expect(formatJson({ rows: [{ t: 1 }, { t: 2 }] })).toBe('{\n  "rows": [\n    { "t": 1 },\n    { "t": 2 }\n  ]\n}\n');
});

test('a leaf too long for the width breaks', () => {
  const out = formatJson({ list: Array.from({ length: 40 }, (_, i) => i * 1000) });
  expect(out.split('\n').every((line) => line.length <= 120)).toBe(true);
  expect(JSON.parse(out)).toEqual({ list: Array.from({ length: 40 }, (_, i) => i * 1000) });
});

test('round-trips, leaving out undefined like JSON.stringify', () => {
  const value = { blocks: [{ type: 'p', text: 'a "q"\n\\' }, { n: null, b: true, u: undefined }], top: 'x' };
  expect(JSON.parse(formatJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
});
