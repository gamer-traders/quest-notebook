import { useCallback, useEffect, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useCombinedRefs } from '@dnd-kit/utilities';
import type { Space } from '../../types';
import { InlineRename, type RenameEnd } from './InlineRename';
import { RowMenu, type MenuItem } from './RowMenu';
import type { DragItem, DropZone } from './PageRow';
import { Chevron } from './Chevron';
import { LOCKED_SPACE } from './labels';

export interface SpaceHeaderProps {
  space: Space;
  /** The last space can't be deleted. */
  onlySpace: boolean;
  /** Claude is working on a page in this space, which renaming the space would move and deleting it would trash. */
  holdsLock: boolean;
  /** A page dragged over the header goes to the end of the space. */
  dropInside: boolean;
  /** Its pages are folded away. */
  collapsed: boolean;
  renaming: boolean;
  onToggle: () => void;
  onAddPage: () => void;
  onStartRename: () => void;
  onRenameDone: (next: string | null) => void;
  onDelete: () => void;
}

/** A chevron and the space's name, which fold its pages and drag the space, then + (new page) and ⋯ (rename, delete) on hover. */
export function SpaceHeader(props: SpaceHeaderProps) {
  const { space, onlySpace, holdsLock, dropInside, collapsed, renaming } = props;
  const [menuOpen, setMenuOpen] = useState(false);

  const drag = useDraggable({ id: `space:${space.id}`, data: { kind: 'space', id: space.id } satisfies DragItem, disabled: renaming });
  const dropZone = useDroppable({ id: `head:${space.id}`, data: { accepts: 'page', kind: 'head', id: space.id } satisfies DropZone });
  const headRef = useCombinedRefs<HTMLElement | null>(drag.setNodeRef, dropZone.setNodeRef);

  const handle = useRef<HTMLElement | null>(null);
  const keepHandle = useCallback((el: HTMLElement | null) => (handle.current = el), []);
  const handleRef = useCombinedRefs<HTMLElement | null>(drag.setActivatorNodeRef, keepHandle);
  const refocus = useRef(false);
  // A click on the name folds the space, unless it ends a drag of it.
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const listeners = drag.listeners ?? {};
  useEffect(() => {
    if (!renaming && refocus.current) {
      refocus.current = false;
      handle.current?.focus();
    }
  }, [renaming]);

  const items: MenuItem[] = [
    { label: 'Rename', onSelect: props.onStartRename, disabled: holdsLock, hint: holdsLock ? LOCKED_SPACE : undefined },
    {
      label: 'Delete space',
      onSelect: props.onDelete,
      danger: true,
      disabled: onlySpace || holdsLock,
      hint: onlySpace ? 'A notebook needs at least one space' : holdsLock ? LOCKED_SPACE : undefined,
    },
  ];

  const classes = ['space-head', menuOpen && 'is-menu-open', dropInside && 'drop-inside'].filter(Boolean);

  return (
    <div ref={headRef} className={classes.join(' ')}>
      <button className="space-fold" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Unfold' : 'Fold'} ${space.name}`} onClick={props.onToggle}>
        <Chevron />
      </button>
      <h2 className="space-name">
        {renaming ? (
          <InlineRename
            value={space.name}
            label="Space name"
            onDone={(next: string | null, end: RenameEnd) => {
              refocus.current = end === 'key';
              props.onRenameDone(next);
            }}
          />
        ) : (
          <span
            ref={handleRef}
            className="space-handle"
            {...drag.attributes}
            {...listeners}
            onPointerDown={(e) => {
              downAt.current = { x: e.clientX, y: e.clientY };
              listeners.onPointerDown?.(e);
            }}
            onClick={(e) => {
              const at = downAt.current;
              downAt.current = null;
              if (!at || Math.hypot(e.clientX - at.x, e.clientY - at.y) < 5) props.onToggle();
            }}
          >
            {space.name}
          </span>
        )}
      </h2>
      <span className="row-tools">
        <button className="row-tool" aria-label={`New page in ${space.name}`} onClick={props.onAddPage}>
          +
        </button>
        <RowMenu label={`More for ${space.name}`} items={items} onOpenChange={setMenuOpen} />
      </span>
    </div>
  );
}
