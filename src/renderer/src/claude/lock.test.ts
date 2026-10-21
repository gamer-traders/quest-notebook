// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { QuestApi } from '@shared/ipc';
import { useStore } from '../store';
import type { Notebook } from '../types';
import type { PageBlock } from '../page/blockTypes';
import { NotebookView } from '../components/NotebookView';
import { bindClaude, isLocked, useClaude, useLocked } from './store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lays nothing out: the page and the selection toolbar ask where things are.
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
window.scrollTo = () => {};
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const turn = (lockedPageId: string | null) => ({ chatId: 'c1', messageId: 'm1', lockedPageId });

let stop: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stop = vi.fn(async () => {});
  bindClaude({ onEvent: () => () => {}, stop } as unknown as QuestApi['claude']);
  useClaude.setState({ open: false, running: null, attachments: [] });
});

test('only the page a running turn started on is locked', () => {
  expect(isLocked({ running: null }, 'p1')).toBe(false);
  expect(isLocked({ running: turn('p1') }, 'p1')).toBe(true);
  expect(isLocked({ running: turn('p1') }, 'p2')).toBe(false);
  // A turn started with no page open locks nothing, and "no page" is never locked.
  expect(isLocked({ running: turn(null) }, null)).toBe(false);
  expect(isLocked({ running: turn(null) }, undefined)).toBe(false);
  expect(isLocked({ running: turn('p1') }, null)).toBe(false);
});

test('useLocked follows the store as a turn starts and ends', async () => {
  const seen: Record<string, boolean> = {};
  const Probe = ({ id }: { id: string }) => {
    seen[id] = useLocked(id);
    return null;
  };
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render([createElement(Probe, { id: 'p1', key: 'p1' }), createElement(Probe, { id: 'p2', key: 'p2' })]));
  expect(seen).toEqual({ p1: false, p2: false });
  act(() => useClaude.setState({ running: turn('p1') }));
  expect(seen).toEqual({ p1: true, p2: false });
  act(() => useClaude.setState({ running: null }));
  expect(seen).toEqual({ p1: false, p2: false });
  act(() => root.unmount());
});

describe('the open page', () => {
  let host: HTMLElement;
  let root: Root;

  const text = (t: string) => ({ id: 't', type: 'paragraph', props: {}, content: [{ type: 'text', text: t, styles: {} }], children: [] });
  const item = (id: string, type: string) => ({ id, type, props: { itemId: '' }, children: [] });
  const page: Notebook = {
    id: 'a',
    title: 'Levels',
    spaceId: 's',
    parentId: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    blocks: [text('hello world'), item('p1', 'tradePlan'), item('d1', 'drawing')] as unknown as PageBlock[],
    items: {
      p1: { id: 'p1', type: 'plan', side: 'long', entry: 1, stop: null, target: null, reason: '' },
      d1: { id: 'd1', type: 'drawing', height: 300, background: 'blank', strokes: [] },
    },
  };

  // The editor draws its item blocks a moment after it mounts. BlockNote mounts it afresh when it turns read-only or back.
  const drawn = () =>
    vi.waitFor(async () => {
      await act(() => new Promise((r) => setTimeout(r, 5)));
      expect(host.querySelector('.drawing-canvas')).not.toBeNull();
    });
  const lockedOn = async (pageId: string | null) => {
    act(() => useClaude.setState({ running: pageId === null ? null : turn(pageId) }));
    await drawn();
  };

  beforeEach(async () => {
    useStore.setState({ notebooks: [page], spaces: [{ id: 's', name: 'S' }], activeId: 'a', view: 'notebook' });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(NotebookView)));
    await drawn();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const shown = () => {
    const controls = [...host.querySelectorAll('.item-block :is(button, input, textarea)')];
    return {
      bar: host.querySelector('.claude-lock[role="status"]')?.textContent ?? null,
      titleReadOnly: host.querySelector<HTMLInputElement>('.notebook-title')!.readOnly,
      editable: host.querySelector('.ProseMirror')!.getAttribute('contenteditable'),
      blocksDisabled: [...host.querySelectorAll<HTMLFieldSetElement>('.item-block > fieldset')].map((f) => f.disabled),
      allControlsDisabled: controls.length > 0 && controls.every((c) => c.matches(':disabled')),
      canvasLocked: host.querySelector('.drawing-canvas')!.classList.contains('is-locked'),
    };
  };
  const unlocked = { bar: null, titleReadOnly: false, editable: 'true', blocksDisabled: [false, false], allControlsDisabled: false, canvasLocked: false };

  test('is read-only while a turn works on it, with a bar that stops the turn, and as before once it ends', async () => {
    expect(shown()).toEqual(unlocked);

    await lockedOn('a');
    expect(shown()).toEqual({ bar: 'Claude is working on this page…Stop', titleReadOnly: true, editable: 'false', blocksDisabled: [true, true], allControlsDisabled: true, canvasLocked: true });
    const short = [...host.querySelectorAll<HTMLButtonElement>('.plan-cell button')].find((b) => b.textContent === 'Short')!;
    await act(async () => short.click());
    expect(useStore.getState().notebooks[0].items.p1).toMatchObject({ side: 'long' });
    await act(async () => host.querySelector<HTMLButtonElement>('.claude-lock button')!.click());
    expect(stop).toHaveBeenCalledTimes(1);

    await lockedOn('other');
    expect(shown()).toEqual(unlocked);
    await lockedOn(null);
    expect(shown()).toEqual(unlocked);
  });

  const select = (from: number, to: number) =>
    act(async () => {
      const view = (host.querySelector('.ProseMirror') as unknown as { editor: { view: EditorView } }).editor.view;
      let start = -1;
      view.state.doc.descendants((n, pos) => {
        if (n.isText && start < 0) start = pos;
      });
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start + from, start + to)));
    });
  const toolbar = () => [...document.querySelectorAll<HTMLButtonElement>('.bn-formatting-toolbar button')];

  test.each([false, true])('Ask Claude attaches the selected words and opens the panel (page locked: %s)', async (locked) => {
    await lockedOn(locked ? 'a' : null);
    const ask = () => toolbar().find((b) => b.textContent === 'Ask Claude');
    await select(5, 6);
    expect(ask()).toBeUndefined();
    await select(6, 11);
    expect(ask()).toBeDefined();
    // On a read-only page it's the only button left.
    expect(toolbar().length === 1).toBe(locked);
    await act(async () => ask()!.click());
    expect(useClaude.getState()).toMatchObject({ open: true, attachments: [{ kind: 'selection', pageId: 'a', title: 'Levels', text: 'world' }] });
  });
});
