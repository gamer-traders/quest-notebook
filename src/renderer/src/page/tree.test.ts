import { describe, expect, test } from 'vitest';
import type { Notebook } from '../types';
import { ancestorsOf, canMove, childrenOf, deletePageTree, descendantIds, displayTitle, movePage, nextActiveAfterDelete, pathOf, positionBetween } from './tree';

const spaces = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }];
const page = (id: string, spaceId: string, parentId: string | null, position: number): Notebook => ({
  id, title: `${id} title`, spaceId, parentId, position, createdAt: 0, updatedAt: 0, blocks: [], items: {},
});
const fixture = (): Notebook[] => [
  page('p1', 'A', null, 0),
  page('c1', 'A', 'p1', 0),
  page('g1', 'A', 'c1', 0),
  page('c2', 'A', 'p1', 1),
  page('p2', 'A', null, 1),
  page('q1', 'B', null, 0),
];
const ids = (nbs: Notebook[]) => nbs.map((n) => n.id);

describe('childrenOf', () => {
  test('sorts by position', () => {
    const shuffled = [...fixture()].reverse();
    expect(ids(childrenOf(shuffled, 'A', null))).toEqual(['p1', 'p2']);
    expect(ids(childrenOf(shuffled, 'A', 'p1'))).toEqual(['c1', 'c2']);
  });
});

describe('descendantIds', () => {
  test('finds the whole subtree', () => {
    expect(descendantIds(fixture(), 'p1').sort()).toEqual(['c1', 'c2', 'g1']);
    expect(descendantIds(fixture(), 'q1')).toEqual([]);
  });
});

describe('ancestorsOf and pathOf', () => {
  test('names the space, the ancestors and the page', () => {
    expect(ids(ancestorsOf(fixture(), 'g1'))).toEqual(['p1', 'c1']);
    expect(pathOf(fixture(), spaces, 'g1')).toEqual(['A', 'p1 title', 'c1 title', 'g1 title']);
  });
});

describe('canMove', () => {
  test('refuses a page into itself or its own sub-page', () => {
    expect(canMove(fixture(), 'p1', 'p1')).toBe(false);
    expect(canMove(fixture(), 'p1', 'g1')).toBe(false);
    expect(canMove(fixture(), 'c1', 'p2')).toBe(true);
    expect(canMove(fixture(), 'c1', null)).toBe(true);
  });
});

describe('movePage', () => {
  test('takes the subtree to another space', () => {
    const out = movePage(fixture(), 'p1', { spaceId: 'B', parentId: null, index: 0 })!;
    for (const id of ['p1', 'c1', 'c2', 'g1']) expect(out.find((n) => n.id === id)!.spaceId).toBe('B');
    expect(ids(childrenOf(out, 'B', null))).toEqual(['p1', 'q1']);
    expect(out.find((n) => n.id === 'c1')!.parentId).toBe('p1');
  });

  test('reorders within the same parent', () => {
    const out = movePage(fixture(), 'p2', { spaceId: 'A', parentId: null, index: 0 })!;
    expect(ids(childrenOf(out, 'A', null))).toEqual(['p2', 'p1']);
  });

  test('returns null for an illegal move', () => {
    expect(movePage(fixture(), 'p1', { spaceId: 'A', parentId: 'g1', index: 0 })).toBeNull();
  });

  test('positions stay strictly ordered after 60 inserts at the same gap', () => {
    let nbs: Notebook[] = [page('a', 'A', null, 0), page('b', 'A', null, 1)];
    const expected = ['a', 'b'];
    for (let i = 0; i < 60; i++) {
      const id = `n${i}`;
      nbs = [...nbs, page(id, 'A', null, 100 + i)];
      const out = movePage(nbs, id, { spaceId: 'A', parentId: null, index: 1 })!;
      nbs = out;
      expected.splice(1, 0, id);
      expect(ids(childrenOf(nbs, 'A', null))).toEqual(expected);
    }
  });
});

describe('positionBetween', () => {
  test('handles the ends and the middle', () => {
    expect(positionBetween(undefined, undefined)).toBe(0);
    expect(positionBetween(3, undefined)).toBe(4);
    expect(positionBetween(undefined, 3)).toBe(2);
    expect(positionBetween(1, 2)).toBe(1.5);
  });
});

describe('deletePageTree', () => {
  test('removes the page and every descendant', () => {
    const out = deletePageTree(fixture(), 'p1');
    expect(out.removed.sort()).toEqual(['c1', 'c2', 'g1', 'p1']);
    expect(ids(out.notebooks).sort()).toEqual(['p2', 'q1']);
  });
});

describe('nextActiveAfterDelete', () => {
  test('prefers the parent, then siblings, then the first page', () => {
    const before = fixture();
    expect(nextActiveAfterDelete(before, spaces, 'c1', deletePageTree(before, 'c1').notebooks)).toBe('p1');
    expect(nextActiveAfterDelete(before, spaces, 'p1', deletePageTree(before, 'p1').notebooks)).toBe('p2');
    expect(nextActiveAfterDelete(before, spaces, 'p2', deletePageTree(before, 'p2').notebooks)).toBe('p1');
    const noA = before.filter((n) => n.spaceId !== 'A');
    expect(nextActiveAfterDelete(before, spaces, 'p1', noA)).toBe('q1');
    expect(nextActiveAfterDelete(before, spaces, 'q1', [])).toBeNull();
  });
});

describe('displayTitle', () => {
  test('shows Untitled for blank titles', () => {
    expect(displayTitle('  ')).toBe('Untitled');
    expect(displayTitle('')).toBe('Untitled');
    expect(displayTitle('Hi')).toBe('Hi');
  });
});
