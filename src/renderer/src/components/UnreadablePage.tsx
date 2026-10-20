import type { Notebook } from '../types';
import { useStore } from '../store';
import { PagePath } from './PagePath';
import { descendantIds } from '../page/tree';
import { trashFileQuestion } from './sidebar/labels';

/** A page whose file couldn't be read: what went wrong, and where. The app never writes over it. */
export function UnreadablePage({ page }: { page: Notebook }) {
  const remove = () => {
    const count = descendantIds(useStore.getState().notebooks, page.id).length;
    if (window.confirm(trashFileQuestion(page.path ?? page.title, count))) useStore.getState().deletePage(page.id);
  };
  return (
    <article className="notebook unreadable-page" aria-label={page.title}>
      <PagePath page={page} />
      <h1>This page's file couldn't be read</h1>
      <p className="unreadable-path">{page.path}</p>
      <pre className="unreadable-error">{page.loadError}</pre>
      <p>Fix the file and it reloads by itself. Quest Notebook won't write over it until then.</p>
      <button className="quiet danger" onClick={remove}>
        Move to the Trash…
      </button>
    </article>
  );
}
