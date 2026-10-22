import type { ChatReference } from '@shared/ipc';
import type { FileBlock } from '@shared/pageFile';
import { formatJson } from '@shared/formatJson';
import type { NotebookLinkInline, PageBlock } from '../page/blockTypes';
import type { Notebook } from '../types';
import { pageToFile } from '../files/convert';
import { markupToInline } from '../files/inline';
import { displayTitle } from '../page/tree';

/*
  Blocks of a page attached to a message for Claude: the blocks as the page file holds them, and where they sit
  on the page, in words.
*/

type LinkText = (link: NotebookLinkInline) => string;

export type BlockReference = Extract<ChatReference, { kind: 'block' }>;

/** Main refuses a block reference longer than this, as it counts it, in UTF-16 units. */
export const MAX_BLOCK_TEXT = 50_000;

/** Where a block is in the page file. */
interface Place {
  block: PageBlock;
  /** 0 for a block in the page's own list, 1 inside one of those, and so on. */
  depth: number;
  /** The place, from 1, of the block in the page's own list that holds it, or that it is. */
  top: number;
  /** Ids of the blocks it's inside. */
  inside: string[];
}

// formatJson's line width. A block sits indented in its file, so it's laid out for what's left of a line there.
const FILE_WIDTH = 120;
// In the file, `{ "blocks": [` puts a page's own blocks 4 spaces in, and each level of `"children": [` 4 more.
const indentAt = (depth: number) => 4 + 4 * depth;

/**
 * The blocks with these ids as one reference: their JSON just as the page file has it (one object, or a list for
 * several, in page order), and where they are: "block 4 of 12", "blocks 3–5 of 12", "inside block 2 of 12".
 * Null when none of them is written to the file.
 */
export function blockReference(page: Notebook, ids: readonly string[], linkText: LinkText): BlockReference | null {
  // Each block written alone is written as in the whole page: blocks don't depend on each other.
  const fileOf = (block: PageBlock): FileBlock[] => pageToFile({ ...page, blocks: [block] }, linkText).blocks;

  const places: Place[] = [];
  let count = 0;
  const walk = (blocks: PageBlock[], depth: number, top: number | null, inside: string[]) => {
    for (const block of blocks) {
      const within = [...inside, block.id];
      // A chart, plan, prediction or drawing whose data is gone isn't written, and what's nested in it moves up.
      if (fileOf({ ...block, children: [] }).length === 0) {
        walk(block.children, depth, top, within);
        continue;
      }
      const at = top ?? ++count;
      places.push({ block, depth, top: at, inside });
      walk(block.children, depth + 1, at, within);
    }
  };
  walk(page.blocks, 0, null, []);

  const wanted = new Set(ids);
  const chosen = places.filter((p) => wanted.has(p.block.id));
  const picked = new Set(chosen.map((p) => p.block.id));
  // A block inside another one chosen comes with it.
  const blocks = chosen.filter((p) => !p.inside.some((id) => picked.has(id)));
  if (blocks.length === 0) return null;

  const json = (p: Place) => formatJson(fileOf(p.block)[0], FILE_WIDTH - indentAt(p.depth)).trimEnd();
  const text = blocks.length === 1 ? json(blocks[0]) : `[\n${blocks.map((p) => json(p).replace(/^/gm, '  ')).join(',\n')}\n]`;

  const first = Math.min(...blocks.map((p) => p.top));
  const last = Math.max(...blocks.map((p) => p.top));
  const where =
    first !== last ? `blocks ${first}–${last} of ${count}` : blocks[0].depth > 0 ? `inside block ${first} of ${count}` : `block ${first} of ${count}`;
  return { kind: 'block', pageId: page.id, title: displayTitle(page.title), text, where };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const words = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A block's words without their marks: links by their words, page links by the title written. */
function plain(markup: string): string {
  return markupToInline(markup)
    .map((part) => (part.type === 'text' ? part.text : part.type === 'link' ? part.content.map((c) => c.text).join('') : (part.props.target ?? '')))
    .join('');
}

const SHOWN = 40;

/** What a block is, when it has no words: "trading chart BTCUSDT 4h", "tradePlan long". */
function kindOf(block: Record<string, unknown>): string {
  const type = words(block.type);
  const name = type === 'chart' ? 'trading chart' : type;
  const detail =
    type === 'chart' ? [words(block.name) || words(block.symbol), words(block.interval)] : type === 'tradePlan' ? [words(block.side)] : type === 'prediction' ? [words(block.direction)] : [];
  return [name, ...detail].filter(Boolean).join(' ');
}

/** A block reference's chip: "Block: " and its first words, or what it is. Several go by the first. */
export function blockLabel(text: string): string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return 'Block';
  }
  const list = Array.isArray(value) ? value : [value];
  const first = list[0];
  if (!isRecord(first)) return 'Block';
  const said = (typeof first.text === 'string' ? plain(first.text) : words(first.code)).replace(/\s+/g, ' ').trim();
  const shown = said ? (said.length > SHOWN ? `${said.slice(0, SHOWN).trimEnd()}…` : said) : kindOf(first);
  const head = list.length > 1 ? 'Blocks' : 'Block';
  return shown ? `${head}: ${shown}` : head;
}
