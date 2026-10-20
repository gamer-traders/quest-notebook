import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Interval } from '../types';

export const INTERVALS: Interval[] = ['15m', '1h', '4h', '1d', '1w'];

export const INTERVAL_SEC: Record<Interval, number> = {
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
};

export const INTERVAL_LABEL: Record<Interval, string> = {
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1D',
  '1w': '1W',
};

export const POPULAR_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'PAXGUSDT',
];

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarSet {
  /** Candles up to and including the frozen moment. */
  past: Bar[];
  /** Candles after the frozen moment that exist so far. */
  future: Bar[];
  source: 'binance' | 'demo' | 'custom';
}

/** Binance rejected the symbol, so falling back to demo prices would hide a typo. */
export class SymbolError extends Error {}

const HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const PAST_LIMIT = 400;
const FUTURE_LIMIT = 200;

async function fetchKlines(query: string): Promise<Bar[]> {
  let lastError: unknown = new Error('No price source answered');
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/api/v3/klines?${query}`);
      if (res.status === 400) {
        const body = await res.json().catch(() => null);
        throw new SymbolError(body?.msg ?? 'Invalid symbol');
      }
      if (!res.ok) throw new Error(`Binance answered ${res.status}`);
      const rows: unknown[][] = await res.json();
      return rows.map((r) => ({
        time: Number(r[0]) / 1000,
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }));
    } catch (err) {
      if (err instanceof SymbolError) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A believable random walk, used when Binance can't be reached. */
function demoBars(symbol: string, interval: Interval, asOf: number): BarSet {
  const iv = INTERVAL_SEC[interval];
  const rand = mulberry32(hash(`${symbol}|${interval}|${asOf}`));
  const start = Math.floor(asOf / iv) * iv - (PAST_LIMIT - 1) * iv;
  const now = Date.now() / 1000;
  const vol = 0.012 * Math.sqrt(iv / 3600) * 0.35;
  let price = 20 + (hash(symbol) % 4000);
  let drift = 0;
  const past: Bar[] = [];
  const future: Bar[] = [];
  for (let i = 0; i < PAST_LIMIT + FUTURE_LIMIT; i++) {
    const time = start + i * iv;
    if (time > now) break;
    if (i % 40 === 0) drift = (rand() - 0.5) * vol * 0.6;
    const open = price;
    const close = open * (1 + drift + (rand() - 0.5) * vol * 2);
    const high = Math.max(open, close) * (1 + rand() * vol);
    const low = Math.min(open, close) * (1 - rand() * vol);
    const volume = 500 + rand() * 1500 * (1 + Math.abs(close - open) / open / vol);
    price = close;
    const bar = { time, open, high, low, close, volume };
    (time <= asOf ? past : future).push(bar);
  }
  return { past, future, source: 'demo' };
}

const pending = new Map<string, Promise<BarSet>>();
const resolved = new Map<string, BarSet>();

let version = 0;
const subscribers = new Set<() => void>();
function bump() {
  version++;
  subscribers.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export const barsKey = (symbol: string, interval: Interval, asOf: number) => `${symbol}|${interval}|${asOf}`;

export function loadBars(symbol: string, interval: Interval, asOf: number): Promise<BarSet> {
  const key = barsKey(symbol, interval, asOf);
  const existing = pending.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<BarSet> => {
    const end = asOf * 1000;
    const sym = encodeURIComponent(symbol);
    try {
      const [past, future] = await Promise.all([
        fetchKlines(`symbol=${sym}&interval=${interval}&endTime=${end}&limit=${PAST_LIMIT}`),
        end < Date.now()
          ? fetchKlines(`symbol=${sym}&interval=${interval}&startTime=${end + 1}&limit=${FUTURE_LIMIT}`)
          : Promise.resolve([]),
      ]);
      return { past, future, source: 'binance' };
    } catch (err) {
      if (err instanceof SymbolError) throw err;
      return demoBars(symbol, interval, asOf);
    }
  })();

  pending.set(key, promise);
  promise.then(
    (data) => resolved.set(key, data),
    () => pending.delete(key),
  );
  return promise;
}

/** Drop cached candles and fetch again, so a chart frozen earlier picks up candles that formed since. */
export async function refreshBars(symbol: string, interval: Interval, asOf: number) {
  const key = barsKey(symbol, interval, asOf);
  pending.delete(key);
  resolved.delete(key);
  try {
    await loadBars(symbol, interval, asOf);
  } finally {
    bump();
  }
}

export interface BarsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data?: BarSet;
  error?: string;
}

export interface BarsSpec {
  symbol: string;
  interval: Interval;
  asOf: number;
}

/** Candles for a chart cell. Pass null when there is no chart to load. */
export function useBars(spec: BarsSpec | null): BarsState {
  const key = spec ? barsKey(spec.symbol, spec.interval, spec.asOf) : null;
  const ver = useSyncExternalStore(subscribe, () => version);
  const [state, setState] = useState<BarsState & { key: string | null }>(() => {
    const data = key ? resolved.get(key) : undefined;
    return data ? { key, status: 'ready', data } : { key, status: key ? 'loading' : 'idle' };
  });

  useEffect(() => {
    if (!spec || !key) {
      setState({ key, status: 'idle' });
      return;
    }
    const cached = resolved.get(key);
    if (cached) {
      setState({ key, status: 'ready', data: cached });
      return;
    }
    let alive = true;
    setState({ key, status: 'loading' });
    loadBars(spec.symbol, spec.interval, spec.asOf).then(
      (data) => alive && setState({ key, status: 'ready', data }),
      (err) => alive && setState({ key, status: 'error', error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      alive = false;
    };
    // The key describes the spec fully.
  }, [key, ver]);

  if (state.key === key) return state;
  const data = key ? resolved.get(key) : undefined;
  return data ? { status: 'ready', data } : { status: key ? 'loading' : 'idle' };
}

/** Load several charts' candles at once, for the review page. */
export function useManyBars(specs: BarsSpec[]): Map<string, BarsState> {
  const ver = useSyncExternalStore(subscribe, () => version);
  const keys = specs.map((s) => barsKey(s.symbol, s.interval, s.asOf));
  const joined = keys.join(',');
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    specs.forEach((s) => {
      const key = barsKey(s.symbol, s.interval, s.asOf);
      if (resolved.has(key)) return;
      loadBars(s.symbol, s.interval, s.asOf).then(
        () => alive && setTick((t) => t + 1),
        () => alive && setTick((t) => t + 1),
      );
    });
    return () => {
      alive = false;
    };
    // specs is rebuilt every render; the joined keys describe it fully.
  }, [joined, ver]);

  const out = new Map<string, BarsState>();
  keys.forEach((key) => {
    const data = resolved.get(key);
    out.set(key, data ? { status: 'ready', data } : { status: pending.has(key) ? 'loading' : 'error' });
  });
  return out;
}
