import type { CallCell, ChartCell, ItemData, Notebook, PlanCell } from '../types';
import { ITEM_BLOCK_FOR, ITEM_BLOCK_TYPES, type PageBlock } from './blockTypes';
import { displayTitle } from './tree';

/** Looks up a notebook's current title; null means the notebook was deleted. */
export type TitleOf = (notebookId: string) => string | null;

/** A TitleOf over these notebooks. A page with an empty title reads as Untitled, as it shows everywhere else. */
export function titleLookup(notebooks: Notebook[]): TitleOf {
  const titles = new Map(notebooks.map((nb) => [nb.id, displayTitle(nb.title)]));
  return (id) => titles.get(id) ?? null;
}

const isItemBlock = (b: PageBlock) => (ITEM_BLOCK_TYPES as readonly string[]).includes(b.type);

/** Every block in document order, each parent right before its children. */
export function flattenBlocks(blocks: PageBlock[]): PageBlock[] {
  return blocks.flatMap((b) => [b, ...flattenBlocks(b.children)]);
}

/** What a link to a notebook that no longer exists reads as. */
export const DELETED_NOTEBOOK = 'Deleted notebook';

/** The notebook a link points at. A link that names none, as in malformed saved data, is '': a deleted link. */
const linkTarget = (part: { props?: { notebookId?: unknown } }): string =>
  typeof part.props?.notebookId === 'string' ? part.props.notebookId : '';

const linkTitle = (targetId: string, titleOf: TitleOf): string => (targetId ? titleOf(targetId) : null) ?? DELETED_NOTEBOOK;

/** Plain text of inline content, with notebook links shown by their current title. */
export function inlineText(content: unknown, titleOf: TitleOf): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part?.type === 'text') return part.text ?? '';
      if (part?.type === 'link') return inlineText(part.content, titleOf);
      if (part?.type === 'notebookLink') return linkTitle(linkTarget(part), titleOf);
      return '';
    })
    .join('');
}

export function blockText(block: PageBlock, titleOf: TitleOf): string {
  return inlineText(block.content, titleOf);
}

/** Item blocks with data, in page order. */
function itemBlocks(nb: Notebook): { block: PageBlock; data: ItemData }[] {
  return flattenBlocks(nb.blocks)
    .filter(isItemBlock)
    .flatMap((block) => (nb.items[block.id] ? [{ block, data: nb.items[block.id] }] : []));
}

/** Item data in page order. Blocks whose data is missing are skipped. */
export function itemSequence(nb: Notebook): ItemData[] {
  return itemBlocks(nb).map((i) => i.data);
}

/** The nearest chart block before this block, in page order. */
export function chartBeforeBlock(nb: Notebook, blockId: string): ChartCell | null {
  let found: ChartCell | null = null;
  for (const b of flattenBlocks(nb.blocks)) {
    if (b.id === blockId) return found;
    const data = b.type === 'chart' ? nb.items[b.id] : undefined;
    if (data?.type === 'chart') found = data;
  }
  return null;
}

/** The chart an item sits under: chartBeforeBlock for the item's own block. */
export function chartAboveItem(nb: Notebook, itemId: string): ChartCell | null {
  return chartBeforeBlock(nb, itemId);
}

/** Plans and calls after a chart, up to the next chart. */
export function itemsUnderChart(nb: Notebook, chartId: string): (PlanCell | CallCell)[] {
  const out: (PlanCell | CallCell)[] = [];
  let inside = false;
  for (const { data } of itemBlocks(nb)) {
    if (data.type === 'chart') {
      if (inside) break;
      inside = data.id === chartId;
    } else if (inside) {
      out.push(data);
    }
  }
  return out;
}

/** Drops item data no block refers to. Returns nb itself when nothing is unreferenced. */
export function pruneItems(nb: Notebook): Notebook {
  const referenced = new Set(flattenBlocks(nb.blocks).filter(isItemBlock).map((b) => b.id));
  const entries = Object.entries(nb.items);
  const kept = entries.filter(([id]) => referenced.has(id));
  if (kept.length === entries.length) return nb;
  return { ...nb, items: Object.fromEntries(kept) };
}

/**
 * Pasting gives blocks new ids but keeps their props, so a pasted chart, plan or prediction still names
 * the item it was copied from. Returns a copy of that item, under the new block's id, for each such block.
 */
export function copiedItems(blocks: PageBlock[], items: Notebook['items'], findItem: (itemId: string) => ItemData | undefined): ItemData[] {
  return flattenBlocks(blocks).flatMap((b) => {
    if (!isItemBlock(b) || items[b.id] || typeof b.props.itemId !== 'string') return [];
    const source = findItem(b.props.itemId);
    return source && ITEM_BLOCK_FOR[source.type] === b.type ? [{ ...source, id: b.id }] : [];
  });
}

export interface LinkSite {
  targetId: string;
  blockId: string;
  sentence: string;
}

function sentenceWith(text: string, title: string): string {
  const hit = text.split(/(?<=[.!?])\s+/).find((s) => s.includes(title));
  return hit ?? text.slice(0, 160);
}

/** Every notebook link on the page, with the sentence it appears in. */
export function linksIn(nb: Notebook, titleOf: TitleOf): LinkSite[] {
  const sites: LinkSite[] = [];
  for (const block of flattenBlocks(nb.blocks)) {
    if (!Array.isArray(block.content)) continue;
    const text = blockText(block, titleOf);
    for (const part of block.content) {
      if (part?.type !== 'notebookLink') continue;
      const targetId = linkTarget(part);
      sites.push({ targetId, blockId: block.id, sentence: sentenceWith(text, linkTitle(targetId, titleOf)) });
    }
  }
  return sites;
}

/** Notebooks that link to the target, each once with its first link site. The target itself is left out. */
export function backlinksTo(
  notebooks: Notebook[],
  targetId: string,
  titleOf: TitleOf,
): { notebook: Notebook; blockId: string; sentence: string }[] {
  return notebooks
    .filter((n) => n.id !== targetId)
    .flatMap((notebook) => {
      const site = linksIn(notebook, titleOf).find((s) => s.targetId === targetId);
      return site ? [{ notebook, blockId: site.blockId, sentence: site.sentence }] : [];
    });
}
