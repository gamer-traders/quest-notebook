import { expect, test } from 'vitest';
import type { FileChart, PageFile } from '@shared/pageFile';
import { formatJson } from '@shared/formatJson';
import type { ChartCell, DrawingCell, Notebook } from '../types';
import type { PageBlock } from '../page/blockTypes';
import { seedNotebooks } from '../lib/seed';
import { newChart } from '../lib/cells';
import { fileToPage, isoFromSec, pageToFile, secFromIso } from './convert';

const writeTarget = () => 'Target';
const meta = (nb: Pick<Notebook, 'id' | 'spaceId' | 'parentId'>, path = 'Markets/Page.json') => ({
  id: nb.id,
  spaceId: nb.spaceId,
  parentId: nb.parentId,
  path,
  fileTimeMs: Date.UTC(2026, 9, 20),
  fallbackPosition: 7,
});

/** Text blocks and chart marks get fresh ids on every load, so comparisons leave them out. */
function stripIds(nb: Notebook): Notebook {
  const blocks = (list: PageBlock[]): PageBlock[] =>
    list.map((b) => ({ ...b, id: nb.items[b.id] ? b.id : '', children: blocks(b.children) }));
  const items = Object.fromEntries(
    Object.entries(nb.items).map(([id, item]) => {
      if (item.type !== 'chart') return [id, item];
      const blank = <T extends { id: string }>(marks: T[] | undefined) => marks?.map((m) => ({ ...m, id: '' }));
      return [id, { ...item, levels: blank(item.levels)!, trends: blank(item.trends)!, pins: blank(item.pins)!, texts: blank(item.texts) }];
    }),
  );
  return { ...nb, blocks: blocks(nb.blocks), items };
}

test('every sample page round-trips', () => {
  for (const nb of seedNotebooks()) {
    const file = pageToFile(nb, writeTarget);
    const back = fileToPage(JSON.parse(formatJson(file)), meta(nb)).notebook;
    expect(stripIds(back)).toEqual(stripIds({ ...nb, path: 'Markets/Page.json' }));
  }
});

test('the page fields read plainly', () => {
  const nb: Notebook = { id: 'n1', title: 'Levels', spaceId: 's', parentId: null, position: 2, journalDate: '2026-10-20', createdAt: Date.UTC(2026, 9, 20, 9, 14), updatedAt: Date.UTC(2026, 9, 20, 11, 2), blocks: [], items: {} };
  expect(pageToFile(nb, writeTarget)).toEqual({
    id: 'n1', title: 'Levels', position: 2, journalDate: '2026-10-20', created: '2026-10-20T09:14:00Z', updated: '2026-10-20T11:02:00Z', blocks: [],
  });
});

test('chart times are ISO and marks have no ids', () => {
  const chart: ChartCell = {
    ...newChart({ asOf: 1730073600 }),
    levels: [{ id: 'l1', price: 70000, color: 'red', note: 'top' }],
    trends: [{ id: 't1', a: { time: 1725580800, price: 52550 }, b: { time: 1728518400, price: 58946 } }],
    pins: [{ id: 'p1', time: 1722816000, text: 'Wick' }],
    texts: [{ id: 'x1', time: 1722816000, price: 50000, text: 'Low' }],
  };
  const nb: Notebook = { id: 'n1', title: 'C', spaceId: 's', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [{ id: chart.id, type: 'chart', props: { itemId: chart.id }, children: [] }], items: { [chart.id]: chart } };
  const block = pageToFile(nb, writeTarget).blocks[0] as FileChart;
  expect(block).toEqual({
    type: 'chart', id: chart.id, source: 'binance', symbol: 'BTCUSDT', interval: '1d', frozenAt: '2024-10-28T00:00:00Z', revealed: false, practice: false,
    levels: [{ price: 70000, color: 'red', note: 'top' }],
    trendLines: [{ from: { time: '2024-09-06T00:00:00Z', price: 52550 }, to: { time: '2024-10-10T00:00:00Z', price: 58946 } }],
    pins: [{ time: '2024-08-05T00:00:00Z', text: 'Wick' }],
    labels: [{ time: '2024-08-05T00:00:00Z', price: 50000, text: 'Low' }],
  });
});

