import type { FileChange } from '@shared/ipc';
import { describe, expect, test } from 'vitest';
import { TurnChanges, repairChanges } from './turns';

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

describe("the app's own tidy-up of what a turn wrote", () => {
  const page = change('Markets/A.json', 'mine', 'claude', { pageId: 'a' });
  const drawing = (path: string, after: string, extra: Partial<FileChange> = {}) => change(path, null, after, { pageId: 'a', drawing: true, ...extra });

  test('a change whose after is where the tidy-up started now ends where it left the file', () => {
    const other = change('Markets/B.json', 'x', 'y');
    const out = repairChanges([page, other], [
      { path: 'Markets/A.json', before: 'claude', after: 'tidied' },
      // Not what the turn left: someone changed it since.
      { path: 'Markets/B.json', before: 'z', after: 'w' },
      // Not the turn's.
      { path: 'Markets/C.json', before: 'c', after: 'd' },
    ]);
    expect(out).toEqual({ changes: [{ ...page, after: 'tidied' }, other], added: [], changed: true });
  });

  test('a new drawing file beside a page it tidied is recorded as created, sorted beside its page', () => {
    const out = repairChanges(
      [change('Markets/B.json', 'x', 'y'), { ...page, newSpace: true }],
      [
        { path: 'Markets/A.json', before: 'claude', after: 'tidied' },
        { path: 'Markets/A/drawing-d1.svg', before: null, after: '<svg/>' },
      ],
    );
    expect(out.changes).toEqual([
      { ...page, newSpace: true, after: 'tidied' },
      drawing('Markets/A/drawing-d1.svg', '<svg/>', { newSpace: true }),
      change('Markets/B.json', 'x', 'y'),
    ]);
    expect(out.added).toEqual([{ path: 'Markets/A/drawing-d1.svg', page: 'Markets/A.json' }]);
  });

  test('the page file listed unchanged still lets a drawing in', () => {
    const out = repairChanges([page], [
      { path: 'Markets/A.json', before: 'claude', after: 'claude' },
      { path: 'Markets/A/drawing-d1.svg', before: null, after: '<svg/>' },
    ]);
    expect(out.changes).toEqual([page, drawing('Markets/A/drawing-d1.svg', '<svg/>')]);
    expect(out.changed).toBe(true);
  });

  test('no drawing is added beside a page the turn did not leave as the tidy-up found it, or that was undone', () => {
    const files = [
      { path: 'Markets/A.json', before: 'owner', after: 'tidied' },
      { path: 'Markets/A/drawing-d1.svg', before: null, after: '<svg/>' },
    ];
    expect(repairChanges([page], files)).toEqual({ changes: [page], added: [], changed: false });
    // Not listed at all.
    expect(repairChanges([page], [files[1]])).toEqual({ changes: [page], added: [], changed: false });
    // A drawing in another page's folder, or deeper.
    const elsewhere = [
      { path: 'Markets/A.json', before: 'claude', after: 'claude' },
      { path: 'Markets/AB/drawing-d1.svg', before: null, after: '<svg/>' },
      { path: 'Markets/A/x/drawing-d1.svg', before: null, after: '<svg/>' },
      { path: 'Markets/A/notes.svg', before: null, after: '<svg/>' },
    ];
    expect(repairChanges([page], elsewhere).changed).toBe(false);
    // Undone: left as it is.
    const undone = new Set(['Markets/A.json']);
    expect(repairChanges([page], [{ path: 'Markets/A.json', before: 'claude', after: 'tidied' }, files[1]], undone)).toEqual({ changes: [page], added: [], changed: false });
  });

  test('a drawing already recorded is moved forward, not added again, and a second pass changes nothing', () => {
    const recorded = drawing('Markets/A/drawing-d1.svg', '<svg/>');
    const files = [
      { path: 'Markets/A.json', before: 'claude', after: 'tidied' },
      { path: 'Markets/A/drawing-d1.svg', before: '<svg/>', after: '<svg tidied/>' },
    ];
    const once = repairChanges([page, recorded], files);
    expect(once.changes).toEqual([{ ...page, after: 'tidied' }, { ...recorded, after: '<svg tidied/>' }]);
    expect(once.added).toEqual([]);
    expect(repairChanges(once.changes, files)).toEqual({ changes: once.changes, added: [], changed: false });
  });

  test('a running turn takes the tidy-up in, and a file changed and changed back is not the turn’s to move', () => {
    const turn = new TurnChanges();
    turn.add([change('Markets/A.json', 'mine', 'claude', { pageId: 'a' }), change('Markets/B.json', 'b', 'b2')]);
    turn.add([change('Markets/B.json', 'b2', 'b')]);
    const added = turn.repair([
      { path: 'Markets/A.json', before: 'claude', after: 'tidied' },
      { path: 'Markets/A/drawing-d1.svg', before: null, after: '<svg/>' },
      { path: 'Markets/B.json', before: 'b', after: 'b tidied' },
    ]);
    expect(added).toEqual([{ path: 'Markets/A/drawing-d1.svg', page: 'Markets/A.json' }]);
    expect(turn.list()).toEqual([change('Markets/A.json', 'mine', 'tidied', { pageId: 'a' }), drawing('Markets/A/drawing-d1.svg', '<svg/>')]);
    // Claude writes the page again later in the turn: the tidy-up was its starting point.
    turn.add([change('Markets/A.json', 'tidied', 'claude again', { pageId: 'a' })]);
    expect(turn.list()[0]).toEqual(change('Markets/A.json', 'mine', 'claude again', { pageId: 'a' }));
  });
});
