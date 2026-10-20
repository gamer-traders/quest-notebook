// @vitest-environment jsdom
// jsdom's localStorage is an in-memory Storage, so the saved appearance never touches a real browser.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ChartCell, Notebook, PlanCell, Space } from './types';
import type { PageBlock } from './page/blockTypes';
import { blockText, chartAboveItem, itemSequence } from './page/blocks';
import { childrenOf } from './page/tree';
import { SAMPLE_SPACES, seedNotebooks } from './lib/seed';
import { todayLabel } from './lib/format';
import { APPEARANCE_KEY, followSystemTheme, useStore } from './store';
import { DEFAULT_APPEARANCE, type Appearance } from './lib/appearance';

const chart = (id: string): ChartCell => ({
  id, type: 'chart', symbol: 'BTCUSDT', interval: '1d', asOf: 0, revealed: false, practice: false, levels: [], trends: [], pins: [],
});
const plan = (id: string): PlanCell => ({ id, type: 'plan', side: 'long', entry: 100, stop: 90, target: 120, reason: 'Retest' });

const block = (id: string, type: string, props: Record<string, unknown> = {}): PageBlock => ({ id, type, props, content: [], children: [] });
const blocks = [block('a1', 'paragraph'), block('c1', 'chart', { itemId: 'c1' }), block('p1', 'tradePlan', { itemId: 'p1' })];

const nb = (): Notebook => ({
  id: 'n1', title: 'BTC levels', spaceId: 'space-market', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks, items: { c1: chart('c1'), p1: plan('p1') },
});

const notebook = (id = 'n1') => useStore.getState().notebooks.find((n) => n.id === id)!;
const titleOf = () => null;

