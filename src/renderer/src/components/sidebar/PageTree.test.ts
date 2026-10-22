// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useStore } from '../../store';
import type { Notebook } from '../../types';
import { useClaude } from '../../claude/store';
import { PageTree } from './PageTree';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lays nothing out, so a picked-up row has nowhere to scroll to.
Element.prototype.scrollIntoView ??= () => {};

const page = (id: string, title: string, spaceId: string, parentId: string | null = null, position = 0): Notebook => ({
  id,
  title,
  spaceId,
  parentId,
  position,
  createdAt: 0,
  updatedAt: 0,
  blocks: [],
  items: {},
});

// Markets: Levels > Weekly > Monday, then Notes. Journal: Today.
const notebooks = [page('levels', 'Levels', 'm'), page('weekly', 'Weekly', 'm', 'levels'), page('monday', 'Monday', 'm', 'weekly'), page('notes', 'Notes', 'm', null, 1), page('today', 'Today', 'j')];
const spaces = [
  { id: 'm', name: 'Markets' },
  { id: 'j', name: 'Journal' },
];

let host: HTMLElement;
let root: Root;

beforeEach(async () => {
  useStore.setState({ notebooks, spaces, expanded: { levels: true, weekly: true }, activeId: null, view: 'notebook' });
  useClaude.setState({ running: null });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(PageTree, { onNavigate: () => {} })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const lockOn = (pageId: string | null) => act(() => useClaude.setState({ running: pageId === null ? null : { chatId: 'c1', messageId: 'm1', lockedPageId: pageId } }));
const moreButton = (name: string) => host.querySelector<HTMLButtonElement>(`[aria-label="More for ${name}"]`)!;

/** The ⋯ menu's items for a page or space, each with whether it can be chosen, and the menu closed again. */
async function menu(name: string): Promise<Record<string, boolean>> {
  await act(async () => moreButton(name).click());
  const items = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  const shown = Object.fromEntries(items.map((b) => [b.textContent, b.getAttribute('aria-disabled') !== 'true']));
  await act(async () => moreButton(name).click());
  return shown;
}

const pageMenu = (deleteLabel = 'Delete page') => ({ 'Add sub-page': true, Rename: true, 'Move to…': true, 'Copy link for [[ ]]': true, [deleteLabel]: true });
const spaceMenu = { Rename: true, 'Delete space': true };

test('with no turn running, every menu item can be chosen', async () => {
  expect(await menu('Levels')).toEqual(pageMenu('Delete page and 2 sub-pages'));
  expect(await menu('Weekly')).toEqual(pageMenu('Delete page and 1 sub-page'));
  expect(await menu('Markets')).toEqual(spaceMenu);
});

test("while Claude works on a page, it can't be renamed, moved or deleted, nor can the pages and space that hold it be deleted", async () => {
  lockOn('weekly');
  expect(await menu('Weekly')).toEqual({ ...pageMenu('Delete page and 1 sub-page'), Rename: false, 'Move to…': false, 'Delete page and 1 sub-page': false });
  // Deleting a page above it would trash it too.
  expect(await menu('Levels')).toEqual({ ...pageMenu('Delete page and 2 sub-pages'), 'Delete page and 2 sub-pages': false });
  expect(await menu('Markets')).toEqual({ ...spaceMenu, 'Delete space': false });
  // Pages below it, beside it, and in other spaces are left alone.
  expect(await menu('Monday')).toEqual(pageMenu());
  expect(await menu('Notes')).toEqual(pageMenu());
  expect(await menu('Journal')).toEqual(spaceMenu);

  // A disabled item says why, and choosing it does nothing.
  const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
  await act(async () => moreButton('Levels').click());
  const remove = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.startsWith('Delete'))!;
  expect(remove.title).toBe('Claude is working on one of its sub-pages');
  await act(async () => remove.click());
  expect(ask).not.toHaveBeenCalled();
  expect(useStore.getState().notebooks).toHaveLength(notebooks.length);
  await act(async () => moreButton('Levels').click());

  // Once the reply ends, all as before.
  lockOn(null);
  expect(await menu('Weekly')).toEqual(pageMenu('Delete page and 1 sub-page'));
  expect(await menu('Levels')).toEqual(pageMenu('Delete page and 2 sub-pages'));
  expect(await menu('Markets')).toEqual(spaceMenu);
});

test("a page Claude is working on can't be picked up to drag; the rest can", async () => {
  const title = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('.row-title')].find((b) => b.textContent === name)!;
  const pickUp = (name: string) =>
    act(async () => {
      title(name).focus();
      title(name).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
    });
  const ghost = () => document.querySelector('.drag-ghost')?.textContent ?? null;
  const putBack = () => act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })));

  lockOn('weekly');
  await pickUp('Weekly');
  expect(ghost()).toBeNull();
  // Its title still opens it, and isn't announced as unavailable.
  expect(title('Weekly').getAttribute('aria-disabled')).not.toBe('true');

  await pickUp('Notes');
  expect(ghost()).toBe('Notes');
  await putBack();

  lockOn(null);
  await vi.waitFor(() => expect(ghost()).toBeNull());
  await pickUp('Weekly');
  expect(ghost()).toBe('Weekly');
  await putBack();
});
