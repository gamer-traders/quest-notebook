import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type Collision,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import type { Notebook, Space } from '../../types';
import { ancestorsOf, canMove, childrenOf, descendantIds, displayTitle, type Target } from '../../page/tree';
import { useStore } from '../../store';
import { isLocked, lockedBranch, lockedSpace, useClaude } from '../../claude/store';
import { copyLink } from '../../editor/copyLink';
import { dropIntent, targetFor, type Intent } from './dropIntent';
import { deletePageQuestion, deleteSpaceQuestion } from './labels';
import { MoveToDialog } from './MoveToDialog';
import { PageRow, type DragItem, type DropZone } from './PageRow';
import { revealKey, shouldReveal } from './reveal';
import { SpaceHeader } from './SpaceHeader';

/** What the tree last revealed. It lives outside the tree, which search unmounts; null until the first draw. */
let lastRevealed: string | null = null;

interface Row {
  page: Notebook;
  depth: number;
  hasChildren: boolean;
  open: boolean;
}

/** A space's pages as the sidebar lists them: each page, then its sub-pages when it's expanded. */
function visibleRows(notebooks: Notebook[], spaceId: string, expanded: Record<string, boolean>): Row[] {
  const rows: Row[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const page of childrenOf(notebooks, spaceId, parentId)) {
      const hasChildren = notebooks.some((nb) => nb.parentId === page.id && nb.spaceId === spaceId);
      const open = hasChildren && expanded[page.id] === true;
      rows.push({ page, depth, hasChildren, open });
      if (open) walk(page.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** What letting go would do, and how the tree shows it beforehand. */
type Drop =
  | { kind: 'row'; id: string; intent: Intent; lineDepth: number; target: Target }
  | { kind: 'head'; id: string; target: Target }
  | { kind: 'section'; id: string; intent: 'before' | 'after'; toIndex: number };

const sameDrop = (a: Drop | null, b: Drop | null) => JSON.stringify(a) === JSON.stringify(b);

/** The zone under the pointer, and where the pointer is in it. */
interface Hit {
  zone: DropZone;
  top: number;
  height: number;
  y: number;
}

/**
 * The zone under the pointer, of the kind the dragged thing can go in. Rects are read live, so a sidebar
 * scrolled mid-drag still lines up. A keyboard drag has no pointer, and uses the middle of what's dragged.
 */
const underPointer: CollisionDetection = ({ active, collisionRect, droppableContainers, pointerCoordinates }) => {
  const kind = (active.data.current as DragItem | undefined)?.kind;
  const point = pointerCoordinates ?? { x: collisionRect.left + collisionRect.width / 2, y: collisionRect.top + collisionRect.height / 2 };
  for (const container of droppableContainers) {
    const zone = container.data.current as DropZone | undefined;
    const rect = zone?.accepts === kind ? container.node.current?.getBoundingClientRect() : undefined;
    if (!zone || !rect || point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) continue;
    const hit: Hit = { zone, top: rect.top, height: rect.height, y: point.y };
    return [{ id: container.id, data: { droppableContainer: container, value: 0, hit } }];
  }
  return [];
};

/**
 * Mouse and pen: a drag starts after 5 px of movement, so a click still just opens the page.
 * Touch is left to the touch sensor, where a drag needs a 250 ms press, so a tap or a swipe works as usual.
 */
class MousePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: ReactPointerEvent) => event.isPrimary && event.button === 0 && event.pointerType !== 'touch',
    },
  ];
}

// Space picks a row up, so Enter still opens it. Arrows move a quarter of a row at a time, enough to land
// before, inside or after each row on the way.
const KEYBOARD_CODES = { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] };
const keyboardStep: KeyboardCoordinateGetter = (event, { currentCoordinates: at }) => {
  if (event.code === 'ArrowDown') return { ...at, y: at.y + 8 };
  if (event.code === 'ArrowUp') return { ...at, y: at.y - 8 };
  return undefined;
};

