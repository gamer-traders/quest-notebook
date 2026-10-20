import type { Interval } from '../types';

export function pricePrecision(price: number): number {
  const p = Math.abs(price);
  if (p >= 10000) return 0;
  if (p >= 100) return 2;
  if (p >= 1) return 3;
  if (p >= 0.01) return 5;
  return 8;
}

export function formatPrice(price: number | null | undefined, precision?: number): string {
  if (price === null || price === undefined || Number.isNaN(price)) return '–';
  const digits = precision ?? pricePrecision(price);
  return price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function formatPct(fraction: number): string {
  const sign = fraction > 0 ? '+' : fraction < 0 ? '−' : '';
  return `${sign}${Math.abs(fraction * 100).toFixed(1)}%`;
}

export function formatR(r: number): string {
  const sign = r > 0 ? '+' : r < 0 ? '−' : '';
  return `${sign}${Math.abs(r).toFixed(1)}R`;
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

/** Dates follow the candles, which Binance stamps in UTC. */
export function formatMoment(sec: number, interval?: Interval): string {
  const d = new Date(sec * 1000);
  const day = dayFmt.format(d);
  if (interval === '1d' || interval === '1w') return day;
  return `${day}, ${timeFmt.format(d)} UTC`;
}

export function formatDay(sec: number): string {
  return dayFmt.format(new Date(sec * 1000));
}

const localDayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Journals are named after your own calendar day, not the UTC one. */
export const todayLabel = () => localDayFmt.format(new Date());

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Your own calendar day as YYYY-MM-DD, which marks a journal page as that day's. */
export function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatWait(seconds: number): string {
  if (seconds <= 0) return 'any moment now';
  const h = seconds / 3600;
  if (h < 1) return `in ${Math.ceil(seconds / 60)} min`;
  if (h < 48) return `in ${Math.ceil(h)} h`;
  return `in ${Math.ceil(h / 24)} days`;
}

const TAG_RE = /(^|[^\w&])#([a-z0-9][\w-]*)/gi;

export function extractTags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TAG_RE)) out.add(m[2].toLowerCase());
  return [...out];
}

/** Where each #tag sits in the text, '#' included, by the same rule as extractTags. */
export function tagRanges(text: string): { from: number; to: number }[] {
  return [...text.matchAll(TAG_RE)].map((m) => {
    const from = m.index + m[1].length;
    return { from, to: from + 1 + m[2].length };
  });
}
