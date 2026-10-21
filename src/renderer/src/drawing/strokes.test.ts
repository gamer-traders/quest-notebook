import { expect, test } from 'vitest';
import type { Stroke } from './model';
import { decodePoints, encodePoints, grownHeight, strokePath, strokesHit } from './strokes';

const stroke = (id: string, points: number[], patch: Partial<Stroke> = {}): Stroke => ({ id, tool: 'pen', color: 'ink', size: 4, pressure: true, points, ...patch });

/** The outline's extent across y, for a stroke drawn along the x axis. */
function thickness(d: string): number {
  const ys = [...d.matchAll(/-?\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  return Math.max(...ys) - Math.min(...ys);
}

const line = (pressure: number) => Array.from({ length: 20 }, (_, i) => [i * 10, 50, pressure]).flat();

test('points are written short: one decimal for position, two for pressure', () => {
  expect(encodePoints([1.234, 5.678, 0.456, 10, 20, 1])).toBe('1.2,5.7,0.46 10,20,1');
});

test('points read back, skipping what can’t be read and taking 0.5 for missing pressure', () => {
  expect(decodePoints(' 1,2,0.5  3,4 x,y,z 5,6,0.7 ')).toEqual([1, 2, 0.5, 3, 4, 0.5, 5, 6, 0.7]);
  expect(decodePoints('')).toEqual([]);
  expect(decodePoints('1,2,9')).toEqual([1, 2, 1]);
});

test('a stroke becomes a filled outline path', () => {
  expect(strokePath(stroke('s', line(0.5)))).toMatch(/^M/);
  expect(strokePath(stroke('s', []))).toBe('');
});

test('a pen pressed harder draws a thicker line', () => {
  const light = thickness(strokePath(stroke('a', line(0.1), { size: 6 })));
  const heavy = thickness(strokePath(stroke('b', line(1), { size: 6 })));
  expect(heavy).toBeGreaterThan(light * 1.5);
});

test('the eraser finds strokes passing within its reach', () => {
  const s = stroke('s', [0, 0, 0.5, 100, 0, 0.5], { size: 4 });
  expect(strokesHit([s], 50, 3, 2)).toEqual(['s']);
  expect(strokesHit([s], 50, 10, 2)).toEqual([]);
  expect(strokesHit([stroke('dot', [20, 20, 0.5])], 21, 21, 2)).toEqual(['dot']);
});

test('the canvas grows when a stroke ends near its bottom, until the stroke is clear', () => {
  expect(grownHeight(400, 300)).toBe(400);
  expect(grownHeight(400, 350)).toBe(700);
  expect(grownHeight(400, 900)).toBe(1000);
});
