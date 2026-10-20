import type { Interval } from '../types';
import { INTERVALS, INTERVAL_SEC, type Bar, type BarSet } from './market';

/** Notebooks live in browser storage, which holds a few megabytes. */
export const CANDLE_LIMIT = 5000;

/**
 * Candles you type or draw have no real dates, but the chart needs timestamps, so they get one
 * per day from an arbitrary start. The app shows candle numbers instead of these dates.
 */
export const NUMBERED_START = Date.UTC(2000, 0, 3) / 1000;

export const numberedTime = (index: number) => NUMBERED_START + index * 86400;
export const candleNumber = (time: number) => Math.round((time - NUMBERED_START) / 86400) + 1;

export interface ParsedCandles {
  candles: Bar[];
  dated: boolean;
  interval: Interval;
  /** 1-based line numbers that couldn't be read. */
  skipped: number[];
  truncated: boolean;
}

function splitRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

function toNumber(cell: string | undefined): number {
  if (cell === undefined) return NaN;
  const clean = cell.replace(/[,\s]/g, '');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(clean) ? Number(clean) : NaN;
}

function toTime(cell: string | undefined): number | null {
  if (!cell) return null;
  const s = cell.trim();
  if (/^\d{9,10}(\.\d+)?$/.test(s)) return Math.floor(Number(s));
  if (/^\d{12,13}$/.test(s)) return Math.floor(Number(s) / 1000);
  // ISO dates and date-times without a zone are read as UTC, like the exchange data.
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (iso) {
    const [, y, mo, d, h = '0', mi = '0', sec = '0'] = iso;
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s) && s.length > 10;
    if (hasZone) {
      const ms = Date.parse(s.replace(' ', 'T'));
      return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
    }
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec) / 1000;
  }
  if (!/[a-z/\-.]/i.test(s)) return null;
  const local = new Date(s);
  if (Number.isNaN(local.getTime())) return null;
  return Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes()) / 1000;
}

