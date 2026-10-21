import type { ReactNode, SyntheticEvent } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { useShallow } from 'zustand/react/shallow';
import type { CallCell, ChartCell, ItemData, Notebook, PlanCell } from '../types';
import { chartAboveItem, itemsUnderChart } from '../page/blocks';
import { chartTitle } from '../lib/cells';
import { useStore } from '../store';
import { ChartCellView } from '../cells/ChartCellView';
import { PlanCellView } from '../cells/PlanCellView';
import { CallCellView } from '../cells/CallCellView';
import { useNotebookId } from './NotebookContext';

// Chart, trade plan and prediction blocks hold only an id. Their data lives in the notebook's
// items, so chart edits never touch the document and typing never redraws a chart.
const itemProps = { itemId: { default: '' } } as const;

const NONE: (PlanCell | CallCell)[] = [];

// Keep the page editor out of what happens inside a block: pans and clicks would select text or
// start a block drag, and typing would fire its shortcuts. The side-menu handle still drags it.
const stop = (e: SyntheticEvent) => e.stopPropagation();

function ItemFrame({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <div
      className={`item-block item-${kind}`}
      contentEditable={false}
      onMouseDown={stop}
      onPointerDown={stop}
      onKeyDown={stop}
      onPaste={stop}
      onDragStart={stop}
    >
      {children}
    </div>
  );
}

const Missing = () => <p className="item-missing">This block's data is missing</p>;

const findNotebook = (notebooks: Notebook[], id: string) => notebooks.find((n) => n.id === id);

/** A block's data, under its id. Pasted blocks are pointed at their own copy as they land (see itemExtension). */
function useItem(blockId: string): ItemData | undefined {
  const notebookId = useNotebookId();
  return useStore((s) => findNotebook(s.notebooks, notebookId)?.items[blockId]);
}

function ChartBlockView({ blockId }: { blockId: string }) {
  const notebookId = useNotebookId();
  const data = useItem(blockId);
  const linked = useStore(
    useShallow((s) => {
      const nb = findNotebook(s.notebooks, notebookId);
      return nb ? itemsUnderChart(nb, blockId) : NONE;
    }),
  );
  if (data?.type !== 'chart') return <Missing />;
  return <ChartCellView notebookId={notebookId} cell={data} linked={linked} />;
}

function useChartAbove(blockId: string): ChartCell | null {
  const notebookId = useNotebookId();
  return useStore((s) => {
    const nb = findNotebook(s.notebooks, notebookId);
    return nb ? chartAboveItem(nb, blockId) : null;
  });
}

function PlanBlockView({ blockId }: { blockId: string }) {
  const notebookId = useNotebookId();
  const data = useItem(blockId);
  const chart = useChartAbove(blockId);
  if (data?.type !== 'plan') return <Missing />;
  return <PlanCellView notebookId={notebookId} cell={data} chart={chart} />;
}

function CallBlockView({ blockId }: { blockId: string }) {
  const notebookId = useNotebookId();
  const data = useItem(blockId);
  const chart = useChartAbove(blockId);
  if (data?.type !== 'call') return <Missing />;
  return <CallCellView notebookId={notebookId} cell={data} chart={chart} />;
}

/** What a copied block becomes outside the app: one line of text instead of a dead chart. */
function ItemSummary({ blockId, label }: { blockId: string; label: string }) {
  const data = useItem(blockId);
  const detail = !data || data.type === 'drawing' ? '' : data.type === 'chart' ? chartTitle(data) : data.reason;
  return <p>{detail ? `${label}: ${detail}` : label}</p>;
}

export const ChartBlock = createReactBlockSpec(
  { type: 'chart', propSchema: itemProps, content: 'none' },
  {
    render: ({ block }) => (
      <ItemFrame kind="chart">
        <ChartBlockView blockId={block.id} />
      </ItemFrame>
    ),
    toExternalHTML: ({ block }) => <ItemSummary blockId={block.id} label="Chart" />,
  },
);

export const TradePlanBlock = createReactBlockSpec(
  { type: 'tradePlan', propSchema: itemProps, content: 'none' },
  {
    render: ({ block }) => (
      <ItemFrame kind="plan">
        <PlanBlockView blockId={block.id} />
      </ItemFrame>
    ),
    toExternalHTML: ({ block }) => <ItemSummary blockId={block.id} label="Trade plan" />,
  },
);

export const PredictionBlock = createReactBlockSpec(
  { type: 'prediction', propSchema: itemProps, content: 'none' },
  {
    render: ({ block }) => (
      <ItemFrame kind="call">
        <CallBlockView blockId={block.id} />
      </ItemFrame>
    ),
    toExternalHTML: ({ block }) => <ItemSummary blockId={block.id} label="Prediction" />,
  },
);
