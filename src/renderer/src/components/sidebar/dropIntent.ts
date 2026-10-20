import type { Notebook } from '../../types';
import { childrenOf, type Target } from '../../page/tree';

/** Where a dragged page lands against the row under the pointer. */
export type Intent = 'before' | 'inside' | 'after';

/** The top quarter of a row drops before it, the bottom quarter after it, and the middle inside it. */
export function dropIntent(rowTop: number, rowHeight: number, pointerY: number): Intent {
  const y = pointerY - rowTop;
  if (y < rowHeight / 4) return 'before';
  if (y > (rowHeight * 3) / 4) return 'after';
  return 'inside';
}

/**
 * Where the dragged page goes when dropped on a row. Inside makes it the row's last sub-page; before and after
 * place it among the row's siblings. The index counts the siblings without the dragged page, as `Target` does.
 */
export function targetFor(notebooks: Notebook[], overId: string, intent: Intent, draggedId: string): Target {
  const over = notebooks.find((nb) => nb.id === overId);
  // No such row: a space no store has, so the move is refused.
  if (!over) return { spaceId: '', parentId: null, index: 0 };
  if (intent === 'inside') {
    return { spaceId: over.spaceId, parentId: over.id, index: childrenOf(notebooks, over.spaceId, over.id).filter((nb) => nb.id !== draggedId).length };
  }
  const siblings = childrenOf(notebooks, over.spaceId, over.parentId).filter((nb) => nb.id !== draggedId);
  const at = siblings.findIndex((nb) => nb.id === overId);
  return { spaceId: over.spaceId, parentId: over.parentId, index: intent === 'before' ? at : at + 1 };
}
