import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Interval, Level, MarkColor, Pin, TextLabel, Trend, TrendPoint } from '../types';
import { INTERVAL_SEC, type Bar } from '../lib/market';
import { formatPrice, pricePrecision } from '../lib/format';
import { useStore } from '../store';
import { DrawingsPrimitive } from './DrawingsPrimitive';
import { logicalToTime, logicalToX, timeToLogical } from './coords';
import { readPalette } from './palette';
import { candleNumber } from '../lib/customData';

export type Tool = 'move' | 'level' | 'trend' | 'pin' | 'text';

export interface PlanLine {
  price: number;
  label: string;
  tone: 'entry' | 'stop' | 'target';
}

interface Props {
  /** Candles to draw: the past, plus the future once it's revealed. */
  bars: Bar[];
  pastCount: number;
  /** Shown top left: the symbol, or the name of your own chart. */
  title: string;
  /** Candles you typed or drew have no real dates, so the time axis counts them instead. */
  numbered: boolean;
  interval: Interval;
  revealed: boolean;
  hideDates: boolean;
  levels: Level[];
  trends: Trend[];
  pins: Pin[];
  texts: TextLabel[];
  /** The mark being edited, drawn with handles. */
  selectedId: string | null;
  /** Describes a candle's moment for tooltips, without giving away hidden dates. */
  timeLabel: (time: number) => string;
  planLines: PlanLine[];
  extraMarkers: SeriesMarker<Time>[];
  tool: Tool;
  onLevel: (price: number) => void;
  onTrend: (a: TrendPoint, b: TrendPoint) => void;
  onPin: (time: number) => void;
  onText: (at: TrendPoint) => void;
  /** Clicking a mark with the Move tool selects it; clicking empty chart clears the selection. */
  onSelect: (id: string | null) => void;
  /** Shown over the empty space after the frozen moment. */
  curtain: ReactNode;
}

/** Candles shown before the frozen moment, and the share of the chart left blank after it. */
const PAST_IN_VIEW = 100;
const CURTAIN_SHARE = 0.32;
const CURTAIN_BARS = Math.round((PAST_IN_VIEW * CURTAIN_SHARE) / (1 - CURTAIN_SHARE));