beforeEach(() => {
  localStorage.clear();
  useStore.setState({
    notebooks: [nb()],
    spaces: SAMPLE_SPACES.map((s) => ({ ...s })),
    journalSpaceId: 'space-journal',
    expanded: {},
    panelCollapsed: {},
    activeId: null,
    view: 'notebook',
    flashBlockId: null,
    focusTitleId: null,
    appearance: DEFAULT_APPEARANCE,
    theme: 'light',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const state = () => useStore.getState();
const ids = (nbs: Notebook[]) => nbs.map((n) => n.id);
const titles = (nbs: Notebook[]) => nbs.map((n) => n.title);

/** Half past midnight, local time: still the day before in UTC, east of Greenwich. */
const pastMidnight = () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 20, 0, 30));
};

const SPACES: Space[] = [
  { id: 'space-journal', name: 'Journal' },
  { id: 'A', name: 'A' },
  { id: 'B', name: 'B' },
];

const page = (id: string, spaceId: string, parentId: string | null, position: number, extra: Partial<Notebook> = {}): Notebook => ({
  id, title: `${id} title`, spaceId, parentId, position, createdAt: 0, updatedAt: 0, blocks: [block(`b-${id}`, 'paragraph')], items: {}, ...extra,
});

/** Space A: p1 (c1 (g1), c2) and p2. Space B: q1. Journal: yesterday's page, with an ETH 1h chart. */
const tree = (): Notebook[] => [
  page('p1', 'A', null, 0),
  page('c1', 'A', 'p1', 0),
  page('g1', 'A', 'c1', 0),
  page('c2', 'A', 'p1', 1),
  page('p2', 'A', null, 1),
  page('q1', 'B', null, 0),
  page('j0', 'space-journal', null, 0, {
    title: '19 Oct 2026',
    journalDate: '2026-10-19',
    createdAt: 5,
    blocks: [block('jc', 'chart', { itemId: 'jc' })],
    items: { jc: { ...chart('jc'), symbol: 'ETHUSDT', interval: '1h' } },
  }),
];

const useTree = (activeId: string | null = 'p1') =>
  useStore.setState({ notebooks: tree(), spaces: SPACES, journalSpaceId: 'space-journal', activeId });

test('addItem then setBlocks keeps the item reachable', () => {
  const { addItem, setBlocks, openNotebook } = useStore.getState();
  addItem('n1', chart('c2'));
  setBlocks('n1', [...blocks, block('c2', 'chart', { itemId: 'c2' })]);
  openNotebook('n1');
  expect(itemSequence(notebook()).map((i) => i.id)).toEqual(['c1', 'p1', 'c2']);
});

test('updateItem patches only that item', () => {
  const before = notebook().items.p1;
  useStore.getState().updateItem<ChartCell>('n1', 'c1', { levels: [{ id: 'l1', price: 70000 }] });
  const after = notebook();
  expect((after.items.c1 as ChartCell).levels).toEqual([{ id: 'l1', price: 70000 }]);
  expect(after.items.p1).toEqual(before);
});

test('openNotebook prunes data whose block is gone', () => {
  const { setBlocks, openNotebook } = useStore.getState();
  setBlocks('n1', blocks.filter((b) => b.id !== 'c1'));
  expect(notebook().items.c1).toBeDefined();
  openNotebook('n1', 'p1');
  expect(notebook().items.c1).toBeUndefined();
  expect(notebook().items.p1).toBeDefined();
  expect(useStore.getState().flashBlockId).toBe('p1');
});

test('openNotebook leaves the page that is showing alone', () => {
  useStore.setState({ activeId: 'n1' });
  const { setBlocks, openNotebook } = useStore.getState();
  setBlocks('n1', blocks.filter((b) => b.id !== 'c1'));
  openNotebook('n1', 'p1');
  expect(notebook().items.c1).toBeDefined();
});

test('openTodayJournal builds the template', () => {
  useStore.getState().openTodayJournal();
  const { activeId } = useStore.getState();
  const journal = notebook(activeId!);
  expect(journal.spaceId).toBe('space-journal');
  expect(journal.blocks.map((b) => b.type)).toEqual(['chart', 'heading', 'paragraph', 'heading', 'paragraph', 'paragraph']);
  expect(blockText(journal.blocks[1], titleOf)).toBe('What I see');
  expect(blockText(journal.blocks[3], titleOf)).toBe("What I'm watching");
  expect(blockText(journal.blocks[5], titleOf)).toBe('#journal');
  const chartBlock = journal.blocks[0];
  expect(chartBlock.props.itemId).toBe(chartBlock.id);
  expect((journal.items[chartBlock.id] as ChartCell).interval).toBe('4h');
});

test("openTodayJournal copies the latest journal page's chart", () => {
  useTree();
  state().openTodayJournal();
  const journal = notebook(state().activeId!);
  expect(journal.items[journal.blocks[0].id]).toMatchObject({ type: 'chart', symbol: 'ETHUSDT', interval: '1h' });
});

test('createPage appends to the end of its siblings and opens it with the title focused', () => {
  useTree('q1');
  const id = state().createPage('A', 'p1', 'Wedges');
  expect(ids(childrenOf(state().notebooks, 'A', 'p1'))).toEqual(['c1', 'c2', id]);
  const created = notebook(id);
  expect(created.title).toBe('Wedges');
  expect(created.blocks.map((b) => b.type)).toEqual(['paragraph']);
  expect(created.items).toEqual({});
  expect(state()).toMatchObject({ activeId: id, view: 'notebook', focusTitleId: id });
  expect(state().expanded.p1).toBe(true);

  // Without opening it, the page being written stays open. A page with no title is blank.
  const quiet = state().createPage('B', null, undefined, false);
  expect(ids(childrenOf(state().notebooks, 'B', null))).toEqual(['q1', quiet]);
  expect(notebook(quiet).title).toBe('');
  expect(state()).toMatchObject({ activeId: id, focusTitleId: id });
});

test("movePage refuses a move into a page's own sub-page and changes nothing", () => {
  useTree();
  const before = state().notebooks;
  expect(state().movePage('p1', { spaceId: 'A', parentId: 'g1', index: 0 })).toBe(false);
  expect(state().movePage('p1', { spaceId: 'A', parentId: 'p1', index: 0 })).toBe(false);
  expect(state().notebooks).toBe(before);
  expect(state().expanded).toEqual({});
});

test('movePage refuses a missing page, parent or space, a parent in another space, and a bad index', () => {
  useTree();
  const before = state().notebooks;
  const { movePage } = state();
  expect(movePage('gone', { spaceId: 'A', parentId: null, index: 0 })).toBe(false);
  expect(movePage('p2', { spaceId: 'A', parentId: 'gone', index: 0 })).toBe(false);
  expect(movePage('p2', { spaceId: 'B', parentId: 'c1', index: 0 })).toBe(false);
  expect(movePage('p2', { spaceId: 'gone', parentId: null, index: 0 })).toBe(false);
  expect(movePage('p2', { spaceId: 'A', parentId: null, index: NaN })).toBe(false);
  expect(movePage('p2', { spaceId: 'A', parentId: null, index: Infinity })).toBe(false);
  expect(movePage('p2', { spaceId: 'A', parentId: null, index: 0.5 })).toBe(false);
  expect(state().notebooks).toBe(before);
});

test('moving a page into another space brings its sub-pages', () => {
  useTree();
  expect(state().movePage('p1', { spaceId: 'B', parentId: 'q1', index: 0 })).toBe(true);
  const nbs = state().notebooks;
  expect(ids(childrenOf(nbs, 'A', null))).toEqual(['p2']);
  expect(ids(childrenOf(nbs, 'B', 'q1'))).toEqual(['p1']);
  expect(ids(childrenOf(nbs, 'B', 'p1'))).toEqual(['c1', 'c2']);
  expect(ids(childrenOf(nbs, 'B', 'c1'))).toEqual(['g1']);
  expect(state().expanded.q1).toBe(true);
});

test("deletePage on the open page's parent opens the grandparent", () => {
  useTree('g1');
  useStore.setState({ expanded: { c1: true, p1: true } });
  state().deletePage('c1');
  expect(ids(state().notebooks)).toEqual(['p1', 'c2', 'p2', 'q1', 'j0']);
  expect(state().activeId).toBe('p1');
  expect(state().expanded).toEqual({ p1: true });

  // Deleting a page that isn't open leaves the open one, and the review stays up if it was showing.
  useStore.setState({ view: 'review' });
  state().deletePage('q1');
  expect(state()).toMatchObject({ activeId: 'p1', view: 'review' });
});

test('deleteSpace removes its pages and refuses the last space', () => {
  useTree('g1');
  state().deleteSpace('A');
  expect(state().spaces.map((s) => s.id)).toEqual(['space-journal', 'B']);
  expect(ids(state().notebooks)).toEqual(['q1', 'j0']);
  expect(state().activeId).toBe('j0');

  state().deleteSpace('space-journal');
  expect(ids(state().notebooks)).toEqual(['q1']);
  expect(state().activeId).toBe('q1');
  expect(state().journalSpaceId).toBeNull();

  state().deleteSpace('B');
  expect(state().spaces.map((s) => s.id)).toEqual(['B']);
  expect(ids(state().notebooks)).toEqual(['q1']);
});

test('createSpace appends, renameSpace renames and moveSpace reorders', () => {
  useTree();
  const id = state().createSpace();
  expect(state().spaces.at(-1)).toEqual({ id, name: 'New space' });
  state().renameSpace('space-journal', 'Diary');
  state().moveSpace(id, 0);
  expect(state().spaces.map((s) => s.name)).toEqual(['New space', 'Diary', 'A', 'B']);
  state().moveSpace(id, 99);
  expect(state().spaces.map((s) => s.name)).toEqual(['Diary', 'A', 'B', 'New space']);
  state().moveSpace(id, NaN);
  expect(state().spaces.map((s) => s.name)).toEqual(['Diary', 'A', 'B', 'New space']);

  // The journal space is known by its id, so a renamed one still takes today's page.
  state().openTodayJournal();
  expect(notebook(state().activeId!).spaceId).toBe('space-journal');
});

test("openTodayJournal adds today's page at the top of the journal space", () => {
  pastMidnight();
  useTree();
  state().openTodayJournal();
  const top = childrenOf(state().notebooks, 'space-journal', null);
  expect(titles(top)).toEqual([todayLabel(), '19 Oct 2026']);
  const today = top[0];
  expect(today.title).toBe('20 Oct 2026');
  expect(today.journalDate).toBe('2026-10-20');
  expect(state().activeId).toBe(today.id);

  // A second call opens the same page, wherever it has been moved, and makes no new one.
  state().movePage(today.id, { spaceId: 'B', parentId: 'q1', index: 0 });
  state().openNotebook('p1');
  const count = state().notebooks.length;
  state().openTodayJournal();
  expect(state().activeId).toBe(today.id);
  expect(state().notebooks).toHaveLength(count);

  // A page from before journal dates is found by its old title, in any space.
  useTree();
  useStore.setState({ notebooks: [...tree(), page('old', 'B', 'q1', 0, { title: `Journal: ${todayLabel()}` })] });
  state().openTodayJournal();
  expect(state().activeId).toBe('old');
  expect(state().notebooks).toHaveLength(tree().length + 1);
});

test('openTodayJournal recreates a deleted journal space at the top', () => {
  useTree();
  state().deleteSpace('space-journal');
  state().openTodayJournal();
  const { spaces, journalSpaceId, notebooks, activeId } = state();
  expect(spaces.map((s) => s.name)).toEqual(['Journal', 'A', 'B']);
  expect(journalSpaceId).toBe(spaces[0].id);
  const top = childrenOf(notebooks, spaces[0].id, null);
  expect(titles(top)).toEqual([todayLabel()]);
  expect(activeId).toBe(top[0].id);
});

test('expanded rows and collapsed panels are kept', () => {
  useTree();
  state().toggleExpanded('p1');
  expect(state().expanded).toEqual({ p1: true });
  state().toggleExpanded('p1');
  expect(state().expanded).toEqual({});
  state().setPanelCollapsed('p1', true);
  expect(state().panelCollapsed).toEqual({ p1: true });
  state().setPanelCollapsed('p1', false);
  expect(state().panelCollapsed).toEqual({});
  useStore.setState({ focusTitleId: 'p1' });
  state().clearFocusTitle();
  expect(state().focusTitleId).toBeNull();
});

/** A stand-in for the computer's light or dark setting, which jsdom lacks. */
function stubComputer(dark: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const query = {
    media: '(prefers-color-scheme: dark)',
    matches: dark,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.delete(fn),
  };
  const other = (media: string) => ({ media, matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal('matchMedia', (media: string) => (media === query.media ? query : other(media)));
  return {
    switchTo(next: boolean) {
      query.matches = next;
      for (const fn of [...listeners]) fn({ matches: next });
    },
    listening: () => listeners.size,
  };
}

const html = () => document.documentElement.dataset;
const savedState = () => JSON.parse(localStorage.getItem(APPEARANCE_KEY)!).state;
const saveAppearance = (appearance: unknown) => localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ state: { appearance }, version: 1 }));

