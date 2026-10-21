import type { FileChange } from '@shared/ipc';
import { expect, test } from 'vitest';
import { TurnChanges } from './turns';

const change = (path: string, before: string | null, after: string | null, extra: Partial<FileChange> = {}): FileChange => ({
  path,
  kind: before === null ? 'created' : 'edited',
  drawing: false,
  before,
  after,
  ...extra,
});

test('editing a path twice keeps the first before and the last after', () => {
  const turn = new TurnChanges();
  turn.add([change('Markets/A.json', 'one', 'two', { pageId: 'a' })]);
  turn.add([change('Markets/A.json', 'two', 'three', { pageId: 'a2' })]);
  expect(turn.list()).toEqual([change('Markets/A.json', 'one', 'three', { pageId: 'a2' })]);
});

test('a file created and then edited stays created', () => {
  const turn = new TurnChanges();
  turn.add([change('Markets/B.json', null, 'x')]);
  turn.add([change('Markets/B.json', 'x', 'y')]);
  expect(turn.list()).toEqual([change('Markets/B.json', null, 'y')]);
});

test('a change that ends back at its before is left out', () => {
  const turn = new TurnChanges();
  turn.add([change('Markets/A.json', 'one', 'two')]);
  turn.add([change('Markets/A.json', 'two', 'one')]);
  expect(turn.list()).toEqual([]);
});

test('the list is sorted by path', () => {
  const turn = new TurnChanges();
  turn.add([change('Markets/C.json', 'a', 'b'), change('Markets/A.json', 'a', 'b')]);
  turn.add([change('Lessons/Z.json', 'a', 'b')]);
  expect(turn.list().map((c) => c.path)).toEqual(['Lessons/Z.json', 'Markets/A.json', 'Markets/C.json']);
});

test('newSpace stays set once any change for the path had it', () => {
  const turn = new TurnChanges();
  turn.add([change('New/P.json', null, 'a', { newSpace: true })]);
  turn.add([change('New/P.json', 'a', 'b')]);
  turn.add([change('Markets/A.json', 'a', 'b')]);
  expect(turn.list().map((c) => [c.path, c.newSpace])).toEqual([['Markets/A.json', undefined], ['New/P.json', true]]);
});
