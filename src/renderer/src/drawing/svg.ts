import { DRAWING_WIDTH, type Background, type InkColor, type Stroke } from './model';
import { outlineOf } from './strokes';

/** The light theme's colours, for the picture copy: pens in each colour's strong ink, the highlighter in its tint. */
export const LIGHT_COLORS: { pen: Record<InkColor, string>; highlight: Record<InkColor, string>; rule: string; paper: string } = {
  pen: { ink: '#17202a', yellow: '#946600', blue: '#1d5bc2', green: '#0a6b59', red: '#a8263b', purple: '#643dc2', gray: '#3b4754' },
  highlight: { ink: '#17202a', yellow: '#f7c948', blue: '#3b7de6', green: '#0e8a74', red: '#c93a50', purple: '#7c54d6', gray: '#5c6977' },
  rule: '#d3dbe4',
  paper: '#ffffff',
};

/** Highlighter and pencil strokes are see-through. */
export const OPACITY = { highlighter: 0.35, pencil: 0.85 } as const;

/** The background pattern's cell: grid squares, or ruled lines. */
export const RULE_GAP = 40;

function patternFor(background: Background): string {
  if (background === 'blank') return '';
  const d = background === 'grid' ? `M ${RULE_GAP} 0 L 0 0 0 ${RULE_GAP}` : `M 0 ${RULE_GAP} L ${RULE_GAP} ${RULE_GAP}`;
  return `<defs><pattern id="rules" width="${RULE_GAP}" height="${RULE_GAP}" patternUnits="userSpaceOnUse"><path d="${d}" fill="none" stroke="${LIGHT_COLORS.rule}" stroke-width="1"/></pattern></defs>`;
}

function pathFor(stroke: Stroke): string {
  const d = outlineOf(stroke);
  if (!d) return '';
  const color = stroke.tool === 'highlighter' ? LIGHT_COLORS.highlight[stroke.color] : LIGHT_COLORS.pen[stroke.color];
  const opacity = stroke.tool === 'highlighter' || stroke.tool === 'pencil' ? ` fill-opacity="${OPACITY[stroke.tool]}"` : '';
  return `<path data-tool="${stroke.tool}" d="${d}" fill="${color}"${opacity}/>`;
}

/** A drawing as a standalone SVG picture, for tools that look at images. Highlighter strokes go under the ink. */
export function drawingToSvg(drawing: { height: number; background: Background; strokes: Stroke[] }): string {
  const { height, background, strokes } = drawing;
  const ordered = [...strokes.filter((s) => s.tool === 'highlighter'), ...strokes.filter((s) => s.tool !== 'highlighter')];
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DRAWING_WIDTH}" height="${height}" viewBox="0 0 ${DRAWING_WIDTH} ${height}">`,
    `<rect width="${DRAWING_WIDTH}" height="${height}" fill="${LIGHT_COLORS.paper}"/>`,
    patternFor(background),
    background === 'blank' ? '' : `<rect width="${DRAWING_WIDTH}" height="${height}" fill="url(#rules)"/>`,
    ...ordered.map(pathFor),
    '</svg>',
  ];
  return `${lines.filter(Boolean).join('\n')}\n`;
}
