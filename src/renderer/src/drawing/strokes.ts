import { getStroke, type StrokeOptions } from 'perfect-freehand';
import { GROW_BY, GROW_MARGIN, type PenTool, type Stroke } from './model';

const round = (n: number, places: number) => Number(n.toFixed(places));

/** Points as a page file keeps them: "x,y,pressure" triples, short enough that a stroke stays on one line. */
export function encodePoints(points: number[]): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 3) {
    out.push(`${round(points[i], 1)},${round(points[i + 1], 1)},${round(points[i + 2] ?? 0.5, 2)}`);
  }
  return out.join(' ');
}

/** Points read from a page file. Triples that can't be read are skipped; missing pressure is 0.5. */
export function decodePoints(text: string): number[] {
  const out: number[] = [];
  for (const triple of text.trim().split(/\s+/)) {
    if (!triple) continue;
    const [x, y, p] = triple.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push(x, y, Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.5);
  }
  return out;
}

const THINNING: Record<PenTool, number> = { pen: 0.6, pencil: 0.75, marker: 0.1, highlighter: 0 };

/** How perfect-freehand draws each tool. Pens with real pressure use it; others thin with speed. */
export function strokeOptions(stroke: Pick<Stroke, 'tool' | 'size' | 'pressure'>, last = true): StrokeOptions {
  const flat = stroke.tool === 'highlighter';
  return {
    size: stroke.size,
    thinning: THINNING[stroke.tool],
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: !stroke.pressure && !flat,
    last,
    ...(flat ? { start: { cap: true, taper: false }, end: { cap: true, taper: false } } : {}),
  };
}

const triples = (points: number[]): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i + 1 < points.length; i += 3) out.push([points[i], points[i + 1], points[i + 2] ?? 0.5]);
  return out;
};

// A tenth of a unit is finer than any screen shows the drawing, and keeps pictures small.
const pair = (x: number, y: number) => `${round(x, 1)},${round(y, 1)}`;

/** A stroke as an SVG path: the outline perfect-freehand draws around its points, filled. */
export function strokePath(stroke: Pick<Stroke, 'tool' | 'size' | 'pressure' | 'points'>, last = true): string {
  const outline = getStroke(triples(stroke.points), strokeOptions(stroke, last));
  if (outline.length === 0) return '';
  // Smooth curves through the outline: each point is a control point, ending half way to the next.
  const parts = [`M${pair(outline[0][0], outline[0][1])}`, 'Q'];
  outline.forEach(([x0, y0], i) => {
    const [x1, y1] = outline[(i + 1) % outline.length];
    parts.push(pair(x0, y0), pair((x0 + x1) / 2, (y0 + y1) / 2));
  });
  parts.push('Z');
  return parts.join(' ');
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The strokes the eraser at (x, y) touches: those passing within its radius of their own line. */
export function strokesHit(strokes: Stroke[], x: number, y: number, radius: number): string[] {
  return strokes
    .filter((s) => {
      const reach = radius + s.size / 2;
      const p = s.points;
      if (p.length < 2) return false;
      if (p.length < 6) return Math.hypot(x - p[0], y - p[1]) <= reach;
      for (let i = 0; i + 4 < p.length; i += 3) {
        if (distanceToSegment(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= reach) return true;
      }
      return false;
    })
    .map((s) => s.id);
}

/** The canvas height after a stroke reaching down to `strokeBottom`: grown until the stroke is clear of the bottom edge. */
export function grownHeight(height: number, strokeBottom: number): number {
  let h = height;
  while (strokeBottom > h - GROW_MARGIN) h += GROW_BY;
  return h;
}

/** The lowest point of a stroke, in drawing units, counting its width. */
export function strokeBottom(stroke: Stroke): number {
  let bottom = 0;
  for (let i = 1; i < stroke.points.length; i += 3) bottom = Math.max(bottom, stroke.points[i]);
  return bottom + stroke.size / 2;
}

// A finished stroke never changes, so its outline and its written points are worked out once, and shared by the
// canvas, the picture copy and the page file.
const outlines = new WeakMap<Stroke, string>();
const encoded = new WeakMap<Stroke, string>();

/** A finished stroke's outline path, worked out once. */
export function outlineOf(stroke: Stroke): string {
  let d = outlines.get(stroke);
  if (d === undefined) {
    d = strokePath(stroke);
    outlines.set(stroke, d);
  }
  return d;
}

/** A finished stroke's points as the page file writes them, worked out once. */
export function encodedPoints(stroke: Stroke): string {
  let text = encoded.get(stroke);
  if (text === undefined) {
    text = encodePoints(stroke.points);
    encoded.set(stroke, text);
  }
  return text;
}
