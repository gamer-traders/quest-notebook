import { BlockNoteSchema, createHeadingBlockSpec, defaultBlockSpecs, defaultInlineContentSpecs } from '@blocknote/core';
import { ChartBlock, DrawingBlock, EmbedBlock, PredictionBlock, TradePlanBlock } from './ItemBlocks';
import { CalloutBlock } from './Callout';
import { CodeBlock } from './CodeBlock';
import { NotebookLink } from './NotebookLink';

// Tables, media, files, page breaks and toggle lists are left out: a notebook page doesn't hold them.
// Code blocks are the page's own, edited in Monaco (see CodeBlock).
const { paragraph, bulletListItem, numberedListItem, checkListItem, quote, divider } = defaultBlockSpecs;

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph,
    heading: createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: false }),
    bulletListItem,
    numberedListItem,
    checkListItem,
    quote,
    codeBlock: CodeBlock(),
    divider,
    callout: CalloutBlock(),
    chart: ChartBlock(),
    tradePlan: TradePlanBlock(),
    prediction: PredictionBlock(),
    drawing: DrawingBlock(),
    embed: EmbedBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    notebookLink: NotebookLink,
  },
});

export type PageEditor = typeof schema.BlockNoteEditor;
