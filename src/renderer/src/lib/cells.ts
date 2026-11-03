import { useMemo } from 'react';
import type { ChartCell, Interval, ItemData } from '../types';
import { NEW_HEIGHT, type Background as DrawingBackground } from '../drawing/model';
import { EMBED_HEIGHT } from '../embed/model';
import { INTERVAL_LABEL, INTERVAL_SEC, useBars, type BarsState } from './market';
import { candleNumber, customBarSet } from './customData';
import { formatMoment } from './format';

export const uid = () => Math.random().toString(36).slice(2, 10);

export const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * A random past moment with enough candles on both sides to practise on.
 * It lands on the last second of a candle, so the frozen candle is complete.
 */
export function randomMoment(interval: Interval): number {
  const iv = INTERVAL_SEC[interval];
  const barsAgo = 60 + Math.floor(Math.random() * 320);
  return Math.floor(nowSec() / iv) * iv - barsAgo * iv + iv - 1;
}

export function newChart(partial: Partial<ChartCell> = {}): ChartCell {
  return {
    id: uid(),
    type: 'chart',
    symbol: 'BTCUSDT',
    interval: '1d',
    asOf: nowSec(),
    revealed: false,
    practice: false,
    levels: [],
    trends: [],
    pins: [],
    ...partial,
  };
}

export function newItem(type: ItemData['type'], chartAbove: ChartCell | null, background: DrawingBackground = 'blank'): ItemData {
  switch (type) {
    case 'chart':
      return newChart(chartAbove ? { symbol: chartAbove.symbol, interval: chartAbove.interval } : {});
    case 'plan':
      return { id: uid(), type: 'plan', side: 'long', entry: null, stop: null, target: null, reason: '' };
    case 'call':
      return { id: uid(), type: 'call', direction: 'up', bars: 10, reason: '' };
    case 'drawing':
      return { id: uid(), type: 'drawing', height: NEW_HEIGHT, background, strokes: [] };
    case 'embed':
      return { id: uid(), type: 'embed', kind: 'html', html: '', url: '', height: EMBED_HEIGHT };
  }
}

/** The words in a chart, plan or prediction that search and tags look at. */
export function itemText(item: ItemData): string {
  switch (item.type) {
    case 'chart':
      return [isCustom(item) ? (item.name ?? '') : item.symbol, ...item.pins.map((p) => p.text), ...(item.texts ?? []).map((t) => t.text)].join(' ');
    case 'plan':
    case 'call':
      return item.reason;
    case 'drawing':
      return '';
    case 'embed':
      return item.kind === 'url' ? item.url : '';
  }
}

export const isCustom = (chart: ChartCell) => chart.source === 'custom';

/** What to call a chart: its symbol, or the name you gave your own data. */
export function chartTitle(chart: ChartCell, withInterval = true): string {
  if (isCustom(chart)) return chart.name?.trim() || 'My chart';
  return withInterval ? `${chart.symbol} ${INTERVAL_LABEL[chart.interval]}` : chart.symbol;
}

/** A candle's moment in words: its date, or its number for candles you typed or drew. */
export function momentLabel(chart: ChartCell, time: number): string {
  if (isCustom(chart) && !chart.dated) return `candle ${candleNumber(time)}`;
  return formatMoment(time, chart.interval);
}

/** Candles for a chart cell, from Binance or from your own data. */
export function useChartBars(chart: ChartCell | null): BarsState {
  const own = chart && isCustom(chart) ? chart : null;
  const remote = useBars(chart && !own ? chart : null);
  const candles = own?.candles;
  const asOf = own?.asOf;
  const local = useMemo(() => (own ? customBarSet(candles ?? [], asOf!) : null), [own !== null, candles, asOf]);
  return local ? { status: 'ready', data: local } : remote;
}
