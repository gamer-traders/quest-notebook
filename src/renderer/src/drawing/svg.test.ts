import { expect, test } from 'vitest';
import type { Stroke } from './model';
import { drawingToSvg } from './svg';

const pen: Stroke = { id: 'p', tool: 'pen', color: 'ink', size: 3, pressure: true, points: [10, 10, 0.5, 50, 40, 0.6, 90, 20, 0.5] };
const marker: Stroke = { ...pen, id: 'h', tool: 'highlighter', color: 'yellow', size: 22 };

test('a drawing becomes a standalone picture, highlighter under the ink', () => {
  const svg = drawingToSvg({ height: 420, background: 'grid', strokes: [pen, marker] });
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg).toContain('viewBox="0 0 1000 420"');
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg.match(/<path data-tool=/g)).toHaveLength(2);
  expect(svg.indexOf('data-tool="highlighter"')).toBeLessThan(svg.indexOf('data-tool="pen"'));
  expect(svg).toContain('#17202a');
  // The grid is drawn.
  expect(svg).toContain('<pattern');
});

test('a blank drawing has no pattern', () => {
  expect(drawingToSvg({ height: 400, background: 'blank', strokes: [] })).not.toContain('<pattern');
});
