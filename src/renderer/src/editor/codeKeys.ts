/*
  Keys at the edges of a code block, as in Notion: the arrows go on to the block above or below when the caret
  can't go further in the code, and Escape leaves the code with the block selected.
*/

export interface EdgeKey {
  key: string;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  ctrl: boolean;
  /** An input method is composing: its keys are its own. */
  composing: boolean;
}

/** Where the caret is in the code. Lines and columns count from 1, as Monaco counts them. */
export interface CaretPlace {
  line: number;
  column: number;
  lineCount: number;
  /** The column after the last character of the last line. */
  lastColumn: number;
  /** No text is selected. */
  empty: boolean;
  cursors: number;
  /** The find bar is open: Escape closes it first. */
  findOpen: boolean;
}

/** Leave for the block above, the block below, or select this block. Null keeps the key in the code. */
export type EdgeExit = 'up' | 'down' | 'select';

export function edgeExit(e: EdgeKey, at: CaretPlace): EdgeExit | null {
  if (e.shift || e.alt || e.meta || e.ctrl || e.composing) return null;
  if (e.key === 'Escape') return at.cursors > 1 || at.findOpen ? null : 'select';
  // A selection or extra cursors are the code's to move.
  if (!at.empty || at.cursors > 1) return null;
  const first = at.line === 1;
  const last = at.line === at.lineCount;
  switch (e.key) {
    case 'ArrowUp':
      return first ? 'up' : null;
    case 'ArrowDown':
      return last ? 'down' : null;
    case 'ArrowLeft':
      return first && at.column === 1 ? 'up' : null;
    case 'ArrowRight':
      return last && at.column === at.lastColumn ? 'down' : null;
    default:
      return null;
  }
}
