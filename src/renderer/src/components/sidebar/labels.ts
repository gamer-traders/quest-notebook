// The sidebar's delete wording. Each one names how much goes, so a delete never removes more than it said.

const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The page ⋯ menu's delete item. */
export const deletePageLabel = (subPages: number): string => (subPages === 0 ? 'Delete page' : `Delete page and ${count(subPages, 'sub-page')}`);

export const deletePageQuestion = (title: string, subPages: number): string =>
  subPages === 0 ? `Delete “${title}”?` : `Delete “${title}” and its ${count(subPages, 'sub-page')}?`;

export const deleteSpaceQuestion = (name: string, pages: number): string => `Delete the space “${name}” and its ${count(pages, 'page')}?`;

/** Moving an unreadable page's file to the Trash: its sub-pages' folder goes with it. */
export const trashFileQuestion = (path: string, subPages: number): string =>
  subPages === 0 ? `Move “${path}” to the Trash?` : `Move “${path}” and its ${count(subPages, 'sub-page')} to the Trash?`;
