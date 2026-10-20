import type { CallCell, ChartCell } from '../types';
import { gradeCall } from '../lib/grade';
import { chartTitle, isCustom, nowSec, useChartBars } from '../lib/cells';
import { formatPct, formatPrice, formatWait } from '../lib/format';
import { useStore } from '../store';
import { Outcome } from './Outcome';

interface Props {
  notebookId: string;
  cell: CallCell;
  chart: ChartCell | null;
}

export function CallCellView({ notebookId, cell, chart }: Props) {
  const updateItem = useStore((s) => s.updateItem);
  const update = (patch: Partial<CallCell>) => updateItem<CallCell>(notebookId, cell.id, patch);
  const bars = useChartBars(chart);
  const name = chart ? chartTitle(chart, false) : 'price';
  const locked = !!chart?.revealed;

  let outcome;
  if (!chart) {
    outcome = <Outcome tone="neutral" title="No chart to check against">Add a chart above this prediction.</Outcome>;
  } else if (!chart.revealed) {
    outcome = <Outcome tone="locked" title="Call locked in">Press What happened next? on the chart to check it.</Outcome>;
  } else if (bars.data) {
    const r = gradeCall(cell, bars.data, chart.interval);
    if (r?.kind === 'waiting')
      outcome = isCustom(chart) ? (
        <Outcome tone="neutral" title={`Only ${r.seen} of ${cell.bars} candles after the freeze point`}>
          Add more candles, or freeze earlier, to check this call.
        </Outcome>
      ) : (
        <Outcome tone="waiting" title={`${r.seen} of ${cell.bars} candles so far`}>
          Check back {formatWait(r.checkAt - nowSec())}.
        </Outcome>
      );
    else if (r)
      outcome = (
        <Outcome tone={r.kind === 'right' ? 'good' : 'bad'} title={r.kind === 'right' ? 'You called it' : 'Not this time'}>
          {name} went from {formatPrice(r.from)} to {formatPrice(r.to)} ({formatPct(r.change)}) over {cell.bars} candles.
        </Outcome>
      );
  }

  return (
    <div className="call-cell">
      <div className="call-sentence">
        <span>I think {name} goes</span>
        <div className="segmented" role="group" aria-label="Direction">
          {(['up', 'down'] as const).map((d) => (
            <button key={d} aria-pressed={cell.direction === d} disabled={locked} onClick={() => update({ direction: d })}>
              {d === 'up' ? 'Up' : 'Down'}
            </button>
          ))}
        </div>
        <span>over the next</span>
        <input
          className="bars-input"
          type="number"
          min={1}
          max={200}
          value={cell.bars}
          disabled={locked}
          aria-label="Number of candles"
          onChange={(e) => update({ bars: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })}
        />
        <span>candles.</span>
      </div>
      <textarea
        className="reason"
        rows={2}
        value={cell.reason}
        disabled={locked}
        placeholder="Why? Name what you're seeing on the chart."
        onChange={(e) => update({ reason: e.target.value })}
      />
      {outcome}
    </div>
  );
}
