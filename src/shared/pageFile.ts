/*
  A page as it is saved on disk: one JSON file per page, written for people and AI to read.
  The workspace README (shared/readme.ts) explains the same format in words.
*/

/** ISO 8601, UTC, e.g. "2024-10-28T00:00:00Z". */
export type IsoTime = string;

export type MarkColor = 'yellow' | 'blue' | 'green' | 'red' | 'purple' | 'gray';

export interface FileLook {
  color?: MarkColor;
  line?: 'solid' | 'dashed' | 'dotted';
  width?: 'thin' | 'normal' | 'thick';
  note?: string;
}

export interface FilePoint {
  time: IsoTime;
  price: number;
}

export interface FileCandle {
  time: IsoTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface WithChildren {
  children?: FileBlock[];
}

export interface FileTextBlock extends WithChildren {
  type: 'paragraph' | 'quote' | 'callout' | 'bullet';
  text: string;
}

export interface FileHeading extends WithChildren {
  type: 'heading';
  level: 1 | 2 | 3;
  text: string;
}

export interface FileNumbered extends WithChildren {
  type: 'numbered';
  text: string;
  start?: number;
}

export interface FileChecklist extends WithChildren {
  type: 'checklist';
  checked: boolean;
  text: string;
}

export interface FileDivider extends WithChildren {
  type: 'divider';
}

export interface FileCode extends WithChildren {
  type: 'code';
  language: string;
  code: string;
}

export interface FileChart extends WithChildren {
  type: 'chart';
  id: string;
  source: 'binance' | 'custom';
  symbol: string;
  interval: '15m' | '1h' | '4h' | '1d' | '1w';
  /** The moment the chart is frozen at. Candles after it stay hidden until revealed. */
  frozenAt: IsoTime;
  revealed: boolean;
  /** Practice charts hide their dates. */
  practice: boolean;
  levels: (FileLook & { price: number })[];
  trendLines: (FileLook & { from: FilePoint; to: FilePoint })[];
  pins: { time: IsoTime; text: string; color?: MarkColor }[];
  labels: { time: IsoTime; price: number; text: string; color?: MarkColor }[];
  /** Custom charts only: your name for the data, whether it has real dates, and the candles. */
  name?: string;
  dated?: boolean;
  candles?: FileCandle[];
}

export interface FileTradePlan extends WithChildren {
  type: 'tradePlan';
  id: string;
  side: 'long' | 'short';
  entry: number | null;
  stop: number | null;
  target: number | null;
  reason: string;
}

export interface FilePrediction extends WithChildren {
  type: 'prediction';
  id: string;
  direction: 'up' | 'down';
  /** How many candles after the chart's frozen moment the prediction is checked on. */
  bars: number;
  reason: string;
}

export type FileBlock =
  | FileTextBlock
  | FileHeading
  | FileNumbered
  | FileChecklist
  | FileDivider
  | FileCode
  | FileChart
  | FileTradePlan
  | FilePrediction;

export interface PageFile {
  id: string;
  title: string;
  /** Order among the pages beside it: lower comes first. */
  position: number;
  /** A journal page's day, YYYY-MM-DD. */
  journalDate?: string;
  created: IsoTime;
  updated: IsoTime;
  blocks: FileBlock[];
}
