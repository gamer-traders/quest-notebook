import { create } from 'zustand';
import { BACKGROUNDS, INK_COLORS, TOOLS, type Background, type InkColor, type Tool } from './model';

/** The pen in hand: kept between drawings and launches, like the app's look. */
export interface PenSettings {
  tool: Tool;
  /** Small, medium or large, for whichever tool. */
  size: 0 | 1 | 2;
  color: InkColor;
  /** The background a new drawing starts with. */
  background: Background;
}

export const DEFAULT_PEN: PenSettings = { tool: 'pen', size: 1, color: 'ink', background: 'blank' };

const KEY = 'quest-notebook-pen';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const pick = <T,>(values: readonly T[], value: unknown, fallback: T): T => values.find((v) => v === value) ?? fallback;

export function readPen(storage: Pick<Storage, 'getItem'> | null): PenSettings {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? 'null') as Partial<Record<keyof PenSettings, unknown>> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_PEN;
    return {
      tool: pick(TOOLS, raw.tool, DEFAULT_PEN.tool),
      size: pick([0, 1, 2] as const, raw.size, DEFAULT_PEN.size),
      color: pick(INK_COLORS, raw.color, DEFAULT_PEN.color),
      background: pick(BACKGROUNDS, raw.background, DEFAULT_PEN.background),
    };
  } catch {
    return DEFAULT_PEN;
  }
}

export function writePen(storage: Store | null, pen: PenSettings): void {
  try {
    storage?.setItem(KEY, JSON.stringify(pen));
  } catch {
    // Not remembered this time; the pen still works.
  }
}

const browserStorage = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** The pen, shared by every drawing on screen. */
export const usePen = create<PenSettings & { setPen: (patch: Partial<PenSettings>) => void }>((set, get) => ({
  ...readPen(browserStorage()),
  setPen: (patch) => {
    set(patch);
    const { tool, size, color, background } = get();
    writePen(browserStorage(), { tool, size, color, background });
  },
}));