test('each appearance choice applies at once to the page and is saved', () => {
  stubComputer(false);
  const choices: Partial<Appearance>[] = [{ density: 'compact' }, { textSize: 'large' }, { pageWidth: 'full' }, { noteFont: 'sans' }, { theme: 'dark' }];
  let expected = DEFAULT_APPEARANCE;
  for (const choice of choices) {
    state().setAppearance(choice);
    expected = { ...expected, ...choice };
    expect(state().appearance).toEqual(expected);
    expect(savedState().appearance).toEqual(expected);
  }
  expect(html()).toMatchObject({ theme: 'dark', density: 'compact', textSize: 'large', pageWidth: 'full', noteFont: 'sans' });
  // The resolved theme, which charts and the editor read, follows, and only the choices are saved.
  expect(state().theme).toBe('dark');
  expect(Object.keys(savedState())).toEqual(['appearance']);
});

test("choosing System takes the computer's setting", () => {
  stubComputer(true);
  state().setAppearance({ theme: 'system' });
  expect(state().theme).toBe('dark');
  expect(html().theme).toBe('dark');
  state().setAppearance({ theme: 'light' });
  expect(state().theme).toBe('light');
  expect(html().theme).toBe('light');
});

test('resetAppearance restores the defaults', () => {
  stubComputer(true);
  state().setAppearance({ theme: 'light', density: 'comfortable', textSize: 'small', pageWidth: 'narrow', noteFont: 'sans' });
  state().resetAppearance();
  expect(state().appearance).toEqual(DEFAULT_APPEARANCE);
  expect(savedState().appearance).toEqual(DEFAULT_APPEARANCE);
  // Back on System, and the computer is dark.
  expect(state().theme).toBe('dark');
  expect(html()).toMatchObject({ theme: 'dark', density: 'default', textSize: 'default', pageWidth: 'default', noteFont: 'serif' });
});

