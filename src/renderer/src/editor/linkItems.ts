import type { Notebook, Space } from '../types';
import { pathOf } from '../page/tree';

// What the [[ link menu offers for a query: notebooks by title, and a new one under the query's name.

export type LinkChoice = { kind: 'notebook'; notebookId: string; title: string } | { kind: 'create'; title: string };

const MAX_NOTEBOOKS = 8;

// Past this, or once a ']' is typed, the words are more likely a sentence than a notebook's name.
const MAX_CREATE_TITLE = 60;

const byTitle = (a: Notebook, b: Notebook) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Notebooks whose title holds the query, ignoring case: those that start with it first, then the rest,
 * each alphabetically. The notebook being written in is left out. A short query no title equals, without a ']',
 * offers to create it; anything else can run out of choices, and the menu then closes by itself.
 */
export function linkChoices(notebooks: Notebook[], query: string, currentId: string): LinkChoice[] {
  const q = query.trim().toLowerCase();
  const others = notebooks.filter((n) => n.id !== currentId);
  const starts = others.filter((n) => n.title.toLowerCase().startsWith(q)).sort(byTitle);
  const within = others.filter((n) => !n.title.toLowerCase().startsWith(q) && n.title.toLowerCase().includes(q)).sort(byTitle);

  const choices: LinkChoice[] = [...starts, ...within]
    .slice(0, MAX_NOTEBOOKS)
    .map((n) => ({ kind: 'notebook', notebookId: n.id, title: n.title }));
  // Any notebook counts, the current one too: creating a second notebook under a taken title helps nobody.
  const title = query.trim();
  const creatable = title && !title.includes(']') && title.length <= MAX_CREATE_TITLE && !notebooks.some((n) => sameTitle(n.title, title));
  if (creatable) choices.push({ kind: 'create', title });
  return choices;
}

/** The notebook, other than the current one, whose title is the text, ignoring case and spaces at the ends. */
export function notebookTitled(notebooks: Notebook[], text: string, currentId: string): Notebook | undefined {
  if (!text.trim()) return undefined;
  return notebooks.find((n) => n.id !== currentId && sameTitle(n.title, text));
}

/** A choice as the menu shows it. */
export function linkChoiceLabel(choice: LinkChoice): string {
  if (choice.kind === 'create') return `Create notebook “${choice.title}”`;
  return choice.title || 'Untitled';
}

/** Where a choice's page sits, its space and then its ancestors, so two pages with one title can be told apart. */
export function linkChoicePath(choice: LinkChoice, notebooks: Notebook[], spaces: Space[]): string {
  if (choice.kind === 'create') return '';
  return pathOf(notebooks, spaces, choice.notebookId).slice(0, -1).join(' / ');
}
