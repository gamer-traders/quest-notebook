import type { Bar } from './lib/market';
import type { PageBlock } from './page/blockTypes';
import type { Background, Stroke } from './drawing/model';

export type Interval = '15m' | '1h' | '4h' | '1d' | '1w';

export type MarkColor = 'yellow' | 'blue' | 'green' | 'red' | 'purple' | 'gray';
export type MarkLine = 'solid' | 'dashed' | 'dotted';
export type MarkWidth = 'thin' | 'normal' | 'thick';

/** How a line looks, and what you wrote about it. Marks saved before these existed are yellow, solid and normal. */
export interface MarkLook {
  color?: MarkColor;
  line?: MarkLine;
  width?: MarkWidth;
  note?: string;
}

export interface Level extends MarkLook {
  id: string;
  price: number;
}

export interface TrendPoint {
  /** Unix seconds. */
  time: number;
  price: number;
}

export interface Trend extends MarkLook {
  id: string;
  a: TrendPoint;
  b: TrendPoint;
}

export interface Pin {
  id: string;
  /** Open time of the candle the note is pinned to, unix seconds. */
  time: number;
  text: string;
  color?: MarkColor;
}

/** Words written straight onto the chart, anchored at a moment and a price. */
export interface TextLabel {
  id: string;
  time: number;
  price: number;
  text: string;
  color?: MarkColor;
}

export interface ChartCell {
  id: string;
  type: 'chart';
  symbol: string;
  interval: Interval;
  /** The moment the chart is frozen at, unix seconds. Candles after it stay hidden until revealed. */
  asOf: number;
  revealed: boolean;
  /** Practice charts hide the dates so you can't lean on memory. */
  practice: boolean;
  levels: Level[];
  trends: Trend[];
  pins: Pin[];
  texts?: TextLabel[];
  /** Where the candles come from. Charts saved before you could add your own data have none, meaning Binance. */
  source?: 'binance' | 'custom';
  /** Your name for a chart of your own data. */
  name?: string;
  /** Your own candles, when the source is 'custom'. */
  candles?: Bar[];
  /** Pasted candles keep their real dates; typed and drawn ones are just numbered. */
  dated?: boolean;
}

export interface PlanCell {
  id: string;
  type: 'plan';
  side: 'long' | 'short';
  entry: number | null;
  stop: number | null;
  target: number | null;
  reason: string;
}

export interface CallCell {
  id: string;
  type: 'call';
  direction: 'up' | 'down';
  /** How many candles after the frozen moment the call is checked on. */
  bars: number;
  reason: string;
}

/** Handwriting and sketches: ink strokes on a canvas 1000 units wide that grows downward. */
export interface DrawingCell {
  id: string;
  type: 'drawing';
  height: number;
  background: Background;
  strokes: Stroke[];
}

/** Data behind an item block (chart, trade plan, prediction or drawing) on a page. */
export type ItemData = ChartCell | PlanCell | CallCell | DrawingCell;

/** One of the owner's own top-level groups of pages. */
export interface Space {
  id: string;
  name: string;
}

/** A notebook written as one page: editor blocks, plus the data its item blocks point at. */
export interface Notebook {
  id: string;
  title: string;
  spaceId: string;
  /** The page this one sits under, or null at the top of its space. */
  parentId: string | null;
  /** Order among its siblings. */
  position: number;
  /** Local date (YYYY-MM-DD) of a journal page. */
  journalDate?: string;
  createdAt: number;
  updatedAt: number;
  blocks: PageBlock[];
  items: Record<string, ItemData>;
  /** Where the page's file is, relative to the workspace folder. */
  path?: string;
  /** Why the page's file couldn't be read. Such a page is shown, never saved. */
  loadError?: string;
}