export function ChartView(props: Props) {
  const { bars, pastCount, interval, revealed, hideDates, levels, trends, pins, texts, selectedId, planLines, extraMarkers, tool } = props;
  const theme = useStore((s) => s.theme);
  const iv = INTERVAL_SEC[interval];

  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const curtainRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const drawingsRef = useRef<DrawingsPrimitive | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  // Chart callbacks are registered once, so they read the latest props through refs.
  const live = useRef({ props, bars, pastCount, iv });
  live.current = { props, bars, pastCount, iv };

  const [draft, setDraft] = useState<TrendPoint | null>(null);
  const [hover, setHover] = useState<TrendPoint | null>(null);
  const draftRef = useRef<TrendPoint | null>(null);
  draftRef.current = draft;
  // The mark under the pointer, for its tooltip and a stronger highlight.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredRef = useRef<string | null>(null);

  useEffect(() => {
    if (tool !== 'trend') {
      setDraft(null);
      setHover(null);
    }
  }, [tool]);

  const placeCurtain = () => {
    const chart = chartRef.current;
    const el = curtainRef.current;
    if (!chart || !el) return;
    const { pastCount: n } = live.current;
    const ts = chart.timeScale();
    const x = n > 0 ? logicalToX(ts, n - 0.5) : 0;
    // The pane, not the time axis: practice charts hide the axis, and a hidden axis measures 0.
    const pane = chart.paneSize();
    const paneWidth = pane.width;
    if (x === null || x >= paneWidth) {
      el.style.display = 'none';
      return;
    }
    const left = Math.max(0, x);
    el.style.display = '';
    el.style.left = `${left}px`;
    el.style.width = `${paneWidth - left}px`;
    el.style.height = `${pane.height}px`;
  };

  const writeLegend = (bar: Bar | undefined) => {
    const el = legendRef.current;
    if (!el) return;
    const { props: p } = live.current;
    const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const size = p.numbered ? '' : `<span>${p.interval === '1d' ? '1D' : p.interval === '1w' ? '1W' : p.interval}</span>`;
    const head = `<strong>${esc(p.title)}</strong>${size}`;
    if (!bar) {
      el.innerHTML = head;
      return;
    }
    const tone = bar.close >= bar.open ? 'up' : 'down';
    const v = (label: string, value: number) => `<span>${label}<b class="${tone}">${formatPrice(value)}</b></span>`;
    el.innerHTML = head + v('O', bar.open) + v('H', bar.high) + v('L', bar.low) + v('C', bar.close);
  };

  // Create the chart once.
  useLayoutEffect(() => {
    const host = hostRef.current!;
    // Size the chart up front, so the first view window is laid out at the real width.
    const chart = createChart(host, {
      width: host.clientWidth,
      height: host.clientHeight,
      layout: { fontFamily: '"Instrument Sans", system-ui, sans-serif', fontSize: 11, attributionLogo: false },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, rightOffset: CURTAIN_BARS },
      handleScroll: { mouseWheel: false },
      handleScale: { mouseWheel: false },
    });
    if (live.current.props.numbered) {
      chart.applyOptions({
        localization: { timeFormatter: (t: Time) => `Candle ${candleNumber(t as number)}` },
        timeScale: { tickMarkFormatter: (t: Time) => String(candleNumber(t as number)) },
      });
    }
    const candle = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineVisible: false });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.2 } });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    const drawings = new DrawingsPrimitive(() => placeCurtain());
    candle.attachPrimitive(drawings);

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;
    markersRef.current = createSeriesMarkers(candle, []);
    drawingsRef.current = drawings;

    const pointAt = (param: MouseEventParams<Time>): { point: TrendPoint; logical: number } | null => {
      if (!param.point) return null;
      const price = candle.coordinateToPrice(param.point.y);
      const logical = chart.timeScale().coordinateToLogical(param.point.x);
      if (price === null || logical === null) return null;
      const time = logicalToTime(live.current.bars, logical, live.current.iv);
      if (time === null) return null;
      const precision = pricePrecision(price);
      return { point: { time, price: Number(price.toFixed(precision)) }, logical };
    };

    const markAt = (param: MouseEventParams<Time>): string | null => {
      const id = param.hoveredInfo?.objectId ?? param.hoveredObjectId;
      if (typeof id !== 'string') return null;
      const p = live.current.props;
      const known = [...p.levels, ...p.trends, ...p.pins, ...p.texts].some((m) => m.id === id);
      return known ? id : null;
    };

    const onClick = (param: MouseEventParams<Time>) => {
      const p = live.current.props;
      if (p.tool === 'move') {
        p.onSelect(markAt(param));
        return;
      }
      const hit = pointAt(param);
      if (!hit) return;
      if (p.tool === 'level') p.onLevel(hit.point.price);
      if (p.tool === 'text') p.onText(hit.point);
      if (p.tool === 'pin') {
        const index = Math.round(hit.logical);
        const bar = live.current.bars[index];
        if (bar && index < live.current.pastCount + (p.revealed ? Infinity : 0)) p.onPin(bar.time);
      }
      if (p.tool === 'trend') {
        const first = draftRef.current;
        if (!first) setDraft(hit.point);
        else {
          p.onTrend(first, hit.point);
          setDraft(null);
          setHover(null);
        }
      }
    };

    const onMove = (param: MouseEventParams<Time>) => {
      if (draftRef.current) {
        const hit = pointAt(param);
        if (hit) setHover(hit.point);
      }
      const id = live.current.props.tool === 'move' ? markAt(param) : null;
      if (id !== hoveredRef.current) {
        hoveredRef.current = id;
        setHoveredId(id);
      }
      const tip = tipRef.current;
      if (tip && id && param.point) {
        const room = host.clientWidth - 260;
        tip.style.left = `${Math.min(param.point.x + 14, Math.max(8, room))}px`;
        tip.style.top = `${param.point.y + 16}px`;
      }
      const { bars: all } = live.current;
      const data = param.seriesData.get(candle) as { open: number; high: number; low: number; close: number } | undefined;
      const index = param.logical !== undefined ? Math.round(param.logical) : -1;
      writeLegend(data && all[index] ? all[index] : all[Math.min(all.length, live.current.pastCount) - 1]);
    };

    chart.subscribeClick(onClick);
    chart.subscribeCrosshairMove(onMove);
    chart.timeScale().subscribeVisibleLogicalRangeChange(placeCurtain);
    chart.timeScale().subscribeSizeChange(placeCurtain);
    // The wheel scrolls the page until you click into a chart, so charts don't trap the notebook's scrolling.
    // Options change after the click completes; changing them mid-click makes the chart drop the click.
    let wheel = false;
    const setWheel = (on: boolean) => {
      if (on === wheel) return;
      wheel = on;
      chart.applyOptions({ handleScroll: { mouseWheel: on }, handleScale: { mouseWheel: on } });
    };
    const wheelOn = () => setTimeout(() => setWheel(true), 0);
    const wheelOff = () => setWheel(false);
    host.addEventListener('pointerup', wheelOn);
    host.addEventListener('pointerleave', wheelOff);

    const ro = new ResizeObserver(() => {
      chart.resize(host.clientWidth, host.clientHeight);
      placeCurtain();
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      host.removeEventListener('pointerup', wheelOn);
      host.removeEventListener('pointerleave', wheelOff);
      chart.unsubscribeClick(onClick);
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
      drawingsRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  // Colours follow the page theme.
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    if (!chart || !candle) return;
    const c = readPalette();
    chart.applyOptions({
      layout: { background: { color: c.sheet }, textColor: c.pencil },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      crosshair: {
        vertLine: { color: c.pencil, labelBackgroundColor: c.ink },
        horzLine: { color: c.pencil, labelBackgroundColor: c.ink },
      },
    });
    candle.applyOptions({ upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
    volumeRef.current?.setData(
      live.current.bars.map((b) => ({ time: b.time as UTCTimestamp, value: b.volume, color: b.close >= b.open ? c.upSoft : c.downSoft })),
    );
  }, [theme]);

  // Practice charts hide dates until the reveal.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const show = !hideDates;
    chart.applyOptions({ crosshair: { vertLine: { labelVisible: show } } });
    chart.timeScale().applyOptions({ visible: show, timeVisible: interval !== '1d' && interval !== '1w', secondsVisible: false });
  }, [hideDates, interval]);

  // Candles, and the view window around the frozen moment.
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    const volume = volumeRef.current;
    if (!chart || !candle || !volume) return;
    const c = readPalette();
    candle.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));
    volume.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, value: b.volume, color: b.close >= b.open ? c.upSoft : c.downSoft })));
    const last = bars[pastCount - 1] ?? bars.at(-1);
    if (last) {
      const precision = pricePrecision(last.close);
      candle.applyOptions({ priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision } });
    }
    const ts = chart.timeScale();
    // Short charts of your own data start at their first candle, with the hidden area scaled to match.
    const pastShown = Math.min(pastCount, PAST_IN_VIEW);
    const curtainBars = pastShown < PAST_IN_VIEW ? Math.max(4, Math.round((pastShown * CURTAIN_SHARE) / (1 - CURTAIN_SHARE))) : CURTAIN_BARS;
    const from = pastCount - pastShown - 0.5;
    if (revealed) {
      const after = bars.length - pastCount;
      const pad = after > 0 ? Math.max(2, Math.round(curtainBars / 8)) : curtainBars;
      ts.applyOptions({ rightOffset: pad });
      ts.setVisibleLogicalRange({ from, to: pastCount + Math.min(after, 90) + pad });
    } else {
      ts.applyOptions({ rightOffset: curtainBars });
      ts.setVisibleLogicalRange({ from, to: pastCount - 1 + curtainBars });
    }
    writeLegend(bars[pastCount - 1]);
    requestAnimationFrame(placeCurtain);
  }, [bars, pastCount, revealed]);

  // Renaming your own chart updates the legend straight away.
  useEffect(() => {
    writeLegend(bars[pastCount - 1]);
  }, [props.title]);

  // Levels and plan lines get labels on the price axis.
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    priceLinesRef.current.forEach((line) => candle.removePriceLine(line));
    const c = readPalette();
    const lines: IPriceLine[] = [];
    for (const l of levels) {
      const ink = c.marks[l.color ?? 'yellow'].ink;
      lines.push(candle.createPriceLine({ price: l.price, color: ink, lineVisible: false, axisLabelVisible: true, axisLabelColor: ink, axisLabelTextColor: c.sheet, title: '' }));
    }
    for (const p of planLines) {
      const color = p.tone === 'stop' ? c.down : p.tone === 'target' ? c.up : c.ink;
      lines.push(candle.createPriceLine({ price: p.price, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: p.label }));
    }
    priceLinesRef.current = lines;
  }, [levels, planLines, theme]);

  // Pinned notes and trade markers.
  useEffect(() => {
    const c = readPalette();
    const visibleUntil = revealed ? Infinity : (bars[pastCount - 1]?.time ?? 0);
    const pinMarkers: SeriesMarker<Time>[] = pins
      .filter((p) => p.time <= visibleUntil)
      .map((p) => ({
        time: p.time as UTCTimestamp,
        position: 'aboveBar',
        shape: 'circle',
        color: c.marks[p.color ?? 'yellow'].ink,
        id: p.id,
        text: p.text.length > 28 ? `${p.text.slice(0, 27)}…` : p.text,
      }));
    const all = [...pinMarkers, ...extraMarkers].sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current?.setMarkers(all);
  }, [pins, extraMarkers, bars, pastCount, revealed, theme]);

  // Highlighter drawings, including the trend line being drawn.
  useEffect(() => {
    const c = readPalette();
    const paint = (m: { id: string; color?: MarkColor; line?: Level['line']; width?: Level['width'] }) => ({
      ...c.marks[m.color ?? 'yellow'],
      line: m.line ?? 'solid',
      width: m.width ?? 'normal',
      active: m.id === selectedId || m.id === hoveredId,
    });
    const preview = draft && hover ? [{ id: 'draft', a: draft, b: hover, draft: true, ...paint({ id: 'draft' }) }] : [];
    drawingsRef.current?.set({
      levels: levels.map((l) => ({ id: l.id, price: l.price, ...paint(l) })),
      trends: [...trends.map((t) => ({ id: t.id, a: t.a, b: t.b, ...paint(t) })), ...preview],
      texts: texts.map((t) => ({ id: t.id, time: t.time, price: t.price, text: t.text, fill: c.marks[t.color ?? 'yellow'].fill, active: t.id === selectedId || t.id === hoveredId })),
      toLogical: (time) => timeToLogical(live.current.bars, time, live.current.iv),
      textInk: c.ink,
    });
  }, [levels, trends, texts, draft, hover, bars, theme, selectedId, hoveredId]);

  const tooltip = (() => {
    if (!hoveredId || tool !== 'move') return null;
    const level = levels.find((l) => l.id === hoveredId);
    if (level) return { title: `Level ${formatPrice(level.price)}`, body: level.note };
    const trend = trends.find((t) => t.id === hoveredId);
    if (trend) return { title: `Trend line ${formatPrice(trend.a.price)} to ${formatPrice(trend.b.price)}`, body: trend.note };
    const pin = pins.find((p) => p.id === hoveredId);
    if (pin) return { title: props.timeLabel(pin.time), body: pin.text };
    return null;
  })();

  return (
    <div ref={wrapRef} className={`chart-view tool-${tool}`}>
      <div ref={hostRef} className="chart-host" />
      <div ref={legendRef} className="chart-legend" aria-hidden="true" />
      <div ref={curtainRef} className={`curtain${revealed ? ' is-open' : ''}`}>
        {props.curtain}
      </div>
      <div ref={tipRef} className="mark-tip" role="tooltip" hidden={!tooltip}>
        {tooltip && (
          <>
            <strong>{tooltip.title}</strong>
            {tooltip.body && <p>{tooltip.body}</p>}
            <span>{selectedId === hoveredId ? 'Editing below the chart' : 'Click to edit'}</span>
          </>
        )}
      </div>
      {draft && <div className="chart-hint">Click a second point to finish the line. Press Esc to cancel.</div>}
    </div>
  );
}
