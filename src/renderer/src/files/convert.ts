import type { FileBlock, FileCandle, FileChart, FileLook, FilePoint, PageFile } from '@shared/pageFile';
import { formatJson } from '@shared/formatJson';
import type { CallCell, ChartCell, DrawingCell, Interval, ItemData, MarkLook, Notebook, PlanCell } from '../types';
import { BACKGROUNDS, INK_COLORS, NEW_HEIGHT, PEN_TOOLS, SIZES, drawingFileName, type Stroke } from '../drawing/model';
import { decodePoints } from '../drawing/strokes';
import { drawingFromSvg, drawingToSvg } from '../drawing/svg';
import { SIDECAR_NAME } from '@shared/ipc';
import type { NotebookLinkInline, PageBlock } from '../page/blockTypes';
import type { Bar } from '../lib/market';
import { INTERVALS } from '../lib/market';
import { MARK_COLORS } from '../chart/palette';
import { nowSec, uid } from '../lib/cells';
import { inlineToMarkup, markupToInline } from './inline';

/*
  A page in memory (editor blocks, plus chart, plan and prediction data kept beside them) and a page file
  (blocks read top to bottom, with each chart's data inside its block) turned into each other.
*/

// ---- Times ----

const isoFromMs = (ms: number): string => new Date(Number.isFinite(ms) ? ms : 0).toISOString().replace(/\.000Z$/, 'Z');

export const isoFromSec = (sec: number): string => isoFromMs(sec * 1000);

/** Seconds from an ISO time. Unix seconds written as a number are taken as they are. NaN when unreadable. */
export function secFromIso(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;
  return Date.parse(value) / 1000;
}

// ---- Writing ----

type LinkText = (link: NotebookLinkInline) => string;

const BLOCK_TO_FILE: Record<string, FileBlock['type']> = {
  paragraph: 'paragraph',
  heading: 'heading',
  bulletListItem: 'bullet',
  numberedListItem: 'numbered',
  checkListItem: 'checklist',
  quote: 'quote',
  callout: 'callout',
  divider: 'divider',
  codeBlock: 'code',
};

const plainText = (content: unknown): string =>
  Array.isArray(content) ? content.map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('') : '';

function lookToFile(look: MarkLook): FileLook {
  return {
    ...(look.color ? { color: look.color } : {}),
    ...(look.line ? { line: look.line } : {}),
    ...(look.width ? { width: look.width } : {}),
    ...(look.note ? { note: look.note } : {}),
  };
}

const pointToFile = (p: { time: number; price: number }): FilePoint => ({ time: isoFromSec(p.time), price: p.price });

const candleToFile = (c: Bar): FileCandle => ({ time: isoFromSec(c.time), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });

function chartToFile(chart: ChartCell): Omit<FileChart, 'children'> {
  const custom = chart.source === 'custom';
  return {
    type: 'chart',
    id: chart.id,
    source: custom ? 'custom' : 'binance',
    symbol: chart.symbol,
    interval: chart.interval,
    frozenAt: isoFromSec(chart.asOf),
    revealed: chart.revealed,
    practice: chart.practice,
    levels: chart.levels.map((l) => ({ price: l.price, ...lookToFile(l) })),
    trendLines: chart.trends.map((t) => ({ from: pointToFile(t.a), to: pointToFile(t.b), ...lookToFile(t) })),
    pins: chart.pins.map((p) => ({ time: isoFromSec(p.time), text: p.text, ...(p.color ? { color: p.color } : {}) })),
    labels: (chart.texts ?? []).map((t) => ({ time: isoFromSec(t.time), price: t.price, text: t.text, ...(t.color ? { color: t.color } : {}) })),
    ...(custom
      ? {
          ...(chart.name !== undefined ? { name: chart.name } : {}),
          ...(chart.dated !== undefined ? { dated: chart.dated } : {}),
          candles: (chart.candles ?? []).map(candleToFile),
        }
      : {}),
  };
}

function itemToFile(item: ItemData): FileBlock {
  switch (item.type) {
    case 'chart':
      return chartToFile(item);
    case 'plan':
      return { type: 'tradePlan', id: item.id, side: item.side, entry: item.entry, stop: item.stop, target: item.target, reason: item.reason };
    case 'call':
      return { type: 'prediction', id: item.id, direction: item.direction, bars: item.bars, reason: item.reason };
    case 'drawing':
      // The strokes live in the drawing's own file; the page only points at it.
      return { type: 'drawing', id: item.id, file: drawingFileName(item.id) };
  }
}

