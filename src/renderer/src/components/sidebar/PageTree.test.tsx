// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Notebook } from '../../types';
import { useStore } from '../../store';
import { PageTree } from './PageTree';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

const page = (id: string, title: string, spaceId: string): Notebook => ({ id, title, spaceId, parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [], items: {} });

const titles = () => [...container.querySelectorAll('.tree-row .row-title')].map((b) => b.textContent);
const fold = (name: string) => container.querySelector<HTMLButtonElement>(`button.space-fold[aria-label$="${name}"]`)!;

beforeEach(() => {
  useStore.setState({
    notebooks: [page('a', 'Alpha', 'sm'), page('b', 'Beta', 'sl')],
    markdown: [],
    spaces: [{ id: 'sm', name: 'Markets' }, { id: 'sl', name: 'Lessons' }, { id: 'se', name: 'Empty' }],
    expanded: {},
    spaceCollapsed: {},
    activeId: 'b',
    view: 'notebook',
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<PageTree onNavigate={() => {}} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

test('a space folds its pages away, and opens again', () => {
  expect(titles()).toEqual(['Alpha', 'Beta']);
  expect(fold('Markets').getAttribute('aria-expanded')).toBe('true');
  act(() => fold('Markets').click());
  expect(titles()).toEqual(['Beta']);
  expect(fold('Markets').getAttribute('aria-expanded')).toBe('false');
  expect(useStore.getState().spaceCollapsed).toEqual({ sm: true });
  act(() => fold('Markets').click());
  expect(titles()).toEqual(['Alpha', 'Beta']);
});

test('clicking a space’s name folds it too', () => {
  act(() => container.querySelector<HTMLElement>('[data-space-id="sl"] .space-handle')!.click());
  expect(titles()).toEqual(['Alpha']);
});

test('a page opened inside a folded space, from search or a link, opens its space', () => {
  act(() => fold('Markets').click());
  act(() => useStore.getState().openNotebook('a'));
  expect(titles()).toEqual(['Alpha', 'Beta']);
  expect(useStore.getState().spaceCollapsed).toEqual({});
});

test('an empty space shows just its name', () => {
  const empty = container.querySelector('[data-space-id="se"]')!;
  expect(empty.querySelector('.space-name')?.textContent).toBe('Empty');
  expect(empty.textContent).not.toContain('None yet');
});
