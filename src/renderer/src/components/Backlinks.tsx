import { useMemo } from 'react';
import { backlinksTo, titleLookup } from '../page/blocks';
import { displayTitle } from '../page/tree';
import { useStore } from '../store';

/** Under the page: every notebook that links here, with the sentence the link sits in. Hidden when none do. */
export function Backlinks({ notebookId }: { notebookId: string }) {
  const notebooks = useStore((s) => s.notebooks);
  const links = useMemo(() => backlinksTo(notebooks, notebookId, titleLookup(notebooks)), [notebooks, notebookId]);

  if (links.length === 0) return null;
  const { openNotebook } = useStore.getState();

  return (
    <section className="backlinks" aria-labelledby="backlinks-heading">
      <h2 id="backlinks-heading">Linked from</h2>
      <ul>
        {links.map(({ notebook, blockId, sentence }) => (
          <li key={notebook.id}>
            <button onClick={() => openNotebook(notebook.id, blockId)}>
              <span className="backlink-title">{displayTitle(notebook.title)}</span>
              <span className="backlink-sentence">{sentence}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
