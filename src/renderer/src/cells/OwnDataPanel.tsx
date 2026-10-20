import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { ChartCell, Interval } from '../types';
import type { Bar } from '../lib/market';
import { INTERVAL_SEC } from '../lib/market';
import { CANDLE_LIMIT, drawToCandles, numberedTime, parseCandles } from '../lib/customData';
import { momentLabel } from '../lib/cells';
import { formatPrice, pricePrecision } from '../lib/format';
import { readPalette } from '../chart/palette';

type Tab = 'type' | 'paste' | 'draw';

export interface Replacement {
  candles: Bar[];
  dated: boolean;
  interval: Interval;
  name?: string;
}

interface Props {
  cell: ChartCell;
  onEdit: (candles: Bar[]) => void;
  onReplace: (r: Replacement) => void;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'type', label: 'Type' },
  { id: 'paste', label: 'Paste' },
  { id: 'draw', label: 'Draw' },
];

export function OwnDataPanel({ cell, onEdit, onReplace }: Props) {
  const [tab, setTab] = useState<Tab>(cell.candles?.length ? 'type' : 'draw');
  return (
    <div className="own-data">
      <div className="own-data-head">
        <div className="segmented" role="tablist" aria-label="How to add candles">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="muted">
          {cell.candles?.length ? `${cell.candles.length} ${cell.candles.length === 1 ? 'candle' : 'candles'}` : 'No candles yet'}
        </span>
      </div>
      {tab === 'type' && <TypeTab cell={cell} onEdit={onEdit} />}
      {tab === 'paste' && <PasteTab cell={cell} onReplace={onReplace} />}
      {tab === 'draw' && <DrawTab cell={cell} onReplace={onReplace} />}
    </div>
  );
}

const ROWS_SHOWN = 30;

function nextCandle(candles: Bar[], cell: ChartCell): Bar {
  const last = candles.at(-1);
  if (!last) return { time: numberedTime(0), open: 100, high: 101, low: 99, close: 100.5, volume: 0 };
  const p = last.close;
  const step = Number((p * 0.005).toFixed(pricePrecision(p)));
  const time = cell.dated ? last.time + INTERVAL_SEC[cell.interval] : numberedTime(candles.length);
  return { time, open: p, high: p + step, low: p - step, close: p, volume: 0 };
}

