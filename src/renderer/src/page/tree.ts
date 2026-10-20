import type { Notebook, Space } from '../types';

export interface Target {
  spaceId: string;
  parentId: string | null;
  /** Index among the new siblings, after removing the moved page. */
  index: number;
}

/** Two neighbours closer than this get the whole sibling list renumbered. */
const MIN_GAP = 1e-6;

export const displayTitle = (title: string): string => (title.trim() === '' ? 'Untitled' : title);

export function childrenOf(notebooks: Notebook[], spaceId: string, parentId: string | null): Notebook[] {
  return notebooks.filter((nb) => nb.spaceId === spaceId && nb.parentId === parentId).sort((a, b) => a.position - b.position);
}

export function descendantIds(notebooks: Notebook[], id: string): string[] {
  const out: string[] = [];
  const queue = [id];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const nb of notebooks) {
      if (nb.parentId === parent && !out.includes(nb.id)) {
        out.push(nb.id);
        queue.push(nb.id);
      }
    }
  }
  return out;
}

/** Root first, excluding the page itself. */
export function ancestorsOf(notebooks: Notebook[], id: string): Notebook[] {
  const byId = new Map(notebooks.map((nb) => [nb.id, nb]));
  const out: Notebook[] = [];
  const seen = new Set([id]);
  let parentId = byId.get(id)?.parentId ?? null;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    out.unshift(parent);
    seen.add(parentId);
    parentId = parent.parentId;
  }
  return out;
}

/** [space name, ...ancestor titles, title] */
export function pathOf(notebooks: Notebook[], spaces: Space[], id: string): string[] {
  const nb = notebooks.find((n) => n.id === id);
  if (!nb) return [];
  const space = spaces.find((s) => s.id === nb.spaceId);
  return [space?.name ?? '', ...ancestorsOf(notebooks, id).map((a) => displayTitle(a.title)), displayTitle(nb.title)];
}

export function canMove(notebooks: Notebook[], id: string, parentId: string | null): boolean {
  if (parentId === null) return true;
  return parentId !== id && !descendantIds(notebooks, id).includes(parentId);
}

export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (after === undefined) return before! + 1;
  if (before === undefined) return after - 1;
  return (before + after) / 2;
}

export function movePage(notebooks: Notebook[], id: string, to: Target): Notebook[] | null {
  const moved = notebooks.find((nb) => nb.id === id);
  if (!moved || !canMove(notebooks, id, to.parentId)) return null;

  const siblings = childrenOf(notebooks, to.spaceId, to.parentId).filter((nb) => nb.id !== id);
  const index = Math.max(0, Math.min(to.index, siblings.length));
  const before = siblings[index - 1]?.position;
  const after = siblings[index]?.position;
  const position = positionBetween(before, after);
  const crowded = before !== undefined && after !== undefined && after - before < MIN_GAP;

  const subtree = new Set(descendantIds(notebooks, id));
  const renumbered = new Map<string, number>();
  if (crowded) {
    [...siblings.slice(0, index), moved, ...siblings.slice(index)].forEach((nb, i) => renumbered.set(nb.id, i));
  }

  return notebooks.map((nb) => {
    if (nb.id === id) return { ...nb, spaceId: to.spaceId, parentId: to.parentId, position: renumbered.get(id) ?? position };
    if (subtree.has(nb.id)) return nb.spaceId === to.spaceId ? nb : { ...nb, spaceId: to.spaceId };
    const n = renumbered.get(nb.id);
    return n === undefined ? nb : { ...nb, position: n };
  });
}

export function deletePageTree(notebooks: Notebook[], id: string): { notebooks: Notebook[]; removed: string[] } {
  if (!notebooks.some((nb) => nb.id === id)) return { notebooks, removed: [] };
  const removed = [id, ...descendantIds(notebooks, id)];
  const gone = new Set(removed);
  return { notebooks: notebooks.filter((nb) => !gone.has(nb.id)), removed };
}

/** Where to land after a delete: the parent, then the next or previous sibling, then the first top-level page. */
export function nextActiveAfterDelete(before: Notebook[], spaces: Space[], deletedId: string, after: Notebook[]): string | null {
  const deleted = before.find((nb) => nb.id === deletedId);
  const alive = new Set(after.map((nb) => nb.id));
  if (deleted) {
    if (deleted.parentId && alive.has(deleted.parentId)) return deleted.parentId;
    const siblings = childrenOf(before, deleted.spaceId, deleted.parentId);
    const i = siblings.findIndex((nb) => nb.id === deletedId);
    const next = siblings.slice(i + 1).find((nb) => alive.has(nb.id));
    if (next) return next.id;
    const prev = siblings.slice(0, i).reverse().find((nb) => alive.has(nb.id));
    if (prev) return prev.id;
  }
  for (const space of spaces) {
    const first = childrenOf(after, space.id, null)[0];
    if (first) return first.id;
  }
  return null;
}
