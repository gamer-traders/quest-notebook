import type { ChartCell, PlanCell } from '../types';
import { gradePlan, planMath, planProblem } from '../lib/grade';
import { formatPct, formatPrice, formatR } from '../lib/format';
import { momentLabel, useChartBars } from '../lib/cells';
import { useStore } from '../store';
import { Outcome } from './Outcome';

interface Props {
  notebookId: string;
  cell: PlanCell;
  chart: ChartCell | null;
}

function NumberField({
  label,
  value,
  tone,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  tone: string;
  disabled: boolean;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className={`field field-${tone}`}>
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value === '' ? null : Number(e.target.value);
          onChange(v === null || Number.isNaN(v) ? null : v);
        }}
      />
    </label>
  );
}

export function PlanCellView({ notebookId, cell, chart }: Props) {
  const updateItem = useStore((s) => s.updateItem);
  const update = (patch: Partial<PlanCell>) => updateItem<PlanCell>(notebookId, cell.id, patch);
  const bars = useChartBars(chart);
  const last = bars.data?.past.at(-1);
  const locked = !!chart?.revealed;
  const math = planMath(cell);
  const problem = planProblem(cell);
  const complete = cell.entry !== null && cell.stop !== null && cell.target !== null;

  let outcome;
  if (!chart) {
    outcome = <Outcome tone="neutral" title="No chart to test on">Add a chart above this plan.</Outcome>;
  } else if (!complete || problem) {
    outcome = null;
  } else if (!chart.revealed) {
    outcome = <Outcome tone="locked" title="Plan locked in">Press What happened next? on the chart to see how it plays out.</Outcome>;
  } else if (bars.data) {
    const r = gradePlan(cell, bars.data);
    const when = (t: number) => (chart.practice ? '' : ` on ${momentLabel(chart, t)}`);
    if (!r) outcome = null;
    else if (r.kind === 'not-filled')
      outcome = (
        <Outcome tone="neutral" title="Never filled">
          Price didn't reach your entry in the {r.checked} candles since.
        </Outcome>
      );
    else if (r.kind === 'open')
      outcome = (
        <Outcome tone={r.r >= 0 ? 'good' : 'bad'} title={`Still open at ${formatR(r.r)}`}>
          Filled{when(r.filledAt)}. Price is at {formatPrice(r.lastPrice)} now.
        </Outcome>
      );
    else if (r.kind === 'target')
      outcome = (
        <Outcome tone="good" title={`Target hit, ${formatR(r.r)}`}>
          Filled{when(r.filledAt)}, reached the target{when(r.exitAt)}.
        </Outcome>
      );
    else
      outcome = (
        <Outcome tone="bad" title="Stopped out, −1R">
          Filled{when(r.filledAt)}, hit the stop{when(r.exitAt)}.
        </Outcome>
      );
  }

  return (
    <div className="plan-cell">
      <div className="plan-row">
        <div className="segmented" role="group" aria-label="Direction">
          {(['long', 'short'] as const).map((side) => (
            <button key={side} aria-pressed={cell.side === side} disabled={locked} onClick={() => update({ side })}>
              {side === 'long' ? 'Long' : 'Short'}
            </button>
          ))}
        </div>
        <NumberField label="Entry" tone="entry" value={cell.entry} disabled={locked} onChange={(entry) => update({ entry })} />
        <NumberField label="Stop" tone="stop" value={cell.stop} disabled={locked} onChange={(stop) => update({ stop })} />
        <NumberField label="Target" tone="target" value={cell.target} disabled={locked} onChange={(target) => update({ target })} />
        {last && !locked && (
          <button className="quiet" onClick={() => update({ entry: Number(last.close.toFixed(6)) })}>
            Use last price ({formatPrice(last.close)})
          </button>
        )}
      </div>

      {math ? (
        <dl className="plan-math">
          <div>
            <dt>Risk</dt>
            <dd>
              {formatPrice(math.risk)} <small>{formatPct(-math.risk / cell.entry!)}</small>
            </dd>
          </div>
          <div>
            <dt>Reward</dt>
            <dd>
              {formatPrice(math.reward)} <small>{formatPct(math.reward / cell.entry!)}</small>
            </dd>
          </div>
          <div>
            <dt>Reward for each 1 risked</dt>
            <dd className={math.rr >= 2 ? 'good' : math.rr < 1 ? 'bad' : ''}>{math.rr.toFixed(1)}</dd>
          </div>
        </dl>
      ) : (
        complete && problem && <p className="plan-problem">{problem}</p>
      )}

      <textarea
        className="reason"
        rows={2}
        value={cell.reason}
        disabled={locked}
        placeholder="Why this trade? What would prove you wrong?"
        onChange={(e) => update({ reason: e.target.value })}
      />
      {locked && <p className="lock-help">Plans lock once you've seen what happened. Hide it on the chart to edit.</p>}
      {outcome}
    </div>
  );
}
