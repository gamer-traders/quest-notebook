import { createElement } from 'react';
import { getNodeById, insertOrUpdateBlockForSlashMenu } from '@blocknote/core';
import { SuggestionMenu } from '@blocknote/core/extensions';
import { getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from '@blocknote/react';
import { ITEM_BLOCK_FOR, type PageBlock } from '../page/blockTypes';
import { chartBeforeBlock } from '../page/blocks';
import { newItem } from '../lib/cells';
import { useStore } from '../store';
import { usePen } from '../drawing/penSettings';
import { LINK_TRIGGER } from './inlineRules';
import type { PageEditor } from './schema';

// Line icons drawn like the menu's own: on a 24-unit grid, in the text colour.
const icon = (d: string) =>
  createElement(
    'svg',
    { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    createElement('path', { d }),
  );

const ICONS = {
  chart: icon('M7 3v4M5 7h4v8H5zM7 15v6M17 3v3M15 6h4v7h-4zM17 13v8'),
  plan: icon('M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 2v5M12 17v5M2 12h5M17 12h5'),
  call: icon('M4 17l6-6 4 4 6-7M15 8h5v5'),
  drawing: icon('M4 20l4-1 10-10-3-3L5 16zM14 7l3 3M14 20c2-2 4-1 6-3'),
  callout: icon('M4 5h16v11H10l-4 3.5V16H4zM8 9.5h8M8 12.5h5'),
  link: icon('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'),
};

const ITEM_GROUP = 'Charts, trades and drawings';

/** Files a new chart, plan or prediction under the notebook, then puts its block at the caret. */
function insertItem(editor: PageEditor, notebookId: string, kind: keyof typeof ITEM_BLOCK_FOR) {
  const { notebooks, addItem } = useStore.getState();
  const nb = notebooks.find((n) => n.id === notebookId);
  if (!nb) return;
  // The editor's own blocks, as the store only gets them a moment after typing stops.
  const page = { ...nb, blocks: editor.document as unknown as PageBlock[] };
  const item = newItem(kind, chartBeforeBlock(page, editor.getTextCursorPosition().block.id), usePen.getState().background);
  addItem(notebookId, item);

  editor.transact((tr) => {
    const block = insertOrUpdateBlockForSlashMenu(editor, { type: ITEM_BLOCK_FOR[kind], props: { itemId: item.id }, id: item.id });
    // A line holding only the '/' becomes the block and keeps the line's id, but the block's id must be its item's.
    const line = block.id === item.id ? undefined : getNodeById(block.id, tr.doc);
    if (line) tr.setNodeAttribute(line.posBeforeNode, 'id', item.id);
  });
}

/** The / menu: charts, plans and predictions first, then the text blocks a page holds, with a callout and a notebook link. */
export function pageSlashItems(editor: PageEditor, notebookId: string): DefaultReactSuggestionItem[] {
  const dict = editor.dictionary.slash_menu;

  const items: DefaultReactSuggestionItem[] = [
    {
      title: 'Trading chart',
      subtext: 'Candles to study and mark up',
      aliases: ['trading', 'chart', 'candles', 'price', 'graph'],
      group: ITEM_GROUP,
      icon: ICONS.chart,
      onItemClick: () => insertItem(editor, notebookId, 'chart'),
    },
    {
      title: 'Trade plan',
      subtext: 'Entry, stop and target, tested on the trading chart above',
      aliases: ['plan', 'trade', 'entry', 'stop', 'target'],
      group: ITEM_GROUP,
      icon: ICONS.plan,
      onItemClick: () => insertItem(editor, notebookId, 'plan'),
    },
    {
      title: 'Prediction',
      subtext: 'Up or down, checked on the trading chart above',
      aliases: ['prediction', 'call', 'forecast', 'guess'],
      group: ITEM_GROUP,
      icon: ICONS.call,
      onItemClick: () => insertItem(editor, notebookId, 'call'),
    },
    {
      title: 'Drawing',
      subtext: 'Handwriting and sketches, with pen pressure',
      aliases: ['drawing', 'draw', 'sketch', 'ink', 'pen', 'handwriting', 'whiteboard'],
      group: ITEM_GROUP,
      icon: ICONS.drawing,
      onItemClick: () => insertItem(editor, notebookId, 'drawing'),
    },
  ];

  const callout: DefaultReactSuggestionItem = {
    title: 'Callout',
    subtext: 'A note set apart on a highlighter tint',
    aliases: ['callout', 'note', 'aside', 'tip'],
    group: dict.quote.group,
    icon: ICONS.callout,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'callout' }),
  };

  // Opens the [[ menu, as though [[ had been typed.
  const link: DefaultReactSuggestionItem = {
    title: 'Link to notebook',
    subtext: 'Another notebook, found by its title',
    aliases: ['link', 'notebook', 'mention', 'page', '[['],
    group: dict.quote.group,
    icon: ICONS.link,
    onItemClick: () => editor.getExtension(SuggestionMenu)?.openSuggestionMenu(LINK_TRIGGER, { deleteTriggerCharacter: true, ignoreQueryLength: true }),
  };

  // The schema already drops the defaults for blocks a page doesn't hold. Emoji isn't a block.
  for (const item of getDefaultReactSlashMenuItems(editor)) {
    if (item.title === dict.emoji.title) continue;
    items.push(item);
    if (item.title === dict.quote.title) items.push(callout, link);
  }
  return items;
}
