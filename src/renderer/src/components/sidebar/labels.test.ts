import { expect, test } from 'vitest';
import { deletePageLabel, deletePageQuestion, deleteSpaceQuestion } from './labels';

test('the page delete item names how many sub-pages go with it', () => {
  expect(deletePageLabel(0)).toBe('Delete page');
  expect(deletePageLabel(1)).toBe('Delete page and 1 sub-page');
  expect(deletePageLabel(2)).toBe('Delete page and 2 sub-pages');
});

test('the confirmations read as written', () => {
  expect(deletePageQuestion('Weekly levels', 0)).toBe('Delete “Weekly levels”?');
  expect(deletePageQuestion('Weekly levels', 1)).toBe('Delete “Weekly levels” and its 1 sub-page?');
  expect(deletePageQuestion('Weekly levels', 3)).toBe('Delete “Weekly levels” and its 3 sub-pages?');
  expect(deleteSpaceQuestion('Crypto', 1)).toBe('Delete the space “Crypto” and its 1 page?');
  expect(deleteSpaceQuestion('Crypto', 4)).toBe('Delete the space “Crypto” and its 4 pages?');
});
