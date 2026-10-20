import type { MarkColor } from '../types';

export const MARK_COLORS: MarkColor[] = ['yellow', 'blue', 'green', 'red', 'purple', 'gray'];

export interface MarkPaint {
  /** The wide, see-through highlighter stroke. */
  fill: string;
  /** The thin line through the middle, and labels. */
  ink: string;
}

export interface Palette {
  sheet: string;
  grid: string;
  ink: string;
  pencil: string;
  rule: string;
  up: string;
  down: string;
  upSoft: string;
  downSoft: string;
  mark: string;
  markInk: string;
  marks: Record<MarkColor, MarkPaint>;
}

/** Charts draw on canvas, so they read the same CSS tokens the rest of the page uses. */
export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    sheet: v('--sheet'),
    grid: v('--chart-grid'),
    ink: v('--ink'),
    pencil: v('--pencil'),
    rule: v('--rule'),
    up: v('--up'),
    down: v('--down'),
    upSoft: v('--up-soft'),
    downSoft: v('--down-soft'),
    mark: v('--mark'),
    markInk: v('--mark-ink'),
    marks: Object.fromEntries(MARK_COLORS.map((c) => [c, { fill: v(`--mark-${c}`), ink: v(`--mark-${c}-ink`) }])) as Record<MarkColor, MarkPaint>,
  };
}