function blockToFile(block: PageBlock, items: Notebook['items'], linkText: LinkText): FileBlock | null {
  const item = items[block.id];
  if (block.type === 'chart' || block.type === 'tradePlan' || block.type === 'prediction' || block.type === 'drawing') return item ? itemToFile(item) : null;
  const text = () => inlineToMarkup(block.content, linkText);
  switch (BLOCK_TO_FILE[block.type] ?? 'paragraph') {
    case 'heading': {
      const level = block.props.level;
      return { type: 'heading', level: level === 2 || level === 3 ? level : 1, text: text() };
    }
    case 'numbered':
      return { type: 'numbered', text: text(), ...(typeof block.props.start === 'number' ? { start: block.props.start } : {}) };
    case 'checklist':
      return { type: 'checklist', checked: block.props.checked === true, text: text() };
    case 'divider':
      return { type: 'divider' };
    case 'code':
      return { type: 'code', language: typeof block.props.language === 'string' ? block.props.language : 'text', code: plainText(block.content) };
    case 'bullet':
      return { type: 'bullet', text: text() };
    case 'quote':
      return { type: 'quote', text: text() };
    case 'callout':
      return { type: 'callout', text: text() };
    default:
      return { type: 'paragraph', text: text() };
  }
}

function blocksToFile(blocks: PageBlock[], items: Notebook['items'], linkText: LinkText): FileBlock[] {
  return blocks.flatMap((block) => {
    const children = blocksToFile(block.children, items, linkText);
    const file = blockToFile(block, items, linkText);
    // An item block whose data is gone is dropped, and anything nested in it moves up.
    if (!file) return children;
    return [children.length ? { ...file, children } : file];
  });
}

/** The page as its file holds it. `linkText` gives the words inside each page link's [[ ]]. */
export function pageToFile(nb: Notebook, linkText: LinkText): PageFile {
  return {
    id: nb.id,
    title: nb.title,
    position: nb.position,
    ...(nb.journalDate ? { journalDate: nb.journalDate } : {}),
    created: isoFromMs(nb.createdAt),
    updated: isoFromMs(nb.updatedAt),
    blocks: blocksToFile(nb.blocks, nb.items, linkText),
  };
}

// ---- Reading ----

export interface FileMeta {
  id: string;
  spaceId: string;
  parentId: string | null;
  /** The file's path relative to the workspace folder. */
  path: string;
  /** When the file last changed: the times a page without its own take. */
  fileTimeMs: number;
  /** Where a page without a position goes among its siblings. */
  fallbackPosition: number;
}

type Raw = Record<string, unknown>;

const isRaw = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isRaw) : []);
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | undefined => values.find((x) => x === v);

function lookFromFile(raw: Raw): MarkLook {
  const color = oneOf(raw.color, MARK_COLORS);
  const line = oneOf(raw.line, ['solid', 'dashed', 'dotted'] as const);
  const width = oneOf(raw.width, ['thin', 'normal', 'thick'] as const);
  return {
    ...(color ? { color } : {}),
    ...(line ? { line } : {}),
    ...(width ? { width } : {}),
    ...(typeof raw.note === 'string' && raw.note ? { note: raw.note } : {}),
  };
}

const pointFromFile = (raw: unknown): { time: number; price: number } | null => {
  if (!isRaw(raw)) return null;
  const time = secFromIso(raw.time);
  const price = num(raw.price);
  return Number.isFinite(time) && price !== null ? { time, price } : null;
};

