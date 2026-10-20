import { describe, expect, test } from 'vitest';
import { hitTestShapes, type MarkShape } from './hitTest';

const level = (id: string, y: number): MarkShape => ({ id, kind: 'band', y, half: 5 });
const trend = (id: string, x1: number, y1: number, x2: number, y2: number): MarkShape => ({ id, kind: 'segment', x1, y1, x2, y2, half: 4 });

describe('hitTestShapes', () => {
  test('finds a level when the pointer is on its band', () => {
    expect(hitTestShapes([level('L', 100)], 50, 104)).toBe('L');
  });

  test('misses a level when the pointer is well above it', () => {
    expect(hitTestShapes([level('L', 100)], 50, 112)).toBeNull();
  });

  test('finds a trend line near the line itself', () => {
    expect(hitTestShapes([trend('T', 0, 0, 100, 100)], 50, 56)).toBe('T');
  });

  test('misses beyond the end of a trend line, even in line with it', () => {
    expect(hitTestShapes([trend('T', 0, 0, 100, 100)], 130, 130)).toBeNull();
  });

  test('a text label wins over the level underneath it', () => {
    const shapes: MarkShape[] = [level('L', 100), { id: 'X', kind: 'box', x: 40, y: 90, w: 60, h: 20 }];

    expect(hitTestShapes(shapes, 50, 100)).toBe('X');
  });

  test('a trend line wins over a level it crosses', () => {
    expect(hitTestShapes([level('L', 50), trend('T', 0, 0, 100, 100)], 50, 50)).toBe('T');
  });

  test('picks the nearer of two overlapping levels', () => {
    expect(hitTestShapes([level('A', 100), level('B', 108)], 50, 105)).toBe('B');
  });

  test('finds nothing when there are no marks', () => {
    expect(hitTestShapes([], 10, 10)).toBeNull();
  });
});
