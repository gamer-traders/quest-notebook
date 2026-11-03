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

test("while Claude works on a page, neither it nor the pages and space that hold it can be renamed, moved or deleted", async () => {
  lockOn('weekly');
  expect(await menu('Weekly')).toEqual({ ...pageMenu('Delete page and 1 sub-page'), Rename: false, 'Move to…': false, 'Delete page and 1 sub-page': false });
  // Renaming or moving a page above it moves its file too, and deleting one trashes it.
  expect(await menu('Levels')).toEqual({ ...pageMenu('Delete page and 2 sub-pages'), Rename: false, 'Move to…': false, 'Delete page and 2 sub-pages': false });
  expect(await menu('Markets')).toEqual({ Rename: false, 'Delete space': false });
  // Pages below it, beside it, and in other spaces are left alone.
  expect(await menu('Monday')).toEqual(pageMenu());
  expect(await menu('Notes')).toEqual(pageMenu());
  expect(await menu('Journal')).toEqual(spaceMenu);

  // A disabled item says why, and choosing it does nothing.
  const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const hints = async (name: string) => {
    await act(async () => moreButton(name).click());
    const shown = Object.fromEntries([...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"][aria-disabled="true"]')].map((b) => [b.textContent, b.title]));
    await act(async () => moreButton(name).click());
    return shown;
  };
  expect(await hints('Weekly')).toEqual({
    Rename: 'Claude is working on this page',
    'Move to…': 'Claude is working on this page',
    'Delete page and 1 sub-page': 'Claude is working on this page',
  });
  expect(await hints('Levels')).toEqual({
    Rename: 'Claude is working on one of its sub-pages',
    'Move to…': 'Claude is working on one of its sub-pages',
    'Delete page and 2 sub-pages': 'Claude is working on one of its sub-pages',
  });
  expect(await hints('Markets')).toEqual({ Rename: 'Claude is working on a page in this space', 'Delete space': 'Claude is working on a page in this space' });

  await act(async () => moreButton('Levels').click());
  for (const label of ['Rename', 'Move to…', 'Delete page and 2 sub-pages']) {
    const item = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === label)!;
    await act(async () => item.click());
  }
  expect(ask).not.toHaveBeenCalled();
  expect(host.querySelector('.inline-rename')).toBeNull();
  expect(document.querySelector('.move-dialog')).toBeNull();
  expect(useStore.getState().notebooks).toHaveLength(notebooks.length);
  await act(async () => moreButton('Levels').click());

  // Once the reply ends, all as before.
  lockOn(null);
  expect(await menu('Weekly')).toEqual(pageMenu('Delete page and 1 sub-page'));
  expect(await menu('Levels')).toEqual(pageMenu('Delete page and 2 sub-pages'));
  expect(await menu('Markets')).toEqual(spaceMenu);
});

test("a page Claude is working on, and the pages above it, can't be picked up to drag; the rest can", async () => {
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
  await pickUp('Levels');
  expect(ghost()).toBeNull();
  // Their titles still open them, and aren't announced as unavailable.
  expect(title('Weekly').getAttribute('aria-disabled')).not.toBe('true');
  expect(title('Levels').getAttribute('aria-disabled')).not.toBe('true');

  // A page below it, or beside it, moves without moving it.
  await pickUp('Monday');
  expect(ghost()).toBe('Monday');
  await putBack();
  await vi.waitFor(() => expect(ghost()).toBeNull());
  await pickUp('Notes');
  expect(ghost()).toBe('Notes');
  await putBack();

  lockOn(null);
  await vi.waitFor(() => expect(ghost()).toBeNull());
  await pickUp('Weekly');
  expect(ghost()).toBe('Weekly');
  await putBack();
});

/** Chooses a ⋯ menu item. */
const choose = async (name: string, label: string) => {
  await act(async () => moreButton(name).click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === label)!.click());
};
/** Types a new name into the open inline rename and presses Enter. */
const renameTo = (text: string) =>
  act(async () => {
    const box = host.querySelector<HTMLInputElement>('.inline-rename')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });

test('a rename begun before the turn started is dropped if the turn locks the page, or a page or space below it', async () => {
  const titleOf = (id: string) => useStore.getState().notebooks.find((n) => n.id === id)!.title;
  for (const id of ['Levels', 'Weekly']) {
    await choose(id, 'Rename');
    lockOn('weekly');
    await renameTo(`${id} renamed`);
    lockOn(null);
  }
  expect([titleOf('levels'), titleOf('weekly')]).toEqual(['Levels', 'Weekly']);

  await choose('Markets', 'Rename');
  lockOn('weekly');
  await renameTo('Trading');
  expect(useStore.getState().spaces.map((s) => s.name)).toEqual(['Markets', 'Journal']);

  // Elsewhere, renames go through.
  lockOn('weekly');
  await choose('Notes', 'Rename');
  await renameTo('Notes renamed');
  await choose('Journal', 'Rename');
  await renameTo('Diary');
  expect(titleOf('notes')).toBe('Notes renamed');
  expect(useStore.getState().spaces.map((s) => s.name)).toEqual(['Markets', 'Diary']);
});

test('Move to… opened on a page above it before the turn started moves nothing; another page can still move into it', async () => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  const places = () => [...host.querySelectorAll<HTMLButtonElement>('.move-list button')];
  const parentOf = (id: string) => useStore.getState().notebooks.find((n) => n.id === id)!.parentId;

  await choose('Levels', 'Move to…');
  lockOn('weekly');
  expect(host.querySelector('.move-locked')?.textContent).toBe('Claude is working on one of its sub-pages. It can move once the reply ends.');
  expect(places().length).toBeGreaterThan(0);
  expect(places().every((b) => b.disabled)).toBe(true);
  await act(async () => host.querySelector<HTMLDialogElement>('.move-dialog')!.dispatchEvent(new Event('close')));

  // Into the page Claude is working on: its own file doesn't change.
  await choose('Notes', 'Move to…');
  const into = places().find((b) => b.textContent === 'Markets / Levels / Weekly')!;
  expect(into.disabled).toBe(false);
  await act(async () => into.click());
  expect(parentOf('notes')).toBe('weekly');
});
