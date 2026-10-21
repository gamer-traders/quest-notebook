import { beforeEach, expect, test, vi } from 'vitest';

// Counts how often perfect-freehand works out an outline, the costly part of drawing a stroke.
const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('perfect-freehand', async (importOriginal) => {
  const real = await importOriginal<typeof import('perfect-freehand')>();
  return { ...real, getStroke: (...args: Parameters<typeof real.getStroke>) => (calls.n++, real.getStroke(...args)) };
});

import type { Stroke } from './model';
import { outlineOf } from './strokes';
import { drawingToSvg } from './svg';
import { encodedPoints } from './strokes';

const strokes: Stroke[] = Array.from({ length: 50 }, (_, i) => ({
  id: `s${i}`, tool: 'pen', color: 'ink', size: 3, pressure: true, points: [i, 10, 0.5, i + 40, 60, 0.7, i + 80, 20, 0.4],
}));

beforeEach(() => {
  calls.n = 0;
});

test('each stroke’s outline is worked out once, for the canvas and every picture after it', () => {
  for (const s of strokes) outlineOf(s);
  expect(calls.n).toBe(50);
  drawingToSvg({ height: 400, background: 'blank', strokes });
  // A new stroke added: only it is worked out.
  const added: Stroke = { ...strokes[0], id: 'new' };
  drawingToSvg({ height: 400, background: 'blank', strokes: [...strokes, added] });
  expect(calls.n).toBe(51);
});

test('a stroke’s points are written out once', () => {
  const s = strokes[3];
  expect(encodedPoints(s)).toBe(encodedPoints(s));
  expect(encodedPoints(s)).toBe('3,10,0.5 43,60,0.7 83,20,0.4');
});
