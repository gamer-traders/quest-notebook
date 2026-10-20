import { useMemo, useState, type KeyboardEvent } from 'react';
import type { SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts';
import type { CallCell, ChartCell, Interval, Level, MarkColor, Pin, PlanCell, TextLabel, Trend, TrendPoint } from '../types';
import { ChartView, type PlanLine, type Tool } from '../chart/ChartView';
import { INTERVALS, INTERVAL_LABEL, INTERVAL_SEC, POPULAR_SYMBOLS, refreshBars, type Bar } from '../lib/market';
import { gradePlan } from '../lib/grade';
import { chartTitle, isCustom, momentLabel, nowSec, randomMoment, uid, useChartBars } from '../lib/cells';
import { numberedTime } from '../lib/customData';
import { formatMoment, formatPrice, formatWait } from '../lib/format';
import { OwnDataPanel, type Replacement } from './OwnDataPanel';
import { MarkEditor, type MarkTarget } from './MarkEditor';
import { readPalette } from '../chart/palette';
import { useStore } from '../store';

interface Props {
  notebookId: string;
  cell: ChartCell;
  /** Plans and predictions that sit under this chart. */
  linked: (PlanCell | CallCell)[];
}

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'move', label: 'Move', hint: '' },
  { id: 'level', label: 'Level', hint: 'Click a price to mark a level.' },
  { id: 'trend', label: 'Trend line', hint: 'Click two points to draw a trend line.' },
  { id: 'pin', label: 'Pin a note', hint: 'Click a candle to pin a note to it.' },
  { id: 'text', label: 'Text', hint: 'Click anywhere on the chart to write a label there.' },
];

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const isTyping = (el: EventTarget) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

function toInputValue(sec: number) {
  return new Date(sec * 1000).toISOString().slice(0, 16);
}