function chartFromFile(raw: Raw, id: string): ChartCell {
  const asOf = secFromIso(raw.frozenAt);
  const custom = raw.source === 'custom';
  const pins = list(raw.pins).flatMap((p) => {
    const time = secFromIso(p.time);
    const color = oneOf(p.color, MARK_COLORS);
    return Number.isFinite(time) ? [{ id: uid(), time, text: str(p.text), ...(color ? { color } : {}) }] : [];
  });
  const texts = list(raw.labels).flatMap((t) => {
    const time = secFromIso(t.time);
    const price = num(t.price);
    const color = oneOf(t.color, MARK_COLORS);
    return Number.isFinite(time) && price !== null ? [{ id: uid(), time, price, text: str(t.text), ...(color ? { color } : {}) }] : [];
  });
  const candles = list(raw.candles).flatMap((c): Bar[] => {
    const time = secFromIso(c.time);
    const [open, high, low, close] = [num(c.open), num(c.high), num(c.low), num(c.close)];
    if (!Number.isFinite(time) || open === null || high === null || low === null || close === null) return [];
    return [{ time, open, high, low, close, volume: num(c.volume) ?? 0 }];
  });
  return {
    id,
    type: 'chart',
    symbol: str(raw.symbol, 'BTCUSDT'),
    interval: oneOf<Interval>(raw.interval, INTERVALS) ?? '1d',
    asOf: Number.isFinite(asOf) ? asOf : nowSec(),
    revealed: raw.revealed === true,
    practice: raw.practice === true,
    levels: list(raw.levels).flatMap((l) => {
      const price = num(l.price);
      return price === null ? [] : [{ id: uid(), price, ...lookFromFile(l) }];
    }),
    trends: list(raw.trendLines).flatMap((t) => {
      const a = pointFromFile(t.from);
      const b = pointFromFile(t.to);
      return a && b ? [{ id: uid(), a, b, ...lookFromFile(t) }] : [];
    }),
    pins,
    ...(texts.length ? { texts } : {}),
    ...(custom
      ? {
          source: 'custom' as const,
          ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
          ...(typeof raw.dated === 'boolean' ? { dated: raw.dated } : {}),
          candles,
        }
      : {}),
  };
}

function planFromFile(raw: Raw, id: string): PlanCell {
  return { id, type: 'plan', side: raw.side === 'short' ? 'short' : 'long', entry: num(raw.entry), stop: num(raw.stop), target: num(raw.target), reason: str(raw.reason) };
}

function callFromFile(raw: Raw, id: string): CallCell {
  const bars = num(raw.bars);
  return { id, type: 'call', direction: raw.direction === 'down' ? 'down' : 'up', bars: bars !== null && bars >= 1 ? Math.round(bars) : 10, reason: str(raw.reason) };
}

/** Strokes kept inside the page, as drawings were saved before they had files of their own. */
function inlineDrawing(raw: Raw, id: string): DrawingCell {
  const height = num(raw.height);
  const strokes = list(raw.strokes).flatMap((s): Stroke[] => {
    const points = decodePoints(str(s.points));
    if (points.length === 0) return [];
    const tool = oneOf(s.tool, PEN_TOOLS) ?? 'pen';
    const size = num(s.size);
    return [{ id: uid(), tool, color: oneOf(s.color, INK_COLORS) ?? 'ink', size: size !== null && size > 0 ? size : SIZES[tool][1], pressure: s.pressure !== false, points }];
  });
  return { id, type: 'drawing', height: height !== null && height > 0 ? height : NEW_HEIGHT, background: oneOf(raw.background, BACKGROUNDS) ?? 'blank', strokes };
}

/** What reading a page's drawings needs: their files' text, and where to note the drawings that need writing. */
interface DrawingContext {
  files: Record<string, string>;
  toWrite: Set<string>;
  movedOut: boolean;
}

/**
 * A drawing read from its file in the page's folder. A file written by hand, or missing, or strokes still
 * inside the page, are read as well as can be, and the drawing is noted for writing in the app's own form.
 */
function drawingFromFile(raw: Raw, id: string, ctx: DrawingContext): DrawingCell {
  const named = typeof raw.file === 'string' && SIDECAR_NAME.test(raw.file) ? raw.file : drawingFileName(id);
  const text = ctx.files[named] ?? ctx.files[drawingFileName(id)];
  const read = text === undefined ? null : drawingFromSvg(text);
  if (read) {
    const drawing: DrawingCell = { id, type: 'drawing', ...read };
    if (drawingToSvg(drawing) !== text || named !== drawingFileName(id)) ctx.toWrite.add(id);
    return drawing;
  }
  ctx.toWrite.add(id);
  if (Array.isArray(raw.strokes)) {
    ctx.movedOut = true;
    return inlineDrawing(raw, id);
  }
  return { id, type: 'drawing', height: NEW_HEIGHT, background: 'blank', strokes: [] };
}

