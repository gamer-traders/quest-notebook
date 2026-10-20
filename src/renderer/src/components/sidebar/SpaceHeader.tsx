import { useCallback, useEffect, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useCombinedRefs } from '@dnd-kit/utilities';
import type { Space } from '../../types';
import { InlineRename, type RenameEnd } from './InlineRename';
import { RowMenu, type MenuItem } from './RowMenu';
import type { DragItem, DropZone } from './PageRow';

export interface SpaceHeaderProps {
  space: Space;
  /** The last space can't be deleted. */
  onlySpace: boolean;
  /** A page dragged over the header goes to the end of the space. */
  dropInside: boolean;
  renaming: boolean;
  onAddPage: () => void;
  onStartRename: () => void;
  onRenameDone: (next: string | null) => void;
  onDelete: () => void;
}

/** A space's name, which drags the space, then + (new page) and ⋯ (rename, delete) on hover. */
export function SpaceHeader(props: SpaceHeaderProps) {
  const { space, onlySpace, dropInside, renaming } = props;
  const [menuOpen, setMenuOpen] = useState(false);

  const drag = useDraggable({ id: `space:${space.id}`, data: { kind: 'space', id: space.id } satisfies DragItem, disabled: renaming });
  const dropZone = useDroppable({ id: `head:${space.id}`, data: { accepts: 'page', kind: 'head', id: space.id } satisfies DropZone });
  const headRef = useCombinedRefs<HTMLElement | null>(drag.setNodeRef, dropZone.setNodeRef);

  const handle = useRef<HTMLElement | null>(null);
  const keepHandle = useCallback((el: HTMLElement | null) => (handle.current = el), []);
  const handleRef = useCombinedRefs<HTMLElement | null>(drag.setActivatorNodeRef, keepHandle);
  const refocus = useRef(false);
  useEffect(() => {
    if (!renaming && refocus.current) {
      refocus.current = false;
      handle.current?.focus();
    }
  }, [renaming]);

  const items: MenuItem[] = [
    { label: 'Rename', onSelect: props.onStartRename },
    { label: 'Delete space', onSelect: props.onDelete, danger: true, disabled: onlySpace, hint: onlySpace ? 'A notebook needs at least one space' : undefined },
  ];

  const classes = ['space-head', menuOpen && 'is-menu-open', dropInside && 'drop-inside'].filter(Boolean);

  return (
    <div ref={headRef} className={classes.join(' ')}>
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
          <span ref={handleRef} className="space-handle" {...drag.attributes} {...drag.listeners}>
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
