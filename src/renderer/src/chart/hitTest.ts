/** Where a mark sits on screen, in chart pixels, for working out what the pointer is over. */
export type MarkShape =
  | { id: string; kind: 'band'; y: number; half: number }
  | { id: string; kind: 'segment'; x1: number; y1: number; x2: number; y2: number; half: number }
  | { id: string; kind: 'box'; x: number; y: number; w: number; h: number };

/** Extra reach around each mark, so thin lines are easy to point at. */
const TOLERANCE = 4;

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Smaller marks sit on top of bigger ones: text labels, then trend lines, then levels.
const PRIORITY: Record<MarkShape['kind'], number> = { box: 0, segment: 1, band: 2 };

/** The mark under the pointer, or null. Ties go to the nearest mark. */
export function hitTestShapes(shapes: MarkShape[], x: number, y: number): string | null {
  let best: { id: string; priority: number; distance: number } | null = null;
  for (const s of shapes) {
    let distance: number;
    if (s.kind === 'box') {
      const inside = x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
      if (!inside) continue;
      distance = 0;
    } else {
      distance = s.kind === 'band' ? Math.abs(y - s.y) : distanceToSegment(x, y, s.x1, s.y1, s.x2, s.y2);
      if (distance > s.half + TOLERANCE) continue;
    }
    const priority = PRIORITY[s.kind];
    if (!best || priority < best.priority || (priority === best.priority && distance < best.distance)) {
      best = { id: s.id, priority, distance };
    }
  }
  return best?.id ?? null;
}