interface Columns {
  time: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

function columnsFromHeader(header: string[]): Columns | null {
  const names = header.map((h) => h.toLowerCase().replace(/[^a-z ]/g, '').trim());
  const find = (test: (n: string) => boolean) => {
    const i = names.findIndex(test);
    return i >= 0 ? i : null;
  };
  const time = find((n) => /^(date|time|datetime|timestamp|day)/.test(n));
  const open = find((n) => n.startsWith('open'));
  const high = find((n) => n.startsWith('high'));
  const low = find((n) => n.startsWith('low'));
  const close = find((n) => n === 'close') ?? find((n) => (n.includes('close') && !n.includes('adj')) || n === 'last' || n === 'price');
  const volume = find((n) => n.startsWith('vol'));
  if (open === null || high === null || low === null || close === null) return null;
  return { time, open, high, low, close, volume };
}

function columnsByPosition(firstRow: string[]): Columns | null {
  if (firstRow.length >= 5 && toTime(firstRow[0]) !== null) {
    return { time: 0, open: 1, high: 2, low: 3, close: 4, volume: firstRow.length > 5 ? 5 : null };
  }
  if (firstRow.length >= 4) return { time: null, open: 0, high: 1, low: 2, close: 3, volume: firstRow.length > 4 ? 4 : null };
  return null;
}

/** The candle size closest to the typical gap, so overnight and weekend gaps don't skew it. */
function detectInterval(candles: Bar[]): Interval {
  if (candles.length < 2) return '1d';
  const gaps = candles.slice(1).map((c, i) => c.time - candles[i].time).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  let best: Interval = '1d';
  let bestDistance = Infinity;
  for (const iv of INTERVALS) {
    const distance = Math.abs(Math.log(median / INTERVAL_SEC[iv]));
    if (distance < bestDistance) {
      best = iv;
      bestDistance = distance;
    }
  }
  return best;
}

/** Read candles pasted from a spreadsheet or a CSV download (Yahoo Finance, TradingView, or plain rows). */
export function parseCandles(text: string): ParsedCandles {
  const lines = text.split(/\r?\n/);
  const firstLine = lines.find((l) => l.trim() !== '') ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';

  let columns: Columns | null = null;
  const skipped: number[] = [];
  const rows: { time: number | null; bar: Omit<Bar, 'time'> }[] = [];

  lines.forEach((line, i) => {
    if (line.trim() === '') return;
    const cells = splitRow(line, delimiter);
    if (!columns) {
      const looksLikeHeader = cells.some((c) => Number.isNaN(toNumber(c)) && toTime(c) === null);
      columns = looksLikeHeader ? columnsFromHeader(cells) : columnsByPosition(cells);
      if (looksLikeHeader) return;
      if (!columns) {
        skipped.push(i + 1);
        return;
      }
    }
    const c: Columns = columns;
    const time = c.time === null ? null : toTime(cells[c.time]);
    const open = toNumber(cells[c.open]);
    const high = toNumber(cells[c.high]);
    const low = toNumber(cells[c.low]);
    const close = toNumber(cells[c.close]);
    const volume = c.volume === null ? 0 : toNumber(cells[c.volume]);
    if ((c.time !== null && time === null) || ![open, high, low, close].every(Number.isFinite)) {
      skipped.push(i + 1);
      return;
    }
    rows.push({ time, bar: { open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 } });
  });

  // TypeScript can't see the assignment inside forEach, so restate the type.
  const found = columns as Columns | null;
  const dated = found !== null && found.time !== null;
  let candles: Bar[];
  if (dated) {
    const byTime = new Map<number, Bar>();
    for (const r of rows) byTime.set(r.time!, { time: r.time!, ...r.bar });
    candles = [...byTime.values()].sort((a, b) => a.time - b.time);
  } else {
    candles = rows.map((r, i) => ({ time: i, ...r.bar }));
  }

  const truncated = candles.length > CANDLE_LIMIT;
  if (truncated) candles = candles.slice(-CANDLE_LIMIT);
  if (!dated) candles = candles.map((c, i) => ({ ...c, time: numberedTime(i) }));

  return { candles, dated, interval: dated ? detectInterval(candles) : '1d', skipped, truncated };
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DrawOptions {
  count: number;
  low: number;
  high: number;
  seed?: number;
}

/**
 * Turn a stroke drawn across a box into candles that follow it. Points are 0–1 across and
 * down (0 is the top, the high price). Each candle opens and closes on the stroke, and its
 * wicks reach any peak or dip the stroke makes inside it, plus a little random noise.
 */
export function drawToCandles(path: { x: number; y: number }[], opts: DrawOptions): Bar[] {
  const pts = path
    .map((p) => ({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }))
    .sort((a, b) => a.x - b.x);
  if (pts.length === 0 || opts.count < 1) return [];

  const range = opts.high - opts.low;
  const decimals = Math.max(2, 4 - Math.floor(Math.log10(Math.abs(range) || 1)));
  const round = (v: number) => Number(v.toFixed(decimals));
  const priceOf = (y: number) => opts.high - y * range;
  const yAt = (x: number) => {
    if (x <= pts[0].x) return pts[0].y;
    const last = pts[pts.length - 1];
    if (x >= last.x) return last.y;
    let i = 1;
    while (pts[i].x < x) i++;
    const a = pts[i - 1];
    const b = pts[i];
    return b.x === a.x ? b.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
  };

  const rand = mulberry32(opts.seed ?? 7);
  const candles: Bar[] = [];
  for (let i = 0; i < opts.count; i++) {
    const x0 = i / opts.count;
    const x1 = (i + 1) / opts.count;
    const open = round(priceOf(yAt(x0)));
    const close = round(priceOf(yAt(x1)));
    const inside = pts.filter((p) => p.x > x0 && p.x < x1).map((p) => priceOf(p.y));
    const top = Math.max(open, close, ...inside);
    const bottom = Math.min(open, close, ...inside);
    const high = round(top + rand() * Math.abs(range) * 0.015);
    const low = round(bottom - rand() * Math.abs(range) * 0.015);
    const volume = Math.round(400 + rand() * 600 + (Math.abs(close - open) / (Math.abs(range) || 1)) * 8000);
    candles.push({ time: numberedTime(i), open, high, low, close, volume });
  }
  return candles;
}

/** Split your own candles at the frozen moment, the same shape Binance charts use. */
export function customBarSet(candles: Bar[], asOf: number): BarSet {
  return {
    past: candles.filter((c) => c.time <= asOf),
    future: candles.filter((c) => c.time > asOf),
    source: 'custom',
  };
}
