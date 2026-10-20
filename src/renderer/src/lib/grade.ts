import type { CallCell, Interval, PlanCell } from '../types';
import { INTERVAL_SEC, type Bar, type BarSet } from './market';

export interface PlanMath {
  risk: number;
  reward: number;
  rr: number;
}

export function planProblem(plan: PlanCell): string | null {
  const { side, entry, stop, target } = plan;
  if (entry === null || stop === null || target === null) return 'Fill in entry, stop and target.';
  if (side === 'long' && !(stop < entry && entry < target)) return 'For a long, the stop goes below the entry and the target above it.';
  if (side === 'short' && !(target < entry && entry < stop)) return 'For a short, the stop goes above the entry and the target below it.';
  return null;
}

export function planMath(plan: PlanCell): PlanMath | null {
  if (planProblem(plan)) return null;
  const entry = plan.entry!;
  const risk = Math.abs(entry - plan.stop!);
  const reward = Math.abs(plan.target! - entry);
  return { risk, reward, rr: reward / risk };
}

export type PlanResult =
  | { kind: 'not-filled'; checked: number }
  | { kind: 'open'; filledAt: number; r: number; lastPrice: number }
  | { kind: 'target' | 'stop'; filledAt: number; exitAt: number; r: number };

/**
 * Walk the candles after the frozen moment. An entry above the last price fills when price
 * rises to it (a breakout); an entry below fills when price dips to it. If stop and target are
 * both inside one candle we can't tell which came first, so we assume the stop.
 */
export function gradePlan(plan: PlanCell, bars: BarSet): PlanResult | null {
  const math = planMath(plan);
  const last = bars.past.at(-1);
  if (!math || !last) return null;
  const entry = plan.entry!;
  const stop = plan.stop!;
  const target = plan.target!;
  const long = plan.side === 'long';
  const waitsForRise = entry > last.close;

  let filledAt: number | null = null;
  for (const bar of bars.future) {
    if (filledAt === null) {
      const fills = waitsForRise ? bar.high >= entry : bar.low <= entry;
      if (!fills) continue;
      filledAt = bar.time;
    }
    const stopHit = long ? bar.low <= stop : bar.high >= stop;
    const targetHit = long ? bar.high >= target : bar.low <= target;
    if (stopHit) return { kind: 'stop', filledAt, exitAt: bar.time, r: -1 };
    if (targetHit) return { kind: 'target', filledAt, exitAt: bar.time, r: math.rr };
  }
  if (filledAt === null) return { kind: 'not-filled', checked: bars.future.length };
  const lastPrice = bars.future.at(-1)!.close;
  const r = ((long ? lastPrice - entry : entry - lastPrice) / math.risk);
  return { kind: 'open', filledAt, r, lastPrice };
}

export type CallResult =
  | { kind: 'waiting'; seen: number; checkAt: number }
  | { kind: 'right' | 'wrong'; change: number; at: number; from: number; to: number };

export function gradeCall(call: CallCell, bars: BarSet, interval: Interval): CallResult | null {
  const base = bars.past.at(-1);
  if (!base) return null;
  const n = Math.max(1, Math.round(call.bars));
  const iv = INTERVAL_SEC[interval];
  // A candle that is still forming can change, so only closed candles count.
  const now = Date.now() / 1000;
  const closed = bars.future.filter((b) => b.time + iv <= now);
  if (closed.length < n) {
    const lastSeen: Bar = closed.at(-1) ?? base;
    return { kind: 'waiting', seen: closed.length, checkAt: lastSeen.time + iv * (n - closed.length + 1) };
  }
  const bar = closed[n - 1];
  const change = (bar.close - base.close) / base.close;
  const right = call.direction === 'up' ? change > 0 : change < 0;
  return { kind: right ? 'right' : 'wrong', change, at: bar.time, from: base.close, to: bar.close };
}