function TypeTab({ cell, onEdit }: { cell: ChartCell; onEdit: (candles: Bar[]) => void }) {
  const candles = cell.candles ?? [];
  const [showAll, setShowAll] = useState(false);
  const start = showAll ? 0 : Math.max(0, candles.length - ROWS_SHOWN);
  const visible = candles.slice(start);

  const setField = (index: number, field: 'open' | 'high' | 'low' | 'close', raw: string) => {
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value)) return;
    onEdit(candles.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  const problem = candles.findIndex((c) => c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close));

  return (
    <div className="type-tab">
      {candles.length === 0 ? (
        <p className="muted">Add a candle, then type its prices. Each new candle starts where the last one closed.</p>
      ) : (
        <>
          {start > 0 && (
            <button className="quiet" onClick={() => setShowAll(true)}>
              Show all {candles.length} candles
            </button>
          )}
          <div className="candle-table-wrap">
            <table className="candle-table">
              <thead>
                <tr>
                  <th scope="col">{cell.dated ? 'Date' : 'Candle'}</th>
                  <th scope="col">Open</th>
                  <th scope="col">High</th>
                  <th scope="col">Low</th>
                  <th scope="col">Close</th>
                  <th scope="col">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c, k) => {
                  const i = start + k;
                  const label = cell.dated ? momentLabel(cell, c.time) : String(i + 1);
                  return (
                    <tr key={`${c.time}-${i}`} className={i === problem ? 'has-problem' : ''}>
                      <th scope="row">{label}</th>
                      {(['open', 'high', 'low', 'close'] as const).map((f) => (
                        <td key={f}>
                          <input
                            type="number"
                            step="any"
                            inputMode="decimal"
                            aria-label={`${f} of ${cell.dated ? label : `candle ${label}`}`}
                            defaultValue={c[f]}
                            onBlur={(e) => setField(i, f, e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          />
                        </td>
                      ))}
                      <td>
                        <button className="quiet" aria-label={`Remove ${cell.dated ? label : `candle ${label}`}`} onClick={() => onEdit(candles.filter((_, j) => j !== i))}>
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {problem >= 0 && (
        <p className="plan-problem">
          Check {cell.dated ? momentLabel(cell, candles[problem].time) : `candle ${problem + 1}`}: the high should be the highest price and the low the lowest.
        </p>
      )}
      <button onClick={() => onEdit([...candles, nextCandle(candles, cell)])} disabled={candles.length >= CANDLE_LIMIT}>
        + Add candle
      </button>
    </div>
  );
}

function PasteTab({ cell, onReplace }: { cell: ChartCell; onReplace: (r: Replacement) => void }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const parsed = useMemo(() => (text.trim() ? parseCandles(text) : null), [text]);

  const summary = (() => {
    if (!parsed) return null;
    const n = parsed.candles.length;
    if (n === 0) return "Couldn't find any candles. Each row needs open, high, low and close, with an optional date first.";
    const first = parsed.candles[0];
    const last = parsed.candles[n - 1];
    const range = parsed.dated
      ? `from ${momentLabel({ ...cell, source: 'custom', dated: true, interval: parsed.interval }, first.time)} to ${momentLabel({ ...cell, source: 'custom', dated: true, interval: parsed.interval }, last.time)}`
      : 'without dates, so they are numbered';
    return `Found ${n} ${n === 1 ? 'candle' : 'candles'} ${range}.`;
  })();

  return (
    <div className="paste-tab">
      <textarea
        className="paste-input"
        rows={7}
        value={text}
        spellCheck={false}
        placeholder={'Paste rows from a spreadsheet or a CSV file:\ndate, open, high, low, close, volume\n\nThe date and volume columns are optional.'}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="paste-actions">
        <label className="file-button">
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setText(await file.text());
              setFileName(file.name.replace(/\.[^.]+$/, ''));
              e.target.value = '';
            }}
          />
          <span>Choose a CSV file</span>
        </label>
        <button
          className="primary"
          disabled={!parsed || parsed.candles.length === 0}
          onClick={() => {
            if (!parsed) return;
            onReplace({ candles: parsed.candles, dated: parsed.dated, interval: parsed.interval, name: fileName ?? undefined });
            setText('');
            setFileName(null);
          }}
        >
          {cell.candles?.length ? 'Replace the chart with these' : 'Use these candles'}
        </button>
      </div>
      {summary && <p className="paste-summary">{summary}</p>}
      {parsed && parsed.skipped.length > 0 && (
        <p className="plan-problem">
          Skipped {parsed.skipped.length === 1 ? 'line' : 'lines'} {parsed.skipped.slice(0, 8).join(', ')}
          {parsed.skipped.length > 8 ? ' and more' : ''}, which didn't have four prices.
        </p>
      )}
      {parsed?.truncated && <p className="muted">Only the most recent {CANDLE_LIMIT} candles fit in one chart.</p>}
    </div>
  );
}

interface Point {
  x: number;
  y: number;
}

function DrawTab({ cell, onReplace }: { cell: ChartCell; onReplace: (r: Replacement) => void }) {
  const existing = cell.candles ?? [];
  const [count, setCount] = useState(40);
  const [low, setLow] = useState(() => (existing.length ? Math.min(...existing.map((c) => c.low)) : 90));
  const [high, setHigh] = useState(() => (existing.length ? Math.max(...existing.map((c) => c.high)) : 110));
  const [stroke, setStroke] = useState<Point[]>([]);
  const drawing = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const valid = high > low && count >= 2 && count <= 300;
  const candles = useMemo(() => (valid && stroke.length > 1 ? drawToCandles(stroke, { count, low, high }) : []), [stroke, count, low, high, valid]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ratio, ratio);
    const c = readPalette();
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = Math.round((h * i) / 4) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (candles.length && valid) {
      const yOf = (p: number) => ((high - p) / (high - low)) * h;
      const slot = w / candles.length;
      candles.forEach((k, i) => {
        const x = slot * i + slot / 2;
        ctx.strokeStyle = ctx.fillStyle = k.close >= k.open ? c.up : c.down;
        ctx.beginPath();
        ctx.moveTo(x, yOf(k.high));
        ctx.lineTo(x, yOf(k.low));
        ctx.stroke();
        const top = yOf(Math.max(k.open, k.close));
        const body = Math.max(1, yOf(Math.min(k.open, k.close)) - top);
        ctx.fillRect(x - Math.max(1, slot * 0.35), top, Math.max(2, slot * 0.7), body);
      });
    }

    if (stroke.length > 1) {
      ctx.strokeStyle = c.mark;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      stroke.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
      ctx.stroke();
    }
  }, [stroke, candles, high, low, valid]);

  const pointFrom = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  return (
    <div className="draw-tab">
      <div className="draw-controls">
        <label className="field">
          <span>Candles</span>
          <input type="number" min={2} max={300} value={count} onChange={(e) => setCount(Math.round(Number(e.target.value)) || 0)} />
        </label>
        <label className="field">
          <span>Lowest price</span>
          <input type="number" step="any" value={low} onChange={(e) => setLow(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Highest price</span>
          <input type="number" step="any" value={high} onChange={(e) => setHigh(Number(e.target.value))} />
        </label>
      </div>
      <div className="draw-box">
        <span className="draw-axis top">{formatPrice(high)}</span>
        <span className="draw-axis bottom">{formatPrice(low)}</span>
        <canvas
          ref={canvasRef}
          aria-label="Drawing area: drag from left to right to sketch the price path"
          onPointerDown={(e) => {
            // Capture keeps the stroke going if the pointer slips outside the box; it can fail for pointers the browser no longer tracks.
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Drawing still works without capture.
            }
            drawing.current = true;
            setStroke([pointFrom(e)]);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const p = pointFrom(e);
            setStroke((s) => [...s, p]);
          }}
          onPointerUp={() => {
            drawing.current = false;
          }}
        />
        {stroke.length === 0 && <p className="draw-empty">Drag from left to right to sketch the path price takes.</p>}
      </div>
      {!valid && <p className="plan-problem">Use between 2 and 300 candles, with the highest price above the lowest.</p>}
      <div className="paste-actions">
        <button className="quiet" disabled={stroke.length === 0} onClick={() => setStroke([])}>
          Clear
        </button>
        <button
          className="primary"
          disabled={candles.length === 0}
          onClick={() => {
            onReplace({ candles, dated: false, interval: '1d' });
            setStroke([]);
          }}
        >
          {existing.length ? 'Replace the chart with these' : 'Use these candles'}
        </button>
      </div>
    </div>
  );
}
