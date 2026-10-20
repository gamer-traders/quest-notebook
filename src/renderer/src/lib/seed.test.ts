import { expect, test } from 'vitest';
import { childrenOf } from '../page/tree';
import { seedFor } from './seed';

test('sample pages go in the workspace’s own spaces, matched by name', () => {
  const spaces = [{ id: 's_j', name: 'Journal' }, { id: 's_m', name: 'Markets' }, { id: 's_l', name: 'Lessons' }];
  const pages = seedFor(spaces);
  expect(pages.map((p) => p.spaceId).sort()).toEqual(['s_j', 's_l', 's_l', 's_m']);
  const lesson = pages.find((p) => p.title === 'Support and resistance')!;
  expect(pages.find((p) => p.title === 'Practice: guess the next move')).toMatchObject({ spaceId: 's_l', parentId: lesson.id });
  expect(childrenOf(pages, 's_m', null).map((p) => p.title)).toEqual(['Bitcoin, big picture']);
});

test('a sample whose space is missing is left out, with the pages under it', () => {
  const pages = seedFor([{ id: 's_m', name: 'Markets' }]);
  expect(pages.map((p) => p.title)).toEqual(['Bitcoin, big picture']);
});
