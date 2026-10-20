import type { ITimeScaleApi, Logical, Time } from 'lightweight-charts';
import type { Bar } from '../lib/market';

/**
 * Map a moment to a fractional bar index. Times past either end are extrapolated at the
 * candle interval, so drawings can reach into the empty space beyond the last candle.
 */
export function timeToLogical(bars: Bar[], time: number, iv: number): number | null {
  const n = bars.length;
  if (n === 0) return null;
  if (time <= bars[0].time) return (time - bars[0].time) / iv;
  if (time >= bars[n - 1].time) return n - 1 + (time - bars[n - 1].time) / iv;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= time) lo = mid;
    else hi = mid;
  }
  return lo + (time - bars[lo].time) / (bars[hi].time - bars[lo].time);
}

export function logicalToTime(bars: Bar[], logical: number, iv: number): number | null {
  const n = bars.length;
  if (n === 0) return null;
  if (logical <= 0) return Math.round(bars[0].time + logical * iv);
  if (logical >= n - 1) return Math.round(bars[n - 1].time + (logical - (n - 1)) * iv);
  const lo = Math.floor(logical);
  return Math.round(bars[lo].time + (logical - lo) * (bars[lo + 1].time - bars[lo].time));
}

/** The library only maps whole bar indexes to pixels, so interpolate between neighbours. */
export function logicalToX(ts: ITimeScaleApi<Time>, logical: number): number | null {
  const i = Math.floor(logical);
  const x0 = ts.logicalToCoordinate(i as Logical);
  if (x0 === null) return null;
  const frac = logical - i;
  if (frac === 0) return x0;
  const x1 = ts.logicalToCoordinate((i + 1) as Logical);
  return x1 === null ? x0 : x0 + (x1 - x0) * frac;
}
