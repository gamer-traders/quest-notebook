import { describe, expect, test } from 'vitest';
import type { Notebook } from '../../types';
import { childrenOf, movePage } from '../../page/tree';
import { dropIntent, targetFor } from './dropIntent';

const page = (id: string, spaceId: string, parentId: string | null, position: number): Notebook => ({
  id, title: id, spaceId, parentId, position, createdAt: 0, updatedAt: 0, blocks: [], items: {},
});

// Space S: a, b (with b1 and b2), c, d. Space T: x.
const fixture = (): Notebook[] => [
  page('a', 'S', null, 0),
  page('b', 'S', null, 1),
  page('b1', 'S', 'b', 0),
  page('b2', 'S', 'b', 1),
  page('c', 'S', null, 2),
  page('d', 'S', null, 3),
  page('x', 'T', null, 0),
];

const order = (nbs: Notebook[], spaceId: string, parentId: string | null) => childrenOf(nbs, spaceId, parentId).map((n) => n.id);

describe('dropIntent', () => {
  test('dropIntent splits a row into quarters', () => {
    expect(dropIntent(100, 40, 105)).toBe('before');
    expect(dropIntent(100, 40, 120)).toBe('inside');
    expect(dropIntent(100, 40, 136)).toBe('after');
  });

  test('the edges of the row belong to before and after', () => {
    expect(dropIntent(100, 40, 100)).toBe('before');
    expect(dropIntent(100, 40, 140)).toBe('after');
  });
});

describe('targetFor', () => {
  test('targetFor nests on inside and orders on before and after', () => {
    const nbs = fixture();
    // Inside makes it the last sub-page.
    expect(targetFor(nbs, 'b', 'inside', 'd')).toEqual({ spaceId: 'S', parentId: 'b', index: 2 });
    expect(targetFor(nbs, 'a', 'inside', 'd')).toEqual({ spaceId: 'S', parentId: 'a', index: 0 });
    // Before and after are among the row's own siblings.
    expect(targetFor(nbs, 'c', 'before', 'd')).toEqual({ spaceId: 'S', parentId: null, index: 2 });
    expect(targetFor(nbs, 'a', 'after', 'd')).toEqual({ spaceId: 'S', parentId: null, index: 1 });
    expect(targetFor(nbs, 'b1', 'before', 'd')).toEqual({ spaceId: 'S', parentId: 'b', index: 0 });
    expect(targetFor(nbs, 'b2', 'after', 'd')).toEqual({ spaceId: 'S', parentId: 'b', index: 2 });
    // Another space.
    expect(targetFor(nbs, 'x', 'after', 'a')).toEqual({ spaceId: 'T', parentId: null, index: 1 });
  });

  test('dragging a page down within its parent counts the siblings without it', () => {
    const nbs = fixture();
    // a goes after c: without a the siblings are b, c, d, so after c is index 2.
    const down = targetFor(nbs, 'c', 'after', 'a');
    expect(down).toEqual({ spaceId: 'S', parentId: null, index: 2 });
    expect(order(movePage(nbs, 'a', down)!, 'S', null)).toEqual(['b', 'c', 'a', 'd']);

    const beforeD = targetFor(nbs, 'd', 'before', 'a');
    expect(order(movePage(nbs, 'a', beforeD)!, 'S', null)).toEqual(['b', 'c', 'a', 'd']);

    // Up works too: d before b.
    const up = targetFor(nbs, 'b', 'before', 'd');
    expect(order(movePage(nbs, 'd', up)!, 'S', null)).toEqual(['a', 'd', 'b', 'c']);

    // Inside its own parent, a sub-page goes last, counted without itself.
    const last = targetFor(nbs, 'b', 'inside', 'b1');
    expect(last).toEqual({ spaceId: 'S', parentId: 'b', index: 1 });
    expect(order(movePage(nbs, 'b1', last)!, 'S', 'b')).toEqual(['b2', 'b1']);
  });
});
