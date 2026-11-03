import type { CallCell, ChartCell, Notebook, PlanCell } from '../types';
import { chartAboveItem, itemSequence } from '../page/blocks';
import { displayTitle } from '../page/tree';
import { chartTitle, isCustom, momentLabel } from '../lib/cells';
import { customBarSet } from '../lib/customData';
import { barsKey, refreshBars, useManyBars, type BarsSpec } from '../lib/market';
import { gradeCall, gradePlan, planMath, type CallResult, type PlanResult } from '../lib/grade';
import { formatMoment, formatPct, formatPrice, formatR } from '../lib/format';
import { useStore } from '../store';
import { isLocked, useClaude } from '../claude/store';
import { LOCKED_PAGE } from './sidebar/labels';

interface Row {
  notebook: Notebook;
  cell: PlanCell | CallCell;
  chart: ChartCell | null;
}

type Verdict = { tone: 'good' | 'bad' | 'waiting' | 'locked' | 'neutral'; text: string; r?: number; right?: boolean };

function planVerdict(r: PlanResult | null): Verdict {
  if (!r) return { tone: 'neutral', text: 'Plan incomplete' };
  if (r.kind === 'not-filled') return { tone: 'neutral', text: 'Never filled' };
  if (r.kind === 'open') return { tone: 'waiting', text: `Open, ${formatR(r.r)}` };
  return r.kind === 'target' ? { tone: 'good', text: `Target, ${formatR(r.r)}`, r: r.r } : { tone: 'bad', text: 'Stopped, −1R', r: -1 };
}

function callVerdict(r: CallResult | null): Verdict {
  if (!r) return { tone: 'neutral', text: 'No data' };
  if (r.kind === 'waiting') return { tone: 'waiting', text: `Waiting, ${r.seen} candles in` };
  return { tone: r.kind === 'right' ? 'good' : 'bad', text: `${r.kind === 'right' ? 'Right' : 'Wrong'}, ${formatPct(r.change)}`, right: r.kind === 'right' };
}

export function ReviewView() {
  const notebooks = useStore((s) => s.notebooks);
  const { openNotebook, updateItem } = useStore.getState();
  // The page Claude is working on takes no changes until the turn ends, revealing its charts among them.
  const running = useClaude((s) => s.running);

  const rows: Row[] = [];
  for (const nb of notebooks) {
    for (const item of itemSequence(nb)) {
      if (item.type === 'plan' || item.type === 'call') rows.push({ notebook: nb, cell: item, chart: chartAboveItem(nb, item.id) });
    }
  }
  const specs: BarsSpec[] = rows.flatMap((r) => (r.chart && !isCustom(r.chart) ? [r.chart] : []));
  const bars = useManyBars(specs);

  const graded = rows.map((row) => {
    const { chart, cell } = row;
    if (!chart) return { row, verdict: { tone: 'neutral', text: 'No trading chart above' } as Verdict };
    if (!chart.revealed) return { row, verdict: { tone: 'locked', text: 'Not revealed yet' } as Verdict };
    const data = isCustom(chart) ? customBarSet(chart.candles ?? [], chart.asOf) : bars.get(barsKey(chart.symbol, chart.interval, chart.asOf))?.data;
    if (!data) return { row, verdict: { tone: 'waiting', text: 'Loading…' } as Verdict };
    const verdict = cell.type === 'plan' ? planVerdict(gradePlan(cell, data)) : callVerdict(gradeCall(cell, data, chart.interval));
    return { row, verdict };
  });

  const calls = graded.filter((g) => g.row.cell.type === 'call' && g.verdict.right !== undefined);
  const right = calls.filter((g) => g.verdict.right).length;
  const trades = graded.filter((g) => g.verdict.r !== undefined);
  const totalR = trades.reduce((sum, g) => sum + (g.verdict.r ?? 0), 0);
  const locked = graded.filter((g) => g.verdict.tone === 'locked').length;

  const reveal = async (chart: ChartCell, notebookId: string) => {
    if (isLocked(useClaude.getState(), notebookId)) return;
    if (!isCustom(chart)) await refreshBars(chart.symbol, chart.interval, chart.asOf).catch(() => undefined);
    // A turn may have started on the page while the candles loaded.
    if (!isLocked(useClaude.getState(), notebookId)) updateItem<ChartCell>(notebookId, chart.id, { revealed: true });
  };

  return (
    <article className="review">
      <header className="review-head">
        <h1>Review my calls</h1>
        <p>Every prediction and practice trade you've written, checked against what the market did next.</p>
      </header>

      <div className="scoreboard">
        <div>
          <span className="score">
            {right}
            <small> of {calls.length}</small>
          </span>
          <span>predictions right</span>
        </div>
        <div>
          <span className={`score ${totalR > 0 ? 'good' : totalR < 0 ? 'bad' : ''}`}>{formatR(totalR)}</span>
          <span>
            from {trades.length} closed practice {trades.length === 1 ? 'trade' : 'trades'}
          </span>
        </div>
        <div>
          <span className="score">{locked}</span>
          <span>still hidden</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="empty-cells">No predictions or trade plans yet. Add one under any chart.</p>
      ) : (
        <table className="review-table">
          <thead>
            <tr>
              <th scope="col">Trading chart</th>
              <th scope="col">What you said</th>
              <th scope="col">Result</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {graded.map(({ row, verdict }) => {
              const { cell, chart, notebook } = row;
              const held = isLocked({ running }, notebook.id);
              const said =
                cell.type === 'call'
                  ? `${cell.direction === 'up' ? 'Up' : 'Down'} over ${cell.bars} candles`
                  : `${cell.side === 'long' ? 'Long' : 'Short'} at ${formatPrice(cell.entry)}, stop ${formatPrice(cell.stop)}, target ${formatPrice(cell.target)}${
                      planMath(cell) ? ` (${planMath(cell)!.rr.toFixed(1)} to 1)` : ''
                    }`;
              return (
                <tr key={cell.id}>
                  <td data-label="Trading chart">
                    <strong>{chart ? chartTitle(chart) : '–'}</strong>
                    <span className="sub">
                      {chart
                        ? isCustom(chart)
                          ? `Frozen at ${momentLabel(chart, chart.asOf)}`
                          : chart.practice && !chart.revealed
                            ? 'Hidden date'
                            : formatMoment(chart.asOf, chart.interval)
                        : ''}
                    </span>
                    <span className="sub">{displayTitle(notebook.title)}</span>
                  </td>
                  <td data-label="What you said">
                    {said}
                    {cell.reason && <span className="sub">{cell.reason}</span>}
                  </td>
                  <td data-label="Result">
                    <span className={`pill tone-${verdict.tone}`}>{verdict.text}</span>
                  </td>
                  <td className="row-actions">
                    {chart && !chart.revealed && (
                      <button className="quiet" disabled={held} title={held ? LOCKED_PAGE : undefined} onClick={() => reveal(chart, notebook.id)}>
                        Reveal
                      </button>
                    )}
                    <button className="quiet" aria-label={`Open in ${displayTitle(notebook.title)}`} onClick={() => openNotebook(notebook.id, cell.id)}>
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </article>
  );
}
