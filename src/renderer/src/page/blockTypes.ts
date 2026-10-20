// Structural JSON, compatible with BlockNote's block output. Deliberately doesn't import BlockNote.

export interface StyledText {
  type: 'text';
  text: string;
  styles: Record<string, string | boolean>;
}

export interface LinkInline {
  type: 'link';
  href: string;
  content: StyledText[];
}

export interface NotebookLinkInline {
  type: 'notebookLink';
  props: { notebookId: string };
}

export type Inline = StyledText | LinkInline | NotebookLinkInline;

export interface PageBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children: PageBlock[];
}

/** Block types whose data lives in the notebook's `items`, keyed by block id. */
export const ITEM_BLOCK_TYPES = ['chart', 'tradePlan', 'prediction'] as const;

/** The block type that shows each kind of item data. */
export const ITEM_BLOCK_FOR = { chart: 'chart', plan: 'tradePlan', call: 'prediction' } as const;
