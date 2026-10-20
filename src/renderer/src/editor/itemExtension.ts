import {
  createExtension,
  getBlockInfoAt,
  getBlockInfoFromSelection,
  getLastDescendantBlockInfo,
  getNextBlockInfo,
  getParentBlockInfo,
  getPrevBlockInfo,
  type BlockInfo,
} from '@blocknote/core';
import { Plugin, type EditorState } from 'prosemirror-state';
import { ITEM_BLOCK_TYPES, type PageBlock } from '../page/blockTypes';
import { copiedItems } from '../page/blocks';
import { useStore } from '../store';

// Chart, trade plan and prediction blocks keep their data outside the document, under the block's id.
// This extension keeps that link safe while editing.

const ITEM_TYPES = new Set<string>(ITEM_BLOCK_TYPES);
const isItem = (info: BlockInfo | undefined): info is BlockInfo => !!info?.hasContent && ITEM_TYPES.has(info.blockNoteType);
const idOf = (info: BlockInfo) => info.block.node.attrs.id as string;

/**
 * The chart, plan or prediction that Backspace or Delete at the caret would delete outright, or null.
 * The editor removes a block without text in one keystroke; these get selected first instead.
 */
export function itemBlockAtCaret(state: EditorState, key: 'Backspace' | 'Delete'): string | null {
  if (!state.selection.empty) return null;
  const info = getBlockInfoFromSelection(state);
  if (!info.hasContent || info.contentKind === 'none') return null;

  if (key === 'Backspace') {
    // At the start of a paragraph with text, the editor puts this block in place of the block above.
    // Other text blocks turn into a paragraph first, and an empty one goes, leaving the block above selected.
    if (state.selection.from !== info.contentStart || info.blockNoteType !== 'paragraph' || info.isContentEmpty) return null;
    const prev = getPrevBlockInfo(state.doc, info.block.beforePos);
    const above = prev && getLastDescendantBlockInfo(prev);
    return isItem(above) ? idOf(above) : null;
  }

  // At the end of a block, Delete removes its first nested block, or else the next block down the page.
  if (state.selection.from !== info.contentEnd) return null;
  let below = info.children?.node.childCount ? getBlockInfoAt(state.doc, info.children.childrenStart) : undefined;
  for (let at: BlockInfo | undefined = info; !below && at; at = getParentBlockInfo(state.doc, at.block.beforePos)) {
    below = getNextBlockInfo(state.doc, at.block.beforePos);
  }
  return isItem(below) ? idOf(below) : null;
}

/**
 * Pasting gives a block a new id but keeps its props, so a pasted chart, plan or prediction still points at the
 * item it was copied from. In the same step as the paste, file a copy of that item under the new id and point the
 * block at it, so copies of copies, and copies of a block whose original is gone, carry the right data.
 */
function ownPastedItems(notebookId: string) {
  return new Plugin({
    appendTransaction: (transactions, _oldState, state) => {
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const pasted: { contentPos: number; block: PageBlock }[] = [];
      state.doc.descendants((node, pos) => {
        const content = node.firstChild;
        if (node.type.name === 'blockContainer' && content && ITEM_TYPES.has(content.type.name)) {
          const id: string | null = node.attrs.id;
          // A block that hasn't been given its id yet gets one in a later round.
          if (id && content.attrs.itemId !== id) {
            pasted.push({ contentPos: pos + 1, block: { id, type: content.type.name, props: { itemId: content.attrs.itemId }, children: [] } });
          }
        }
        return !node.isTextblock;
      });
      if (pasted.length === 0) return null;

      const { notebooks, addItem } = useStore.getState();
      const nb = notebooks.find((n) => n.id === notebookId);
      if (nb) {
        // Copied from this notebook first, else from another one.
        const findItem = (itemId: string) => nb.items[itemId] ?? notebooks.find((n) => n.items[itemId])?.items[itemId];
        for (const item of copiedItems(pasted.map((p) => p.block), nb.items, findItem)) addItem(notebookId, item);
      }

      const tr = state.tr;
      for (const { contentPos, block } of pasted) tr.setNodeAttribute(contentPos, 'itemId', block.id);
      return tr;
    },
  });
}

/** Guards for chart, plan and prediction blocks on one notebook's page. */
export const itemBlocksExtension = (notebookId: string) => {
  const selectFirst =
    (key: 'Backspace' | 'Delete') =>
    ({ editor }: { editor: { prosemirrorState: EditorState; setTextCursorPosition: (id: string) => void } }) => {
      const id = itemBlockAtCaret(editor.prosemirrorState, key);
      if (!id) return false;
      // A block without text takes the selection as a whole, so the next Backspace or Delete removes it.
      editor.setTextCursorPosition(id);
      return true;
    };

  return createExtension({
    key: 'itemBlocks',
    keyboardShortcuts: { Backspace: selectFirst('Backspace'), Delete: selectFirst('Delete') },
    prosemirrorPlugins: [ownPastedItems(notebookId)],
  });
};