const textContent = (text: string) => (text ? [{ type: 'text' as const, text, styles: {} }] : []);

function blocksFromFile(rawBlocks: unknown, items: Record<string, ItemData>, ctx: DrawingContext): PageBlock[] {
  return list(rawBlocks).map((raw): PageBlock => {
    const children = blocksFromFile(raw.children, items, ctx);
    const textBlock = (type: string, props: Record<string, unknown> = {}): PageBlock => ({
      id: uid(),
      type,
      props,
      content: markupToInline(str(raw.text)),
      children,
    });
    const itemBlock = (type: string, make: (raw: Raw, id: string) => ItemData): PageBlock => {
      // A chart, plan or prediction keeps its id, unless another one on the page already has it.
      const id = typeof raw.id === 'string' && raw.id && !items[raw.id] ? raw.id : uid();
      items[id] = make(raw, id);
      return { id, type, props: { itemId: id }, children };
    };
    switch (raw.type) {
      case 'paragraph':
        return textBlock('paragraph');
      case 'heading':
        return textBlock('heading', { level: raw.level === 2 || raw.level === 3 ? raw.level : 1 });
      case 'bullet':
        return textBlock('bulletListItem');
      case 'numbered':
        return textBlock('numberedListItem', num(raw.start) !== null ? { start: raw.start } : {});
      case 'checklist':
        return textBlock('checkListItem', { checked: raw.checked === true });
      case 'quote':
        return textBlock('quote');
      case 'callout':
        return textBlock('callout');
      case 'divider':
        return { id: uid(), type: 'divider', props: {}, children };
      case 'code':
        return { id: uid(), type: 'codeBlock', props: { language: str(raw.language, 'text') }, content: textContent(str(raw.code)), children };
      case 'chart':
        return itemBlock('chart', chartFromFile);
      case 'tradePlan':
        return itemBlock('tradePlan', planFromFile);
      case 'prediction':
        return itemBlock('prediction', callFromFile);
      case 'drawing':
        return itemBlock('drawing', (r, id) => drawingFromFile(r, id, ctx));
      default:
        // Nothing is lost: a block the app doesn't know is shown, and saved, as its own JSON.
        return { id: uid(), type: 'codeBlock', props: { language: 'json' }, content: textContent(formatJson(raw).trim()), children };
    }
  });
}

const baseName = (path: string) => (path.split('/').at(-1) ?? path).replace(/\.json$/i, '');

/**
 * A page read from its file. Throws when the file isn't a page at all. Fields that are missing are filled
 * in, and `repaired` says so, so the file can be written back whole.
 */
export function fileToPage(
  raw: unknown,
  meta: FileMeta,
  drawingFiles: Record<string, string> = {},
): { notebook: Notebook; repaired: boolean; drawingsToWrite: Set<string> } {
  if (!isRaw(raw) || !Array.isArray(raw.blocks)) throw new Error('This file is not a page: a page is a JSON object with a "blocks" list.');
  let repaired = false;
  const fill = <T,>(value: T | null, fallback: T): T => {
    if (value !== null) return value;
    repaired = true;
    return fallback;
  };
  const ms = (value: unknown): number | null => {
    const sec = secFromIso(value);
    return Number.isFinite(sec) ? Math.round(sec * 1000) : null;
  };

  const items: Record<string, ItemData> = {};
  const ctx: DrawingContext = { files: drawingFiles, toWrite: new Set(), movedOut: false };
  const blocks = blocksFromFile(raw.blocks, items, ctx);
  if (ctx.movedOut) repaired = true;
  const journalDate = typeof raw.journalDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.journalDate) ? raw.journalDate : undefined;
  const notebook: Notebook = {
    id: meta.id,
    title: fill(typeof raw.title === 'string' ? raw.title : null, baseName(meta.path)),
    spaceId: meta.spaceId,
    parentId: meta.parentId,
    position: fill(num(raw.position), meta.fallbackPosition),
    ...(journalDate ? { journalDate } : {}),
    createdAt: fill(ms(raw.created), meta.fileTimeMs),
    updatedAt: fill(ms(raw.updated), meta.fileTimeMs),
    blocks,
    items,
    path: meta.path,
  };
  return { notebook, repaired, drawingsToWrite: ctx.toWrite };
}
