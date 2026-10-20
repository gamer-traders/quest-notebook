import { describe, expect, test } from 'vitest';
import type { Notebook } from '../types';
import { linkChoiceLabel, linkChoicePath, linkChoices, notebookTitled, type LinkChoice } from './linkItems';

const notebook = (id: string, title: string): Notebook => ({ id, title, spaceId: 'space-market', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [], items: {} });

const notebooks = [notebook('sr', 'Support and resistance'), notebook('j', 'Journal: 20 Oct 2026'), notebook('btc', 'Bitcoin, big picture')];

const titles = (choices: LinkChoice[]) => choices.map((c) => (c.kind === 'notebook' ? c.title : `create ${c.title}`));

describe('linkChoices', () => {
  test('linkChoices puts title prefixes first', () => {
    expect(titles(linkChoices(notebooks, 'b', 'j'))).toEqual(['Bitcoin, big picture', 'create b']);
    // 'A clean break' sorts first, but only holds the query further in.
    expect(titles(linkChoices([...notebooks, notebook('cb', 'A clean break')], 'b', 'j'))).toEqual(['Bitcoin, big picture', 'A clean break', 'create b']);
  });

  test('linkChoices matches anywhere in the title', () => {
    expect(linkChoices(notebooks, 'resist', 'j')).toEqual([
      { kind: 'notebook', notebookId: 'sr', title: 'Support and resistance' },
      { kind: 'create', title: 'resist' },
    ]);
  });

  test('linkChoices leaves out the current notebook', () => {
    const choices = linkChoices(notebooks, 'journal', 'j');
    expect(choices.some((c) => c.kind === 'notebook' && c.notebookId === 'j')).toBe(false);
  });

  test('linkChoices offers no create for an exact title', () => {
    expect(linkChoices(notebooks, 'support and resistance', 'j')).toEqual([
      { kind: 'notebook', notebookId: 'sr', title: 'Support and resistance' },
    ]);
  });

  test('linkChoices with an empty query lists notebooks without create', () => {
    expect(titles(linkChoices(notebooks, '', 'j'))).toEqual(['Bitcoin, big picture', 'Support and resistance']);
  });

  test('linkChoices sorts each group alphabetically and returns at most 8 notebooks', () => {
    const many = ['Ma', 'Mz', 'Mb', 'Am', 'Zm', 'Bm', 'Mc', 'Md', 'Me', 'Mf'].map((t) => notebook(t, t));
    expect(titles(linkChoices(many, 'm', 'none'))).toEqual(['Ma', 'Mb', 'Mc', 'Md', 'Me', 'Mf', 'Mz', 'Am', 'create m']);
  });

  test('the create choice reads as the menu copy', () => {
    expect(linkChoiceLabel({ kind: 'create', title: 'New idea' })).toBe('Create notebook “New idea”');
    expect(linkChoices(notebooks, '  New idea ', 'j').at(-1)).toEqual({ kind: 'create', title: 'New idea' });
  });

  test('linkChoices offers no create for a query containing ] or longer than 60 characters', () => {
    expect(linkChoices(notebooks, 'Support and resistance]] held today', 'j')).toEqual([]);
    expect(linkChoices(notebooks, 'idea]', 'j')).toEqual([]);
    expect(linkChoices(notebooks, 'x'.repeat(61), 'j')).toEqual([]);
    expect(linkChoices(notebooks, 'x'.repeat(60), 'j')).toEqual([{ kind: 'create', title: 'x'.repeat(60) }]);
  });
});

describe('notebookTitled', () => {
  test('finds the notebook whose title is the text, ignoring case and spaces at the ends', () => {
    expect(notebookTitled(notebooks, ' support AND resistance ', 'j')?.id).toBe('sr');
  });

  test('leaves out the current notebook, partial titles and empty text', () => {
    expect(notebookTitled(notebooks, 'Journal: 20 Oct 2026', 'j')).toBeUndefined();
    expect(notebookTitled(notebooks, 'Support', 'j')).toBeUndefined();
    expect(notebookTitled([...notebooks, notebook('u', '')], ' ', 'j')).toBeUndefined();
  });
});

describe('linkChoicePath', () => {
  test('names where a page sits: its space, then its ancestors', () => {
    const spaces = [{ id: 'space-market', name: 'Markets' }];
    const tree = [...notebooks, { ...notebook('wk', 'Weekly levels'), parentId: 'btc' }, { ...notebook('u', ''), parentId: 'wk' }];
    expect(linkChoicePath({ kind: 'notebook', notebookId: 'btc', title: 'Bitcoin, big picture' }, tree, spaces)).toBe('Markets');
    expect(linkChoicePath({ kind: 'notebook', notebookId: 'wk', title: 'Weekly levels' }, tree, spaces)).toBe('Markets / Bitcoin, big picture');
    expect(linkChoicePath({ kind: 'notebook', notebookId: 'zz', title: 'Gone' }, tree, spaces)).toBe('');
    expect(linkChoicePath({ kind: 'create', title: 'New idea' }, tree, spaces)).toBe('');
  });
});
