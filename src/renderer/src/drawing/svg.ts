import { BACKGROUNDS, DRAWING_WIDTH, INK_COLORS, NEW_HEIGHT, PEN_TOOLS, SIZES, type Background, type InkColor, type Stroke } from './model';
import { decodePoints, encodedPoints, outlineOf } from './strokes';
import { uid } from '../lib/cells';

/*
  A drawing is one SVG file: a picture anyone can look at, whose paths also carry the strokes they were
  drawn from. data-points is the truth; d, the drawn outline, is worked out from it again on every save.
*/

/** The light theme's colours, for the picture: pens in each colour's strong ink, the highlighter in its tint. */
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
  const color = stroke.tool === 'highlighter' ? LIGHT_COLORS.highlight[stroke.color] : LIGHT_COLORS.pen[stroke.color];
  const opacity = stroke.tool === 'highlighter' || stroke.tool === 'pencil' ? ` fill-opacity="${OPACITY[stroke.tool]}"` : '';
  const data = `data-tool="${stroke.tool}" data-color="${stroke.color}" data-size="${stroke.size}" data-pressure="${stroke.pressure}" data-points="${encodedPoints(stroke)}"`;
  return `<path ${data} d="${d}" fill="${color}"${opacity}/>`;
}

/** A drawing as its SVG file: the picture, with each stroke's data on its path. Highlighter strokes go under the ink. */
export function drawingToSvg(drawing: { height: number; background: Background; strokes: Stroke[] }): string {
  const { height, background, strokes } = drawing;
  const ordered = [...strokes.filter((s) => s.tool === 'highlighter'), ...strokes.filter((s) => s.tool !== 'highlighter')];
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DRAWING_WIDTH}" height="${height}" viewBox="0 0 ${DRAWING_WIDTH} ${height}" data-background="${background}">`,
    `<rect width="${DRAWING_WIDTH}" height="${height}" fill="${LIGHT_COLORS.paper}"/>`,
    patternFor(background),
    background === 'blank' ? '' : `<rect width="${DRAWING_WIDTH}" height="${height}" fill="url(#rules)"/>`,
    ...ordered.map(pathFor),
    '</svg>',
  ];
  return `${lines.filter(Boolean).join('\n')}\n`;
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

/** An element's attributes, in single or double quotes, with the basic entities decoded. */
function attributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1]] = (m[2] ?? m[3]).replace(/&(amp|quot|apos|lt|gt);/g, (_, e: string) => ENTITIES[e]);
  }
  return out;
}

const oneOf = <T extends string>(value: unknown, values: readonly T[]): T | undefined => values.find((v) => v === value);

/**
 * A drawing read from its SVG file: the height from the viewBox, the background, and a stroke for every path
 * with data-points. Paths without points, like a background, are left out. Null when the text isn't an SVG.
 */
export function drawingFromSvg(text: string): { height: number; background: Background; strokes: Stroke[] } | null {
  const root = /<svg\b([^>]*)>/i.exec(text);
  if (!root) return null;
  const rootAttrs = attributes(root[1]);
  const box = (rootAttrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  const height = box.length === 4 && box[3] > 0 ? box[3] : Number(rootAttrs.height) > 0 ? Number(rootAttrs.height) : NEW_HEIGHT;
  const strokes: Stroke[] = [];
  for (const m of text.matchAll(/<path\b([^>]*?)\/?>/gi)) {
    const a = attributes(m[1]);
    if (a['data-points'] === undefined) continue;
    const points = decodePoints(a['data-points']);
    if (points.length === 0) continue;
    const tool = oneOf(a['data-tool'], PEN_TOOLS) ?? 'pen';
    const size = Number(a['data-size']);
    strokes.push({
      id: uid(),
      tool,
      color: oneOf(a['data-color'], INK_COLORS) ?? 'ink',
      size: size > 0 ? size : SIZES[tool][1],
      pressure: a['data-pressure'] !== 'false',
      points,
    });
  }
  return { height, background: oneOf(rootAttrs['data-background'], BACKGROUNDS) ?? 'blank', strokes };
}
