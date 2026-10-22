import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SideMenuExtension } from '@blocknote/core/extensions';
import { useBlockNoteEditor, useComponentsContext, useExtensionState } from '@blocknote/react';
import type { PageBlock } from '../page/blockTypes';
import { flattenBlocks } from '../page/blocks';
import { linkWriter } from '../files/links';
import { useStore } from '../store';
import { MAX_BLOCK_TEXT, blockReference, type BlockReference } from '../claude/blockRef';
import { askClaude } from '../claude/ClaudePanel';
import { useClaude } from '../claude/store';
import { useNotebookId } from './NotebookContext';
import type { PageEditor } from './schema';

/*
  "Ask Claude about this block": from a right-click on a block, or from its ⋮⋮ handle's menu. The block goes with
  the next message as the page file has it. It only reads, so a page that's read-only offers it too.
*/

type AnyEditor = Pick<PageEditor, 'getSelection' | 'document'>;

/** The blocks to ask about: the selected ones, when the selection spans several and holds this block; else this one. */
export function blocksToAsk(editor: AnyEditor, blockId: string): string[] {
  const selected = (editor.getSelection()?.blocks ?? []) as unknown as PageBlock[];
  if (selected.length > 1 && flattenBlocks(selected).some((b) => b.id === blockId)) return selected.map((b) => b.id);
  return [blockId];
}

/** The reference for these blocks as the editor has them now, on the page with this id. */
export function blocksReference(editor: AnyEditor, pageId: string, ids: string[]): BlockReference | null {
  const { notebooks, spaces } = useStore.getState();
  const page = notebooks.find((n) => n.id === pageId);
  if (!page) return null;
  // The editor's own blocks: words typed a moment ago aren't in the store yet.
  return blockReference({ ...page, blocks: editor.document as unknown as PageBlock[] }, ids, linkWriter(notebooks, spaces));
}

export const askLabel = (count: number): string => (count > 1 ? `Ask Claude about these ${count} blocks` : 'Ask Claude about this block');

/**
 * Attaches the blocks, opens the panel and puts the caret in the box. Blocks too long for main to take, such as a
 * chart of thousands of its own candles, aren't attached: the panel says why instead.
 */
export function askAbout(ref: BlockReference): void {
  if (ref.text.length <= MAX_BLOCK_TEXT) return askClaude(ref);
  const several = ref.text.startsWith('[');
  useClaude.getState().setOpen(true);
  useClaude.setState({ error: `${several ? 'These blocks are' : 'This block is'} too long to send. Ask about the whole page instead.` });
}

// A drawing's canvas and a chart's take a right-click for themselves, and a drawing in full screen is its own place.
const KEEPS_RIGHT_CLICK = '.drawing-canvas, .chart-view, .drawing-fullscreen';

export interface BlockMenuAt {
  x: number;
  y: number;
  label: string;
  ref: BlockReference;
}

/** What a right-click at this target offers, or null to leave the right-click alone. */
export function blockMenuAt(editor: AnyEditor, pageId: string, target: EventTarget | null, x: number, y: number): BlockMenuAt | null {
  if (!(target instanceof Element) || target.closest(KEEPS_RIGHT_CLICK)) return null;
  const id = target.closest<HTMLElement>('[data-node-type="blockContainer"][data-id]')?.dataset.id;
  if (!id) return null;
  const ids = blocksToAsk(editor, id);
  const ref = blocksReference(editor, pageId, ids);
  return ref ? { x, y, label: askLabel(ids.length), ref } : null;
}

const EDGE = 4;

/**
 * The right-click menu, at the pointer, drawn like the sidebar's ⋯ menus. It closes on a choice, Escape, a press
 * outside it, or scrolling; Escape gives focus back to where it was.
 */
export function BlockMenu({ at, onClose }: { at: BlockMenuAt; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ x: at.x, y: at.y });

  // Inside the window: near its right or bottom edge, the menu opens to the pointer's other side.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const x = at.x + width > window.innerWidth - EDGE ? Math.max(EDGE, at.x - width) : at.x;
    const y = at.y + height > window.innerHeight - EDGE ? Math.max(EDGE, at.y - height) : at.y;
    setPlace({ x, y });
  }, [at]);

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const away = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        before?.focus({ preventScroll: true });
      } else if (e.key === 'Tab') onClose();
    };
    const close = () => onClose();
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', onKey, true);
    // Scrolling anywhere: scroll events don't bubble, but they pass the window on their way down.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  const choose = () => {
    onClose();
    askAbout(at.ref);
  };

  return createPortal(
    <div ref={menu} className="menu block-menu" role="menu" aria-label="Block" style={{ left: place.x, top: place.y }} onContextMenu={(e) => e.preventDefault()}>
      <button role="menuitem" onClick={choose}>
        {at.label}
      </button>
    </div>,
    document.body,
  );
}

/** The same choice in the block's ⋮⋮ menu. */
export function AskClaudeItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const pageId = useNotebookId();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (block === undefined) return null;
  const ids = blocksToAsk(editor as unknown as AnyEditor, block.id);
  const ask = () => {
    const ref = blocksReference(editor as unknown as AnyEditor, pageId, ids);
    if (ref) askAbout(ref);
  };
  return (
    <Components.Generic.Menu.Item className="bn-menu-item" onClick={ask}>
      {askLabel(ids.length)}
    </Components.Generic.Menu.Item>
  );
}
