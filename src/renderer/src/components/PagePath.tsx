import { useEffect, useState } from 'react';
import { ancestorsOf, displayTitle } from '../page/tree';
import { useStore } from '../store';
import type { Notebook } from '../types';

/** Under this width, the middle ancestors of a long path fold into … */
const NARROW = '(max-width: 600px)';

/** Keeps the first and last parts, and folds the middle into … when there are more than two between them. */
export function shortenPath(parts: string[], narrow: boolean): string[] {
  if (!narrow || parts.length - 2 <= 2) return parts;
  return [parts[0], '…', parts[parts.length - 1]];
}

/** The tooltip on …: every part shortenPath folded, which is every ancestor. '' when nothing is folded. */
export function foldedLabel(parts: string[], narrow: boolean): string {
  if (shortenPath(parts, narrow).length === parts.length) return '';
  return parts.slice(1, -1).join(' › ');
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** Brings a space's section in the sidebar into view, opening the sidebar first on phones. */
function showSpace(spaceId: string) {
  window.dispatchEvent(new Event('open-nav'));
  requestAnimationFrame(() => {
    document.querySelector(`.sidebar [data-space-id="${CSS.escape(spaceId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

/** Space › ancestors › this page, above the title. Every part but the last takes you there. */
export function PagePath({ page }: { page: Notebook }) {
  const notebooks = useStore((s) => s.notebooks);
  const spaces = useStore((s) => s.spaces);
  const narrow = useNarrow();

  const space = spaces.find((s) => s.id === page.spaceId);
  const ancestors = ancestorsOf(notebooks, page.id);
  const keys = ['space', ...ancestors.map((a) => a.id), 'page'];
  const shown = shortenPath(keys, narrow);
  const folded = foldedLabel([space?.name ?? '', ...ancestors.map((a) => displayTitle(a.title)), displayTitle(page.title)], narrow);
  const parent = ancestors.at(-1);

  return (
    <nav className="page-path" aria-label="Page path">
      {shown.map((key, i) => {
        const last = i === shown.length - 1;
        const ancestor = ancestors.find((a) => a.id === key);
        let part;
        if (key === '…') {
          // The folded ancestors are named in the tooltip, and … opens the nearest of them, the parent.
          part = (
            <button
              className="path-part path-folded"
              title={folded}
              aria-label={folded}
              onClick={() => parent && useStore.getState().openNotebook(parent.id)}
            >
              …
            </button>
          );
        } else if (key === 'space') {
          part = (
            <button className="path-part" onClick={() => showSpace(page.spaceId)}>
              {space?.name ?? ''}
            </button>
          );
        } else if (last) {
          part = (
            <span className="path-here" aria-current="page">
              {displayTitle(page.title)}
            </span>
          );
        } else {
          part = (
            <button className="path-part" onClick={() => useStore.getState().openNotebook(ancestor!.id)}>
              {displayTitle(ancestor!.title)}
            </button>
          );
        }
        return (
          <span className="path-item" key={key}>
            {part}
            {!last && (
              <span className="path-sep" aria-hidden="true">
                ›
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