const screenReaderInstructions = {
  draggable: 'To move it, press space, then use the up and down arrow keys. Press space or enter to drop it, or escape to cancel.',
};

/** A space's whole section is where a dragged space header drops: above it or below it. */
function SpaceSection({ space, dragging, dropLine, children }: { space: Space; dragging: boolean; dropLine: 'before' | 'after' | null; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `section:${space.id}`, data: { accepts: 'space', kind: 'section', id: space.id } satisfies DropZone });
  const classes = ['space', dragging && 'is-dragging', dropLine && `drop-${dropLine}`].filter(Boolean);
  return (
    <section ref={setNodeRef} className={classes.join(' ')} data-space-id={space.id} aria-label={space.name}>
      {children}
    </section>
  );
}

/** The spaces and their page trees, with drag and drop, the ⋯ menus, inline renames and Move to…. */
export function PageTree({ onNavigate }: { onNavigate: () => void }) {
  const notebooks = useStore((s) => s.notebooks);
  const spaces = useStore((s) => s.spaces);
  const expanded = useStore((s) => s.expanded);
  const activeId = useStore((s) => s.activeId);
  const view = useStore((s) => s.view);
  const { openNotebook, createPage, toggleExpanded, updateNotebook, deletePage, createSpace, renameSpace, deleteSpace, movePage, moveSpace } =
    useStore.getState();

  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [drop, setDropState] = useState<Drop | null>(null);
  const dropRef = useRef<Drop | null>(null);
  /** A page id, or 'space:' and a space id. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MousePointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { keyboardCodes: KEYBOARD_CODES, coordinateGetter: keyboardStep }),
  );

  const rowsBySpace = useMemo(() => new Map(spaces.map((sp) => [sp.id, visibleRows(notebooks, sp.id, expanded)])), [notebooks, spaces, expanded]);
  const subPageCounts = useMemo(() => {
    const parents = new Set(notebooks.map((nb) => nb.parentId));
    return new Map(notebooks.filter((nb) => parents.has(nb.id)).map((nb) => [nb.id, descendantIds(notebooks, nb.id).length]));
  }, [notebooks]);

  // While Claude works on a page, the sidebar doesn't rename, move or delete it, nor delete a page or space it's
  // in, which would trash it with them. Each is checked again when chosen, for a turn that started meanwhile.
  const running = useClaude((s) => s.running);
  const branch = useMemo(() => lockedBranch({ running }, notebooks), [running, notebooks]);
  const heldSpace = lockedSpace({ running }, notebooks);
  const lockOf = (id: string) => (isLocked({ running }, id) ? 'page' : branch.has(id) ? 'below' : null);

  // A page that opens, or moves under collapsed pages, has its ancestors expanded so its row shows,
  // including one opened from search while the tree was swapped out. Not on load: rows collapsed last
  // time stay collapsed, even around the open page.
  const ancestorKey = useStore((s) => (s.activeId ? ancestorsOf(s.notebooks, s.activeId).map((a) => a.id).join(' ') : ''));
  useEffect(() => {
    const ancestors = ancestorKey ? ancestorKey.split(' ') : [];
    const key = revealKey(activeId, ancestors);
    const reveal = shouldReveal(lastRevealed, key);
    lastRevealed = key;
    if (!reveal) return;
    const { expanded, toggleExpanded } = useStore.getState();
    for (const id of ancestors) if (!expanded[id]) toggleExpanded(id);
  }, [activeId, ancestorKey]);

  const go = (fn: () => void) => {
    fn();
    onNavigate();
  };

  const setDrop = (next: Drop | null) => {
    if (sameDrop(dropRef.current, next)) return;
    dropRef.current = next;
    setDropState(next);
  };

  /** What dropping here would do, or null when it would be refused. */
  const dropFor = (item: DragItem, { zone, top, height, y }: Hit): Drop | null => {
    const { notebooks, spaces, expanded } = useStore.getState();
    if (item.kind === 'space') {
      if (zone.kind !== 'section' || zone.id === item.id) return null;
      const intent = y < top + height / 2 ? 'before' : 'after';
      const at = spaces.filter((sp) => sp.id !== item.id).findIndex((sp) => sp.id === zone.id);
      return { kind: 'section', id: zone.id, intent, toIndex: intent === 'before' ? at : at + 1 };
    }
    // Claude is working on it: it stays where it is until the turn ends.
    if (isLocked(useClaude.getState(), item.id)) return null;
    if (zone.kind === 'head') {
      const index = childrenOf(notebooks, zone.id, null).filter((nb) => nb.id !== item.id).length;
      return { kind: 'head', id: zone.id, target: { spaceId: zone.id, parentId: null, index } };
    }
    if (zone.kind !== 'row') return null;
    const over = notebooks.find((nb) => nb.id === zone.id);
    if (!over || over.id === item.id) return null;
    const intent = dropIntent(top, height, y);
    const depth = zone.depth ?? 0;
    // Below an expanded page the next row is its first sub-page, so the line there means first among them.
    const firstSub = intent === 'after' && expanded[over.id] === true && notebooks.some((nb) => nb.parentId === over.id);
    const target = firstSub ? { spaceId: over.spaceId, parentId: over.id, index: 0 } : targetFor(notebooks, over.id, intent, item.id);
    // A page can't go into itself or its own sub-pages: no line, no outline, and letting go changes nothing.
    if (!canMove(notebooks, item.id, target.parentId)) return null;
    return { kind: 'row', id: over.id, intent, lineDepth: firstSub ? depth + 1 : depth, target };
  };

  const onMove = ({ active, collisions }: { active: Active; collisions: Collision[] | null }) => {
    const item = active.data.current as DragItem | undefined;
    const hit = collisions?.[0]?.data?.hit as Hit | undefined;
    setDrop(item && hit ? dropFor(item, hit) : null);
  };

  const onEnd = (active: Active | null) => {
    const done = dropRef.current;
    const item = active?.data.current as DragItem | undefined;
    setDrop(null);
    setDragging(null);
    if (!done || !item) return;
    if (done.kind === 'section') moveSpace(item.id, done.toIndex);
    else if (!isLocked(useClaude.getState(), item.id)) movePage(item.id, done.target);
  };

  /** A page's title or a space's name. */
  const nameOf = (item: DragItem | undefined) => {
    const { notebooks, spaces } = useStore.getState();
    if (!item) return '';
    if (item.kind === 'space') return spaces.find((sp) => sp.id === item.id)?.name ?? '';
    return displayTitle(notebooks.find((nb) => nb.id === item.id)?.title ?? '');
  };
  const spoken = (active: Active) => {
    const item = active.data.current as DragItem | undefined;
    return item?.kind === 'space' ? `the space ${nameOf(item)}` : nameOf(item);
  };
  const placeOf = (d: Drop | null) => {
    if (!d) return 'nowhere it can go';
    if (d.kind === 'head') return `the end of the space ${nameOf({ kind: 'space', id: d.id })}`;
    if (d.kind === 'section') return `${d.intent} the space ${nameOf({ kind: 'space', id: d.id })}`;
    return `${d.intent} ${nameOf({ kind: 'page', id: d.id })}`;
  };
  // Said again whenever the place changes, which can happen within one row: before, inside, after.
  const said = useRef('');
  const placeNow = (active: Active) => {
    const text = `${spoken(active)}: ${placeOf(dropRef.current)}.`;
    if (text === said.current) return undefined;
    said.current = text;
    return text;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      said.current = '';
      return `Picked up ${spoken(active)}.`;
    },
    onDragOver: ({ active }) => placeNow(active),
    onDragMove: ({ active }) => placeNow(active),
    onDragEnd: ({ active }) => `Dropped ${spoken(active)}.`,
    onDragCancel: ({ active }) => `Cancelled. ${spoken(active)} stays where it was.`,
  };

  const askDeletePage = (page: Notebook) => {
    const { notebooks } = useStore.getState();
    if (lockedBranch(useClaude.getState(), notebooks).has(page.id)) return;
    const subPages = descendantIds(notebooks, page.id).length;
    if (window.confirm(deletePageQuestion(displayTitle(page.title), subPages))) deletePage(page.id);
  };

  const askDeleteSpace = (space: Space) => {
    const { notebooks, spaces } = useStore.getState();
    if (spaces.length <= 1 || lockedSpace(useClaude.getState(), notebooks) === space.id) return;
    const pages = notebooks.filter((nb) => nb.spaceId === space.id).length;
    if (window.confirm(deleteSpaceQuestion(space.name, pages))) deleteSpace(space.id);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={underPointer}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={({ active }) => setDragging(active.data.current as DragItem)}
      onDragMove={onMove}
      onDragOver={onMove}
      onDragEnd={({ active }) => onEnd(active)}
      onDragCancel={() => onEnd(null)}
    >
      <div className="page-tree">
        {spaces.map((space) => {
          const rows = rowsBySpace.get(space.id) ?? [];
          return (
            <SpaceSection
              key={space.id}
              space={space}
              dragging={dragging?.kind === 'space' && dragging.id === space.id}
              dropLine={drop?.kind === 'section' && drop.id === space.id ? drop.intent : null}
            >
              <SpaceHeader
                space={space}
                onlySpace={spaces.length <= 1}
                holdsLock={heldSpace === space.id}
                dropInside={drop?.kind === 'head' && drop.id === space.id}
                renaming={renaming === `space:${space.id}`}
                onAddPage={() => go(() => createPage(space.id, null))}
                onStartRename={() => setRenaming(`space:${space.id}`)}
                onRenameDone={(next) => {
                  const name = next?.trim();
                  if (name) renameSpace(space.id, name);
                  setRenaming(null);
                }}
                onDelete={() => askDeleteSpace(space)}
              />
              {rows.length === 0 ? (
                <p className="muted tree-empty">None yet.</p>
              ) : (
                <ul className="tree">
                  {rows.map(({ page, depth, hasChildren, open }) => (
                    <PageRow
                      key={page.id}
                      page={page}
                      depth={depth}
                      hasChildren={hasChildren}
                      open={open}
                      current={view === 'notebook' && page.id === activeId}
                      subPages={subPageCounts.get(page.id) ?? 0}
                      drop={drop?.kind === 'row' && drop.id === page.id ? { intent: drop.intent, lineDepth: drop.lineDepth } : null}
                      lock={lockOf(page.id)}
                      renaming={renaming === page.id}
                      onOpen={() => go(() => openNotebook(page.id))}
                      onToggle={() => toggleExpanded(page.id)}
                      onAddSubPage={() => go(() => createPage(page.spaceId, page.id))}
                      onStartRename={() => setRenaming(page.id)}
                      onRenameDone={(next) => {
                        if (next !== null && !isLocked(useClaude.getState(), page.id)) updateNotebook(page.id, { title: next });
                        setRenaming(null);
                      }}
                      onMoveTo={() => setMoving(page.id)}
                      onCopyLink={() => void copyLink(page.id, displayTitle(page.title)).catch((error) => console.error('The link could not be copied.', error))}
                      onDelete={() => askDeletePage(page)}
                    />
                  ))}
                </ul>
              )}
            </SpaceSection>
          );
        })}
        <button className="quiet new-space" onClick={() => setRenaming(`space:${createSpace()}`)}>
          + New space
        </button>
      </div>
      {createPortal(
        <DragOverlay dropAnimation={null}>{dragging && <div className="drag-ghost">{nameOf(dragging)}</div>}</DragOverlay>,
        document.body,
      )}
      {moving && <MoveToDialog pageId={moving} onClose={() => setMoving(null)} />}
    </DndContext>
  );
}
