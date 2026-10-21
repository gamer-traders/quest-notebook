import { expect, test } from 'vitest';
import { isAppMadeDrawing } from './drawingFile';

const head = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="400" viewBox="0 0 1000 400" data-background="grid">';
const paper = '<rect width="1000" height="400" fill="#ffffff"/>';
const rules = '<defs><pattern id="rules" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#d3dbe4" stroke-width="1"/></pattern></defs><rect width="1000" height="400" fill="url(#rules)"/>';
const stroke = '<path data-tool="pen" data-color="ink" data-size="3" data-pressure="true" data-points="1,1,0.5 2,2,0.5" d="M1,1 Q 2,2 Z" fill="#17202a"/>';

test('a drawing file exactly as the app writes it is the app’s', () => {
  expect(isAppMadeDrawing([head, paper, rules, stroke, '</svg>'].join('\n') + '\n')).toBe(true);
  expect(isAppMadeDrawing([head, paper, '</svg>'].join('\n'))).toBe(true);
});

test.each([
  ['a text label', [head, paper, '<text x="1" y="2">62k</text>', stroke, '</svg>']],
  ['a shape of its own', [head, paper, '<rect x="10" y="10" width="50" height="20"/>', stroke, '</svg>']],
  ['a path drawn by hand, without stroke data', [head, paper, '<path d="M0 0 L100 100" stroke="black"/>', '</svg>']],
  ['a stroke with no outline yet', [head, paper, '<path data-points="1,1 2,2"/>', '</svg>']],
  ['a comment', [head, paper, '<!-- note -->', stroke, '</svg>']],
  ['a polyline', [head, '<polyline points="0,0 10,10"/>', '</svg>']],
  ['not an SVG at all', ['hello']],
])('a file with %s isn’t the app’s', (_, lines) => {
  expect(isAppMadeDrawing(lines.join('\n'))).toBe(false);
});
