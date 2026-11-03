// @vitest-environment jsdom
// MoveToDialog.tsx imports the store, which needs a localStorage.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useStore } from '../../store';
import type { Notebook } from '../../types';
import { useClaude } from '../../claude/store';
import { MoveToDialog, enterChoice, matchingChoices, type Choice } from './MoveToDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const choice = (key: string, path: string[]): Choice => ({ key, target: { spaceId: 's', parentId: null, index: 0 }, path });
const choices = [choice('space:j', ['Journal']), choice('p1', ['Journal', 'Old notes']), choice('space:m', ['Markets']), choice('p2', ['Markets', 'Weekly levels'])];

describe('Move to… search', () => {
  test('lists every choice until something is typed, then the ones whose name holds it', () => {
    expect(matchingChoices(choices, '')).toEqual(choices);
    expect(matchingChoices(choices, ' WEEK ').map((c) => c.key)).toEqual(['p2']);
  });

  test('Enter picks the first match once something is typed', () => {
    expect(enterChoice(choices, 'mark')?.key).toBe('space:m');
    expect(enterChoice(choices, 'levels')?.key).toBe('p2');
    expect(enterChoice(choices, 'nothing like it')).toBeNull();
  });

  test('Enter with nothing typed picks nothing, so the page is not moved to the first space', () => {
    expect(enterChoice(choices, '')).toBeNull();
    expect(enterChoice(choices, '   ')).toBeNull();
  });
});

describe('Move to… while Claude works on the page', () => {
  const page = (id: string, title: string, spaceId: string): Notebook => ({ id, title, spaceId, parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [], items: {} });
  let host: HTMLElement;
  let root: Root;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(async () => {
    // jsdom has no modal dialogs.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    useStore.setState({ notebooks: [page('w', 'Weekly levels', 'm'), page('t', 'Today', 'j')], spaces: [{ id: 'm', name: 'Markets' }, { id: 'j', name: 'Journal' }] });
    useClaude.setState({ running: { chatId: 'c1', messageId: 'm1', lockedPageId: 'w' } });
    onClose = vi.fn<() => void>();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(MoveToDialog, { pageId: 'w', onClose })));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const places = () => [...host.querySelectorAll<HTMLButtonElement>('.move-list button')];
  const spaceOfW = () => useStore.getState().notebooks.find((n) => n.id === 'w')!.spaceId;
  const search = (text: string) =>
    act(async () => {
      const box = host.querySelector<HTMLInputElement>('input[type="search"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

  test("its places can't be chosen, by click or by Enter, until the reply ends", async () => {
    expect(places().map((b) => [b.textContent, b.disabled])).toEqual([
      ['Markets', true],
      ['Journal', true],
      ['Journal / Today', true],
    ]);
    expect(host.querySelector('.move-locked')?.textContent).toBe('Claude is working on this page. It can move once the reply ends.');
    await act(async () => places()[1].click());
    await search('journal');
    expect(spaceOfW()).toBe('m');
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => useClaude.setState({ running: null }));
    await search('');
    expect(places().every((b) => !b.disabled)).toBe(true);
    expect(host.querySelector('.move-locked')).toBeNull();
    await act(async () => places()[1].click());
    expect(spaceOfW()).toBe('j');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