export function ChartCellView({ notebookId, cell, linked }: Props) {
  const updateItem = useStore((s) => s.updateItem);
  const theme = useStore((s) => s.theme);
  const update = (patch: Partial<ChartCell>) => updateItem<ChartCell>(notebookId, cell.id, patch);
  const bars = useChartBars(cell);
  const custom = isCustom(cell);
  const ownCandles = cell.candles ?? [];

  const [tool, setTool] = useState<Tool>('move');
  const [symbolDraft, setSymbolDraft] = useState(cell.symbol);
  const [momentOpen, setMomentOpen] = useState(false);
  const [pinDraft, setPinDraft] = useState<{ time: number; text: string } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [editOpen, setEditOpen] = useState(custom && ownCandles.length === 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState<{ at: TrendPoint; text: string } | null>(null);
  const texts = cell.texts ?? [];

  const data = bars.data;
  const past = data?.past ?? [];
  const future = data?.future ?? [];
  const shown = useMemo(() => (cell.revealed ? [...past, ...future] : past), [data, cell.revealed]);
  const lastPast = past.at(-1);

  const plans = linked.filter((c): c is PlanCell => c.type === 'plan');

  const planLines = useMemo<PlanLine[]>(() => {
    const out: PlanLine[] = [];
    for (const p of plans) {
      if (p.entry !== null) out.push({ price: p.entry, label: 'Entry', tone: 'entry' });
      if (p.stop !== null) out.push({ price: p.stop, label: 'Stop', tone: 'stop' });
      if (p.target !== null) out.push({ price: p.target, label: 'Target', tone: 'target' });
    }
    return out;
    // Rebuild only when the numbers change, not on every keystroke elsewhere.
  }, [plans.map((p) => `${p.entry}|${p.stop}|${p.target}`).join(',')]);

  const tradeMarkers = useMemo<SeriesMarker<Time>[]>(() => {
    if (!data || !cell.revealed) return [];
    const c = readPalette();
    const out: SeriesMarker<Time>[] = [];
    for (const p of plans) {
      const r = gradePlan(p, data);
      if (!r || r.kind === 'not-filled') continue;
      const long = p.side === 'long';
      out.push({ time: r.filledAt as UTCTimestamp, position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: c.ink, text: 'Filled' });
      if (r.kind === 'target' || r.kind === 'stop') {
        const won = r.kind === 'target';
        out.push({ time: r.exitAt as UTCTimestamp, position: won === long ? 'aboveBar' : 'belowBar', shape: 'square', color: won ? c.up : c.down, text: won ? 'Target' : 'Stopped' });
      }
    }
    return out;
  }, [data, cell.revealed, theme, plans.map((p) => `${p.side}|${p.entry}|${p.stop}|${p.target}`).join(',')]);

  const commitSymbol = () => {
    const next = symbolDraft.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (next && next !== cell.symbol) update({ symbol: next, revealed: false });
    else setSymbolDraft(cell.symbol);
  };

  const changeInterval = (interval: Interval) => {
    if (interval === cell.interval) return;
    update({ interval, revealed: false, asOf: cell.practice ? randomMoment(interval) : cell.asOf });
  };

  const reveal = async () => {
    if (custom) return update({ revealed: true });
    setRevealing(true);
    try {
      await refreshBars(cell.symbol, cell.interval, cell.asOf);
    } finally {
      setRevealing(false);
      update({ revealed: true });
    }
  };

  const switchSource = (source: 'binance' | 'custom') => {
    if (source === (cell.source ?? 'binance')) return;
    if (source === 'binance') return update({ source, asOf: nowSec(), revealed: false });
    const last = ownCandles.at(-1);
    update({ source, asOf: last?.time ?? numberedTime(0), revealed: false, practice: false, interval: cell.dated ? cell.interval : '1d' });
    setEditOpen(true);
    setMomentOpen(false);
  };

  // Replacing the data shows every new candle; editing keeps the freeze point unless every candle was showing.
  const replaceCandles = (r: Replacement) => {
    update({ candles: r.candles, dated: r.dated, interval: r.interval, asOf: r.candles.at(-1)!.time, revealed: false, name: cell.name?.trim() ? cell.name : r.name });
  };
  const editCandles = (candles: Bar[]) => {
    const wasShowingAll = !ownCandles.length || cell.asOf >= ownCandles.at(-1)!.time;
    update({ candles, asOf: wasShowingAll ? (candles.at(-1)?.time ?? numberedTime(0)) : cell.asOf });
  };

  const target: MarkTarget | null = (() => {
    if (!selectedId) return null;
    const level = cell.levels.find((m) => m.id === selectedId);
    if (level) return { kind: 'level', mark: level };
    const trend = cell.trends.find((m) => m.id === selectedId);
    if (trend) return { kind: 'trend', mark: trend };
    const pin = cell.pins.find((m) => m.id === selectedId);
    if (pin) return { kind: 'pin', mark: pin };
    const text = texts.find((m) => m.id === selectedId);
    if (text) return { kind: 'text', mark: text };
    return null;
  })();

  const changeMark = (id: string, patch: Partial<Level & Trend & Pin & TextLabel>) => {
    const apply = <T extends { id: string }>(list: T[]) => list.map((m) => (m.id === id ? { ...m, ...patch } : m));
    update({ levels: apply(cell.levels), trends: apply(cell.trends), pins: apply(cell.pins), texts: apply(texts) });
  };

  const deleteMark = (id: string) => {
    const keep = <T extends { id: string }>(list: T[]) => list.filter((m) => m.id !== id);
    update({ levels: keep(cell.levels), trends: keep(cell.trends), pins: keep(cell.pins), texts: keep(texts) });
    setSelectedId(null);
  };

  const timeLabel = (time: number) => (hideDates ? 'This candle' : capitalize(momentLabel(cell, time)));

  const markTitle = (t: MarkTarget) =>
    t.kind === 'level'
      ? `Level ${formatPrice(t.mark.price)}`
      : t.kind === 'trend'
        ? 'Trend line'
        : t.kind === 'pin'
          ? `Note on ${hideDates ? 'this candle' : momentLabel(cell, t.mark.time)}`
          : 'Text label';

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setTool('move');
      setPinDraft(null);
      setTextDraft(null);
      setSelectedId(null);
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !isTyping(e.target)) {
      e.preventDefault();
      deleteMark(selectedId);
    }
  };

  const saveText = () => {
    if (textDraft && textDraft.text.trim()) {
      const id = uid();
      update({ texts: [...texts, { id, time: textDraft.at.time, price: textDraft.at.price, text: textDraft.text.trim() }] });
      setSelectedId(id);
    }
    setTextDraft(null);
  };

  const savePin = () => {
    if (pinDraft && pinDraft.text.trim()) {
      update({ pins: [...cell.pins, { id: uid(), time: pinDraft.time, text: pinDraft.text.trim() }] });
    }
    setPinDraft(null);
  };

  const markDot = (color?: MarkColor) => <span className={`mark-dot swatch-${color ?? 'yellow'}`} aria-hidden="true" />;

  const nextCandleWait = lastPast ? lastPast.time + INTERVAL_SEC[cell.interval] - nowSec() : 0;
  const hideDates = cell.practice && !cell.revealed;

  const curtain = custom && !cell.revealed && future.length === 0 ? (
    <p className="curtain-note">Nothing hidden yet. Use the freeze point above to hide the last candles, then make your call.</p>
  ) : !cell.revealed ? (
    <button className="curtain-button" onClick={reveal} disabled={revealing || bars.status !== 'ready'}>
      {revealing ? 'Checking…' : 'What happened next?'}
    </button>
  ) : future.length === 0 && custom ? (
    <p className="curtain-note">This was the last candle.</p>
  ) : future.length === 0 ? (
    <p className="curtain-note">
      Nothing after this yet. The next candle closes {formatWait(nextCandleWait)}.
    </p>
  ) : (
    <span className="curtain-label">{hideDates ? 'What happened next' : `After ${lastPast ? momentLabel(cell, lastPast.time) : ''}`}</span>
  );

  const activeHint = TOOLS.find((t) => t.id === tool)?.hint;

  const frozenLabel = hideDates
    ? 'Frozen at a hidden date'
    : custom
      ? future.length === 0
        ? 'Showing all candles'
        : `Frozen at ${lastPast ? momentLabel(cell, lastPast.time) : 'the start'}`
      : `Frozen at ${formatMoment(cell.asOf, cell.interval)}`;

  return (
    <div className="chart-cell" onKeyDown={onKeyDown}>
      <div className="chart-toolbar">
        <div className="segmented source-switch" role="group" aria-label="Where the candles come from">
          <button aria-pressed={!custom} onClick={() => switchSource('binance')}>
            Binance
          </button>
          <button aria-pressed={custom} onClick={() => switchSource('custom')}>
            My data
          </button>
        </div>
        {custom ? (
          <div className="toolbar-group">
            <input
              className="name-input"
              value={cell.name ?? ''}
              placeholder="Name this chart"
              aria-label="Chart name"
              onChange={(e) => update({ name: e.target.value })}
            />
            <button aria-expanded={editOpen} onClick={() => setEditOpen((o) => !o)}>
              {editOpen ? 'Done editing' : 'Edit data'}
            </button>
          </div>
        ) : (
        <div className="toolbar-group">
          <input
            className="symbol-input"
            value={symbolDraft}
            list="symbols"
            aria-label="Symbol"
            onChange={(e) => setSymbolDraft(e.target.value)}
            onBlur={commitSymbol}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <datalist id="symbols">
            {POPULAR_SYMBOLS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="segmented" role="group" aria-label="Candle size">
            {INTERVALS.map((iv) => (
              <button key={iv} aria-pressed={iv === cell.interval} onClick={() => changeInterval(iv)}>
                {INTERVAL_LABEL[iv]}
              </button>
            ))}
          </div>
        </div>
        )}

        <div className="segmented tools" role="group" aria-label="Drawing tools">
          {TOOLS.map((t) => (
            <button key={t.id} aria-pressed={t.id === tool} onClick={() => setTool(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="toolbar-group toolbar-end">
          <button className="quiet" onClick={() => setMomentOpen((o) => !o)} aria-expanded={momentOpen} disabled={custom && ownCandles.length < 2}>
            {frozenLabel}
          </button>
          {cell.revealed && (
            <button className="quiet" onClick={() => update({ revealed: false })}>
              Hide what happened
            </button>
          )}
        </div>
      </div>

      {custom && editOpen && <OwnDataPanel cell={cell} onEdit={editCandles} onReplace={replaceCandles} />}

      {momentOpen && custom && ownCandles.length > 1 && (
        <div className="moment-row">
          <label className="moment-slider">
            <span>Hide the candles after</span>
            <input
              type="range"
              min={1}
              max={ownCandles.length}
              value={Math.max(1, past.length)}
              onChange={(e) => update({ asOf: ownCandles[Number(e.target.value) - 1].time, revealed: false })}
            />
            <span className="moment-value">{lastPast ? momentLabel(cell, lastPast.time) : ''}</span>
          </label>
          <button onClick={() => update({ asOf: ownCandles.at(-1)!.time, revealed: false })}>Show all</button>
          <span className="moment-help">Hide the last few candles, mark what you see and make a call, then press What happened next?</span>
        </div>
      )}

      {momentOpen && !custom && (
        <div className="moment-row">
          <span>Freeze the chart at</span>
          <button onClick={() => (update({ asOf: nowSec(), revealed: false, practice: false }), setMomentOpen(false))}>Now</button>
          <label className="moment-date">
            <span className="sr-only">Date and time, UTC</span>
            <input
              type="datetime-local"
              value={toInputValue(cell.asOf)}
              max={toInputValue(nowSec())}
              onChange={(e) => {
                const ms = Date.parse(`${e.target.value}:00Z`);
                if (!Number.isNaN(ms)) update({ asOf: Math.floor(ms / 1000), revealed: false, practice: false });
              }}
            />
            <span className="unit">UTC</span>
          </label>
          <button onClick={() => (update({ asOf: randomMoment(cell.interval), revealed: false, practice: true }), setMomentOpen(false))}>
            Random moment
          </button>
          <span className="moment-help">Random moments hide the dates, so you read the chart instead of remembering it.</span>
        </div>
      )}

      {activeHint && <p className="tool-hint">{activeHint}</p>}

      <div className="chart-frame">
        {custom && ownCandles.length === 0 && <div className="chart-status">No candles yet. Type, paste or draw them with Edit data.</div>}
        {bars.status === 'loading' && <div className="chart-status">Loading {cell.symbol}…</div>}
        {bars.status === 'error' && (
          <div className="chart-status is-error">
            Binance doesn't list {cell.symbol}. Try a pair like BTCUSDT or ETHUSDT.
          </div>
        )}
        {bars.status === 'ready' && !custom && past.length === 0 && (
          <div className="chart-status is-error">No {cell.symbol} candles before this moment. Pick a later date.</div>
        )}
        <ChartView
          key={custom && !cell.dated ? 'numbered' : 'dated'}
          bars={shown}
          pastCount={past.length}
          title={chartTitle(cell, false)}
          numbered={custom && !cell.dated}
          interval={cell.interval}
          revealed={cell.revealed}
          hideDates={hideDates}
          levels={cell.levels}
          trends={cell.trends}
          pins={cell.pins}
          texts={texts}
          selectedId={selectedId}
          timeLabel={timeLabel}
          onText={(at) => (setTextDraft({ at, text: '' }), setTool('move'))}
          onSelect={setSelectedId}
          planLines={planLines}
          extraMarkers={tradeMarkers}
          tool={tool}
          onLevel={(price) => (update({ levels: [...cell.levels, { id: uid(), price }] }), setTool('move'))}
          onTrend={(a, b) => (update({ trends: [...cell.trends, { id: uid(), a, b }] }), setTool('move'))}
          onPin={(time) => (setPinDraft({ time, text: '' }), setTool('move'))}
          curtain={curtain}
        />
      </div>

      {data?.source === 'demo' && <p className="demo-note">Couldn't reach Binance, so these are made-up demo prices.</p>}

      {target && (
        <MarkEditor
          target={target}
          title={markTitle(target)}
          onChange={(patch) => changeMark(target.mark.id, patch)}
          onDelete={() => deleteMark(target.mark.id)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {textDraft && (
        <form
          className="pin-form"
          onSubmit={(e) => {
            e.preventDefault();
            saveText();
          }}
        >
          <label>
            <span>Label at {formatPrice(textDraft.at.price)}</span>
            <input autoFocus value={textDraft.text} onChange={(e) => setTextDraft({ ...textDraft, text: e.target.value })} placeholder="What should it say?" />
          </label>
          <button type="submit">Add label</button>
          <button type="button" className="quiet" onClick={() => setTextDraft(null)}>
            Cancel
          </button>
        </form>
      )}

      {pinDraft && (
        <form
          className="pin-form"
          onSubmit={(e) => {
            e.preventDefault();
            savePin();
          }}
        >
          <label>
            <span>Note on {hideDates ? 'this candle' : momentLabel(cell, pinDraft.time)}</span>
            <input autoFocus value={pinDraft.text} onChange={(e) => setPinDraft({ ...pinDraft, text: e.target.value })} placeholder="What do you see here?" />
          </label>
          <button type="submit">Pin note</button>
          <button type="button" className="quiet" onClick={() => setPinDraft(null)}>
            Cancel
          </button>
        </form>
      )}

      {(cell.levels.length > 0 || cell.trends.length > 0 || cell.pins.length > 0 || texts.length > 0) && (
        <ul className="marks" aria-label="Your marks on this chart">
          {[
            ...cell.levels.map((l) => ({ id: l.id, color: l.color, label: <>Level {formatPrice(l.price)}</>, name: `level ${formatPrice(l.price)}` })),
            ...cell.trends.map((t) => ({
              id: t.id,
              color: t.color,
              label: (
                <>
                  Trend line {formatPrice(t.a.price)} to {formatPrice(t.b.price)}
                </>
              ),
              name: 'trend line',
            })),
            ...cell.pins.map((p) => ({
              id: p.id,
              color: p.color,
              label: (
                <>
                  {!hideDates && <time>{momentLabel(cell, p.time)}</time>} {p.text}
                </>
              ),
              name: 'note',
            })),
            ...texts.map((t) => ({ id: t.id, color: t.color, label: <>Text: {t.text}</>, name: 'text label' })),
          ].map((m) => (
            <li key={m.id} className={m.id === selectedId ? 'is-selected' : ''}>
              <button className="mark-chip" aria-pressed={m.id === selectedId} onClick={() => setSelectedId(m.id === selectedId ? null : m.id)}>
                {markDot(m.color)}
                <span>{m.label}</span>
              </button>
              <button className="mark-remove" aria-label={`Remove ${m.name}`} onClick={() => deleteMark(m.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
