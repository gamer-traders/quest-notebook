import { expect, test } from 'vitest';
import type { Stroke } from './model';
import { drawingFromSvg, drawingToSvg } from './svg';

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

const blankIds = (strokes: Stroke[]) => strokes.map((s) => ({ ...s, id: '' }));

test('each stroke carries its own data, so the picture is also the drawing', () => {
  const svg = drawingToSvg({ height: 420, background: 'grid', strokes: [pen] });
  expect(svg).toContain('data-background="grid"');
  expect(svg).toContain('data-tool="pen" data-color="ink" data-size="3" data-pressure="true" data-points="10,10,0.5 50,40,0.6 90,20,0.5"');
});

test('a drawing read back from its picture is the same drawing, highlighter first', () => {
  const back = drawingFromSvg(drawingToSvg({ height: 420, background: 'lines', strokes: [pen, marker] }))!;
  expect(back.height).toBe(420);
  expect(back.background).toBe('lines');
  expect(blankIds(back.strokes)).toEqual(blankIds([marker, pen]));
  expect(back.strokes.every((s) => s.id.length > 0)).toBe(true);
});

test('a drawing written by hand is read with defaults, and anything without points is ignored', () => {
  const handmade = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 300'>
    <rect width='1000' height='300' fill='white'/>
    <path d='M 0 0 L 10 10' stroke='black'/>
    <path data-points='10,10 20,20,0.9' data-tool='marker' data-color='red'/>
    <path data-tool="nonsense" data-color="teal" data-size="-2" data-points="5,5,0.5 6,6"/>
  </svg>`;
  const d = drawingFromSvg(handmade)!;
  expect(d.height).toBe(300);
  expect(d.background).toBe('blank');
  expect(blankIds(d.strokes)).toEqual([
    { id: '', tool: 'marker', color: 'red', size: 10, pressure: true, points: [10, 10, 0.5, 20, 20, 0.9] },
    { id: '', tool: 'pen', color: 'ink', size: 3, pressure: true, points: [5, 5, 0.5, 6, 6, 0.5] },
  ]);
  // The app writes it again in its own form, outlines drawn.
  expect(drawingToSvg(d)).not.toBe(handmade);
});

test('text that is not a drawing reads as nothing', () => {
  expect(drawingFromSvg('hello')).toBeNull();
  expect(drawingFromSvg('<html></html>')).toBeNull();
});

test('the app’s own picture reads back to exactly the same text', () => {
  const text = drawingToSvg({ height: 400, background: 'grid', strokes: [marker, pen] });
  expect(drawingToSvg(drawingFromSvg(text)!)).toBe(text);
});
