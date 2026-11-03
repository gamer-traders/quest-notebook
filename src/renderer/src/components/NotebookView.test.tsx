// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Notebook } from '../types';
import type { PageBlock } from '../page/blockTypes';
import { useStore } from '../store';
import { NotebookView } from './NotebookView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;

let root: Root;
let container: HTMLDivElement;

const page = (id: string, title: string, blocks: PageBlock[]): Notebook => ({ id, title, spaceId: 's', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks, items: {} });
const text = (words: string, styles: Record<string, unknown>): PageBlock => ({ id: `b-${words}`, type: 'paragraph', props: {}, content: [{ type: 'text', text: words, styles }], children: [] });

beforeEach(() => {
  // React reports the error it caught; the test only cares what the page shows.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useStore.setState({
    notebooks: [page('bad', 'Bad', [text('code and bold', { code: true, bold: true })]), page('good', 'Good', [text('fine', {})])],
    spaces: [{ id: 's', name: 'S' }],
    activeId: 'bad',
    view: 'notebook',
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

test('a page the editor can’t build says so, and the next page opens as usual', () => {
  act(() => root.render(<NotebookView />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('This page couldn’t be shown');
  expect(container.querySelector('input')?.value).toBe('Bad');
  act(() => useStore.getState().openNotebook('good'));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('.page-editor')?.textContent).toContain('fine');
});