test('custom charts keep their name, dates flag and candles', () => {
  const chart: ChartCell = { ...newChart({ asOf: 946944000 }), source: 'custom', name: 'Mine', dated: false, candles: [{ time: 946857600, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 }] };
  const nb: Notebook = { id: 'n1', title: 'C', spaceId: 's', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [{ id: chart.id, type: 'chart', props: { itemId: chart.id }, children: [] }], items: { [chart.id]: chart } };
  const file = pageToFile(nb, writeTarget);
  expect(file.blocks[0]).toMatchObject({ source: 'custom', name: 'Mine', dated: false, candles: [{ time: '2000-01-03T00:00:00Z', open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 }] });
  const back = fileToPage(file, meta(nb)).notebook.items[chart.id] as ChartCell;
  expect(back).toMatchObject({ source: 'custom', name: 'Mine', dated: false, candles: chart.candles, asOf: 946944000 });
});

const textBlock = (type: string, props: Record<string, unknown>, text: string, children: PageBlock[] = []): PageBlock => ({
  id: 'b', type, props, content: text ? [{ type: 'text', text, styles: {} }] : [], children,
});

test('editor blocks map to plain block types', () => {
  const nb: Notebook = {
    id: 'n1', title: 'T', spaceId: 's', parentId: null, position: 0, createdAt: 0, updatedAt: 0, items: {},
    blocks: [
      textBlock('heading', { level: 3, textColor: 'default' }, 'H'),
      textBlock('bulletListItem', {}, 'B', [textBlock('numberedListItem', { start: 4 }, 'N')]),
      textBlock('checkListItem', { checked: true }, 'C'),
      textBlock('quote', {}, 'Q'),
      textBlock('callout', {}, 'Note'),
      { id: 'd', type: 'divider', props: {}, children: [] },
      textBlock('codeBlock', { language: 'python' }, 'x = 1\n  y = *2*'),
    ],
  };
  expect(pageToFile(nb, writeTarget).blocks).toEqual([
    { type: 'heading', level: 3, text: 'H' },
    { type: 'bullet', text: 'B', children: [{ type: 'numbered', start: 4, text: 'N' }] },
    { type: 'checklist', checked: true, text: 'C' },
    { type: 'quote', text: 'Q' },
    { type: 'callout', text: 'Note' },
    { type: 'divider' },
    { type: 'code', language: 'python', code: 'x = 1\n  y = *2*' },
  ]);
  const back = fileToPage(pageToFile(nb, writeTarget), meta(nb)).notebook.blocks;
  expect(back.map((b) => [b.type, b.props])).toEqual([
    ['heading', { level: 3 }],
    ['bulletListItem', {}],
    ['checkListItem', { checked: true }],
    ['quote', {}],
    ['callout', {}],
    ['divider', {}],
    ['codeBlock', { language: 'python' }],
  ]);
  expect(back[1].children[0]).toMatchObject({ type: 'numberedListItem', props: { start: 4 } });
  expect(back[6].content).toEqual([{ type: 'text', text: 'x = 1\n  y = *2*', styles: {} }]);
});

test('a block type the app does not know is kept as a code block holding its JSON', () => {
  const raw = { id: 'n1', title: 'T', position: 0, created: '2026-10-20T00:00:00Z', updated: '2026-10-20T00:00:00Z', blocks: [{ type: 'table', rows: 2 }] };
  const [block] = fileToPage(raw, meta({ id: 'n1', spaceId: 's', parentId: null })).notebook.blocks;
  expect(block).toMatchObject({ type: 'codeBlock', props: { language: 'json' }, content: [{ type: 'text', text: formatJson({ type: 'table', rows: 2 }).trim(), styles: {} }] });
});

test('missing fields are filled in, and the page says it was repaired', () => {
  const { notebook, repaired } = fileToPage({ blocks: [{ type: 'paragraph', text: 'Hi' }] }, meta({ id: 'n9', spaceId: 's', parentId: 'p' }, 'Markets/Weekly levels.json'));
  expect(repaired).toBe(true);
  expect(notebook).toMatchObject({ id: 'n9', title: 'Weekly levels', position: 7, spaceId: 's', parentId: 'p', createdAt: Date.UTC(2026, 9, 20), updatedAt: Date.UTC(2026, 9, 20) });
  const whole = pageToFile({ ...notebook }, writeTarget);
  expect(fileToPage(whole, meta(notebook)).repaired).toBe(false);
});