test('while the choice is System, the theme follows the computer when it switches', () => {
  const computer = stubComputer(false);
  state().setAppearance({ theme: 'system' });
  const stop = followSystemTheme();
  expect(state().theme).toBe('light');

  computer.switchTo(true);
  expect(state().theme).toBe('dark');
  expect(html().theme).toBe('dark');

  // A fixed choice stays put.
  state().setAppearance({ theme: 'light' });
  computer.switchTo(false);
  computer.switchTo(true);
  expect(state().theme).toBe('light');

  stop();
  expect(computer.listening()).toBe(0);
});

test('a hidden tab shows a switch of the computer at once, but saves nothing until it is seen again', () => {
  const computer = stubComputer(false);
  let hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  try {
    state().setAppearance({ theme: 'system' });
    const stop = followSystemTheme();
    const before = localStorage.getItem(APPEARANCE_KEY);

    hidden = true;
    computer.switchTo(true);
    expect(html().theme).toBe('dark');
    expect(state().theme).toBe('light');
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe(before);

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(state().theme).toBe('dark');

    // Once stopped, neither a switch nor being seen again changes anything.
    stop();
    computer.switchTo(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(state().theme).toBe('dark');
  } finally {
    Reflect.deleteProperty(document, 'hidden');
  }
});

test.each([
  ['throws', () => { throw new Error('No media queries here.'); }],
  ['returns null', () => null],
])('when matchMedia %s, loading still keeps the saved look', async (_, matchMedia) => {
  vi.stubGlobal('matchMedia', matchMedia);
  useStore.setState(useStore.getInitialState());
  saveAppearance({ ...DEFAULT_APPEARANCE, theme: 'dark' });
  await useStore.persist.rehydrate();
  expect(state().appearance).toEqual({ ...DEFAULT_APPEARANCE, theme: 'dark' });
  expect(state().theme).toBe('dark');

  // Without the computer's setting, System shows light, and following it does nothing.
  state().setAppearance({ theme: 'system' });
  expect(state().theme).toBe('light');
  expect(() => followSystemTheme()()).not.toThrow();
});

test('a saved System choice is resolved against the computer on load, whatever theme was saved beside it', async () => {
  stubComputer(false);
  const appearance = { ...DEFAULT_APPEARANCE, density: 'comfortable', pageWidth: 'bogus' };
  saveAppearance(appearance);
  await useStore.persist.rehydrate();
  expect(state().appearance).toEqual({ ...DEFAULT_APPEARANCE, density: 'comfortable' });
  expect(state().theme).toBe('light');
});

test('seed nests the practice notebook under Support and resistance', () => {
  pastMidnight();
  const seed = seedNotebooks();
  const byTitle = (title: string) => seed.find((n) => n.title === title)!;
  const sr = byTitle('Support and resistance');
  expect(byTitle('Practice: guess the next move')).toMatchObject({ spaceId: 'space-lesson', parentId: sr.id });
  expect(titles(childrenOf(seed, 'space-journal', null))).toEqual(['20 Oct 2026']);
  expect(childrenOf(seed, 'space-journal', null)[0].journalDate).toBe('2026-10-20');
  expect(titles(childrenOf(seed, 'space-market', null))).toEqual(['Bitcoin, big picture']);
  expect(titles(childrenOf(seed, 'space-lesson', null))).toEqual(['Support and resistance']);

});

test('the app starts with no workspace and no pages, until one is loaded', () => {
  const initial = useStore.getInitialState();
  expect(initial).toMatchObject({ workspace: null, notebooks: [], spaces: [], activeId: null, journalSpaceId: null, diskRevision: {} });
});

test('seed notebooks keep their charts linked', () => {
  const lesson = seedNotebooks().find((n) => n.title === 'Support and resistance')!;
  const seededPlan = itemSequence(lesson).find((i) => i.type === 'plan')!;
  const seededChart = chartAboveItem(lesson, seededPlan.id)!;
  expect(seededChart.type).toBe('chart');
  expect(seededChart.levels).toHaveLength(2);
  expect(seededChart.trends).toHaveLength(1);
  expect(seededChart.pins).toHaveLength(2);
});

const record = (id: string, path: string, parentId: string | null, title: string, extra: object = {}) => ({
  id, spaceId: 'A', parentId, path, mtimeMs: 0, file: { id, title, position: 0, created: '2026-10-20T00:00:00Z', updated: '2026-10-20T00:00:00Z', blocks: [], ...extra },
});

test('applyDiskDelta replaces changed pages, removes gone ones, and bumps their disk revision', () => {
  useTree('p2');
  state().toggleExpanded('p2');
  state().applyDiskDelta({
    spaces: SPACES,
    journalSpaceId: 'space-journal',
    pages: [record('p1', 'A/p1.json', null, 'Renamed outside')],
    removed: ['p2'],
  });
  expect(notebook('p1').title).toBe('Renamed outside');
  expect(state().notebooks.some((n) => n.id === 'p2')).toBe(false);
  expect(state().diskRevision).toEqual({ p1: 1 });
  expect(state().expanded).toEqual({});
  // The open page went, and nothing comes after it, so the page before it opens.
  expect(state().activeId).toBe('p1');
});

test('applyDiskDelta takes the spaces from disk', () => {
  useTree();
  const spaces = [...SPACES, { id: 'C', name: 'Ideas' }];
  state().applyDiskDelta({ spaces, journalSpaceId: null, pages: [], removed: [] });
  expect(state().spaces).toEqual(spaces);
  expect(state().journalSpaceId).toBeNull();
});

test('a page whose file is fixed stays open under its real id', () => {
  useStore.setState({ notebooks: [page('bad:A/x.json', 'A', null, 0, { path: 'A/x.json', loadError: 'broken' })], spaces: SPACES, activeId: 'bad:A/x.json' });
  state().applyDiskDelta({ spaces: SPACES, journalSpaceId: null, pages: [record('x1', 'A/x.json', null, 'X')], removed: ['bad:A/x.json'] });
  expect(state().activeId).toBe('x1');
  expect(notebook('x1').loadError).toBeUndefined();
});
