import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useCombinedRefs } from '@dnd-kit/utilities';
import type { MarkdownFile, Notebook } from '../../types';
import { markdownName } from '../../markdown/model';
import { displayTitle } from '../../page/tree';
import type { Intent } from './dropIntent';
import { InlineRename, type RenameEnd } from './InlineRename';
import { RowMenu, type MenuItem } from './RowMenu';
import { Chevron } from './Chevron';
import { LOCKED_PAGE, LOCKED_SUB_PAGE, deletePageLabel } from './labels';

/** What a drag carries, and what a drop zone takes. */
export type DragItem = { kind: 'page' | 'space'; id: string };
export type DropZone = { accepts: 'page'; kind: 'row' | 'head'; id: string; depth?: number } | { accepts: 'space'; kind: 'section'; id: string };

export interface PageRowProps {
  page: Notebook;
  depth: number;
  hasChildren: boolean;
  open: boolean;
  current: boolean;
  subPages: number;
  /** The line or outline shown while a page is dragged over this row. */
  drop: { intent: Intent; lineDepth: number } | null;
  /**
   * Claude is working on this page, or on one below it, until the turn ends. Meanwhile neither is renamed, moved,
   * dragged or deleted: renaming or moving a page moves the files below it too, and deleting it trashes them.
   */
  lock: 'page' | 'below' | null;
  renaming: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onAddSubPage: () => void;
  onStartRename: () => void;
  /** The new title, or null to keep the old one. */
  onRenameDone: (next: string | null) => void;
  onMoveTo: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
}

/** One page in the sidebar tree: a toggle, the title that opens it (and drags it), then + and ⋯ on hover. */
export function PageRow(props: PageRowProps) {
  const { page, depth, hasChildren, open, current, subPages, drop, lock, renaming } = props;
  const title = displayTitle(page.title);
  const [menuOpen, setMenuOpen] = useState(false);

  const drag = useDraggable({ id: `page:${page.id}`, data: { kind: 'page', id: page.id } satisfies DragItem, disabled: renaming || lock !== null });
  const dropZone = useDroppable({ id: `row:${page.id}`, data: { accepts: 'page', kind: 'row', id: page.id, depth } satisfies DropZone });
  const rowRef = useCombinedRefs<HTMLElement | null>(drag.setNodeRef, dropZone.setNodeRef);

  // A rename finished from the keyboard hands focus back to the title.
  const titleButton = useRef<HTMLButtonElement | null>(null);
  const keepTitle = useCallback((el: HTMLElement | null) => (titleButton.current = el as HTMLButtonElement | null), []);
  const titleRef = useCombinedRefs<HTMLElement | null>(drag.setActivatorNodeRef, keepTitle);
  const refocus = useRef(false);
  useEffect(() => {
    if (!renaming && refocus.current) {
      refocus.current = false;
      titleButton.current?.focus();
    }
  }, [renaming]);

  const held = lock === null ? {} : { disabled: true, hint: lock === 'page' ? LOCKED_PAGE : LOCKED_SUB_PAGE };
  const items: MenuItem[] = [
    { label: 'Add sub-page', onSelect: props.onAddSubPage },
    { label: 'Rename', onSelect: props.onStartRename, ...held },
    { label: 'Move to…', onSelect: props.onMoveTo, ...held },
    { label: 'Copy link for [[ ]]', onSelect: props.onCopyLink },
    { label: deletePageLabel(subPages), onSelect: props.onDelete, danger: true, ...held },
  ];

  const classes = [
    'tree-row',
    current && 'is-current',
    drag.isDragging && 'is-dragging',
    menuOpen && 'is-menu-open',
    drop && `drop-${drop.intent}`,
  ].filter(Boolean);

  return (
    <li>
      <div ref={rowRef} className={classes.join(' ')} style={{ '--depth': depth, '--line-depth': drop?.lineDepth ?? depth } as CSSProperties}>
        {hasChildren ? (
          <button className="twisty" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`} onClick={props.onToggle}>
            <Chevron />
          </button>
        ) : (
          <span className="twisty" aria-hidden />
        )}
        {renaming ? (
          <InlineRename
            value={page.title}
            label="Page title"
            onDone={(next: string | null, end: RenameEnd) => {
              refocus.current = end === 'key';
              props.onRenameDone(next);
            }}
          />
        ) : (
          <button
            ref={titleRef}
            className="row-title"
            {...drag.attributes}
            {...drag.listeners}
            // It still opens the page while it can't be dragged.
            aria-disabled={undefined}
            aria-current={current ? 'page' : undefined}
            onClick={props.onOpen}
          >
            {title}
          </button>
        )}
        <span className="row-tools">
          <button className="row-tool" aria-label={`Add sub-page to ${title}`} onClick={props.onAddSubPage}>
            +
          </button>
          <RowMenu label={`More for ${title}`} items={items} onOpenChange={setMenuOpen} />
        </span>
      </div>
    </li>
  );
}

/** A Markdown file in the sidebar tree: its name, marked as a Markdown file, which opens it. */
export function MarkdownRow({ file, depth, current, onOpen }: { file: MarkdownFile; depth: number; current: boolean; onOpen: () => void }) {
  const name = markdownName(file);
  return (
    <li>
      <div className={['tree-row', 'markdown-row', current && 'is-current'].filter(Boolean).join(' ')} style={{ '--depth': depth, '--line-depth': depth } as CSSProperties}>
        <span className="twisty" aria-hidden />
        <button className="row-title" aria-current={current ? 'page' : undefined} title={file.path} onClick={onOpen}>
          {name}
          <span className="row-kind" aria-label="Markdown file">
            .md
          </span>
        </button>
      </div>
    </li>
  );
}