test('an item block without an id gets one, and its data is filed under it', () => {
  const raw: Partial<PageFile> = { blocks: [{ type: 'prediction', direction: 'down', bars: 3, reason: 'Lower highs' } as never] };
  const { notebook } = fileToPage(raw, meta({ id: 'n1', spaceId: 's', parentId: null }));
  const [block] = notebook.blocks;
  expect(block.id).toMatch(/\S+/);
  expect(block.props.itemId).toBe(block.id);
  expect(notebook.items[block.id]).toEqual({ id: block.id, type: 'call', direction: 'down', bars: 3, reason: 'Lower highs' });
});

test('a file that is not a page throws', () => {
  expect(() => fileToPage('x', meta({ id: 'n1', spaceId: 's', parentId: null }))).toThrow();
  expect(() => fileToPage({ blocks: 1 }, meta({ id: 'n1', spaceId: 's', parentId: null }))).toThrow();
  expect(() => fileToPage(null, meta({ id: 'n1', spaceId: 's', parentId: null }))).toThrow();
});

test('times convert both ways, and unix seconds written by hand are accepted', () => {
  expect(isoFromSec(1730073600)).toBe('2024-10-28T00:00:00Z');
  expect(secFromIso('2024-10-28T00:00:00Z')).toBe(1730073600);
  expect(secFromIso('2024-10-28T00:00:00.500Z')).toBe(1730073600.5);
  expect(secFromIso(1730073600)).toBe(1730073600);
  expect(secFromIso('nonsense')).toBeNaN();
});

const drawingPage = (item: DrawingCell): Notebook => ({
  id: 'n1', title: 'D', spaceId: 's', parentId: null, position: 0, createdAt: 0, updatedAt: 0,
  blocks: [{ id: item.id, type: 'drawing', props: { itemId: item.id }, children: [] }],
  items: { [item.id]: item },
});

test('a drawing is written as strokes on one line each, and read back', () => {
  const item: DrawingCell = {
    id: 'd1', type: 'drawing', height: 420, background: 'grid',
    strokes: [{ id: 's1', tool: 'pen', color: 'ink', size: 3, pressure: true, points: [1.5, 2, 0.4, 3, 4, 0.6] }],
  };
  const file = pageToFile(drawingPage(item), writeTarget);
  expect(file.blocks).toEqual([
    { type: 'drawing', id: 'd1', height: 420, background: 'grid', strokes: [{ tool: 'pen', color: 'ink', size: 3, pressure: true, points: '1.5,2,0.4 3,4,0.6' }] },
  ]);
  expect(formatJson(file)).toContain('"points": "1.5,2,0.4 3,4,0.6" }');
  const back = fileToPage(file, meta({ id: 'n1', spaceId: 's', parentId: null })).notebook.items.d1 as DrawingCell;
  expect({ ...back, strokes: back.strokes.map((s) => ({ ...s, id: '' })) }).toEqual({ ...item, strokes: [{ ...item.strokes[0], id: '' }] });
});

test('a drawing written by hand is read with defaults, and strokes without points are dropped', () => {
  const raw = {
    blocks: [{ type: 'drawing', id: 'd2', strokes: [{ tool: 'brush', color: 'teal', size: 'big', points: '10,10 20,20,0.9' }, { tool: 'pen', points: 'nope' }] }],
  };
  const d = fileToPage(raw, meta({ id: 'n1', spaceId: 's', parentId: null })).notebook.items.d2 as DrawingCell;
  expect(d).toMatchObject({ type: 'drawing', height: 400, background: 'blank' });
  expect(d.strokes).toHaveLength(1);
  expect(d.strokes[0]).toMatchObject({ tool: 'pen', color: 'ink', size: 3, pressure: true, points: [10, 10, 0.5, 20, 20, 0.9] });
});
