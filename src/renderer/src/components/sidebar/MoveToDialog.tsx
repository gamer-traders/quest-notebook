import { useEffect, useMemo, useRef, useState } from 'react';
import type { Notebook, Space } from '../../types';
import { childrenOf, displayTitle, pathOf, type Target } from '../../page/tree';
import { useStore } from '../../store';

export interface Choice {
  key: string;
  /** Where the page will go. */
  target: Target;
  path: string[];
}

/**
 * Every place a page can move to: each space, then its pages in tree order. The page and its own
 * sub-pages are left out. A space takes it at the end of its top level; a page takes it as its last sub-page.
 */
function choicesFor(notebooks: Notebook[], spaces: Space[], pageId: string): Choice[] {
  const lastIndex = (spaceId: string, parentId: string | null) => childrenOf(notebooks, spaceId, parentId).filter((nb) => nb.id !== pageId).length;
  const out: Choice[] = [];
  const walk = (spaceId: string, parentId: string | null) => {
    for (const nb of childrenOf(notebooks, spaceId, parentId)) {
      if (nb.id === pageId) continue;
      out.push({ key: nb.id, target: { spaceId, parentId: nb.id, index: lastIndex(spaceId, nb.id) }, path: pathOf(notebooks, spaces, nb.id) });
      walk(spaceId, nb.id);
    }
  };
  for (const space of spaces) {
    out.push({ key: `space:${space.id}`, target: { spaceId: space.id, parentId: null, index: lastIndex(space.id, null) }, path: [space.name] });
    walk(space.id, null);
  }
  return out;
}

/** The choices whose name holds what's typed, ignoring case: every one when nothing is. */
export function matchingChoices(choices: Choice[], query: string): Choice[] {
  const q = query.trim().toLowerCase();
  return q ? choices.filter((c) => c.path.at(-1)!.toLowerCase().includes(q)) : choices;
}

/** What Enter in the search picks: the first match, but only once something is typed, so Enter alone moves nothing. */
export function enterChoice(choices: Choice[], query: string): Choice | null {
  if (!query.trim()) return null;
  return matchingChoices(choices, query)[0] ?? null;
}

/** "Move to…": a searchable list of spaces and pages, each with its path. */
export function MoveToDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const notebooks = useStore((s) => s.notebooks);
  const spaces = useStore((s) => s.spaces);
  const page = notebooks.find((nb) => nb.id === pageId);
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  const choices = useMemo(() => choicesFor(notebooks, spaces, pageId), [notebooks, spaces, pageId]);
  const shown = matchingChoices(choices, query);

  const pick = (choice: Choice) => {
    useStore.getState().movePage(pageId, choice.target);
    onClose();
  };

  if (!page) return null;
  const title = displayTitle(page.title);

  return (
    <dialog
      ref={dialog}
      className="move-dialog"
      aria-label={`Move “${title}” to`}
      onClose={onClose}
      // A press on the backdrop lands on the dialog itself.
      onClick={(e) => e.target === dialog.current && onClose()}
    >
      <div className="move-head">
        <h2>Move “{title}” to…</h2>
        <input
          type="search"
          value={query}
          placeholder="Search spaces and pages"
          aria-label="Search spaces and pages"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const choice = e.key === 'Enter' ? enterChoice(choices, query) : null;
            if (choice) {
              e.preventDefault();
              pick(choice);
            }
          }}
        />
      </div>
      {shown.length === 0 ? (
        <p className="muted move-empty">Nothing matches “{query}”.</p>
      ) : (
        <ul className="move-list">
          {shown.map((c) => (
            <li key={c.key}>
              <button onClick={() => pick(c)}>
                {c.path.length > 1 && <span className="move-where">{c.path.slice(0, -1).join(' / ')} / </span>}
                <span className={c.path.length === 1 ? 'move-space' : undefined}>{c.path.at(-1)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </dialog>
  );
}
