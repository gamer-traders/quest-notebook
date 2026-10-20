import { useMemo, useState } from 'react';
import type { Notebook } from '../types';
import { blockText, flattenBlocks, titleLookup, type TitleOf } from '../page/blocks';
import { pathOf } from '../page/tree';
import { itemText } from '../lib/cells';
import { extractTags } from '../lib/format';
import { useStore } from '../store';
import { PageTree } from './sidebar/PageTree';
import { IS_MAC, settingsShortcutLabel } from './SettingsDialog';
import { WorkspaceMenu } from './WorkspaceMenu';
import { tailPath } from '../workspace/shortPath';

interface Hit {
  notebook: Notebook;
  blockId?: string;
  label: string;
  snippet: string;
}

const BLOCK_LABEL: Record<string, string> = {
  heading: 'Heading',
  bulletListItem: 'List',
  numberedListItem: 'List',
  checkListItem: 'Checklist',
  quote: 'Quote',
  callout: 'Callout',
  codeBlock: 'Code',
  chart: 'Chart',
  tradePlan: 'Trade plan',
  prediction: 'Prediction',
};

/** Each block's words, in page order. Charts, plans and predictions bring their pins, labels and reasons. */
function pageTexts(nb: Notebook, titleOf: TitleOf): { blockId: string; type: string; text: string }[] {
  return flattenBlocks(nb.blocks).map((block) => {
    const item = nb.items[block.id];
    return { blockId: block.id, type: block.type, text: item ? itemText(item) : blockText(block, titleOf) };
  });
}

function snippetAround(text: string, at: number, length: number) {
  // Start at a word boundary so the snippet doesn't open mid-word.
  let start = Math.max(0, at - 40);
  const space = text.indexOf(' ', start);
  if (start > 0 && space >= 0 && space < at) start = space + 1;
  const end = Math.min(text.length, at + length + 50);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

function search(notebooks: Notebook[], query: string, titleOf: TitleOf): Hit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Hit[] = [];
  for (const nb of notebooks) {
    if (nb.title.toLowerCase().includes(q)) hits.push({ notebook: nb, label: 'Notebook', snippet: nb.title });
    for (const { blockId, type, text } of pageTexts(nb, titleOf)) {
      const at = text.toLowerCase().indexOf(q);
      if (at >= 0) hits.push({ notebook: nb, blockId, label: BLOCK_LABEL[type] ?? 'Text', snippet: snippetAround(text, at, q.length) });
    }
  }
  return hits.slice(0, 40);
}

export function Sidebar({ onNavigate, onOpenSettings }: { onNavigate: () => void; onOpenSettings: (trigger: HTMLElement) => void }) {
  const notebooks = useStore((s) => s.notebooks);
  const spaces = useStore((s) => s.spaces);
  const root = useStore((s) => s.workspace?.root ?? '');
  const { openNotebook } = useStore.getState();
  const [query, setQuery] = useState('');

  const titleOf = useMemo(() => titleLookup(notebooks), [notebooks]);
  const hits = useMemo(() => search(notebooks, query, titleOf), [notebooks, query, titleOf]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const nb of notebooks) for (const { text } of pageTexts(nb, titleOf)) for (const tag of extractTags(text)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag]) => tag);
  }, [notebooks, titleOf]);

  const go = (fn: () => void) => {
    fn();
    onNavigate();
  };

  return (
    <nav className="sidebar" aria-label="Notebooks">
      <WorkspaceMenu />

      <div className="search">
        <input type="search" value={query} placeholder="Search notes and #tags" aria-label="Search notebooks" onChange={(e) => setQuery(e.target.value)} />
      </div>

      {query ? (
        <div className="search-results">
          {hits.length === 0 ? (
            <p className="muted">Nothing matches “{query}”.</p>
          ) : (
            <ul>
              {hits.map((h, i) => (
                <li key={`${h.notebook.id}-${h.blockId ?? 'nb'}-${i}`}>
                  <button onClick={() => go(() => openNotebook(h.notebook.id, h.blockId))}>
                    <span className="hit-where">
                      {pathOf(notebooks, spaces, h.notebook.id).join(' / ')}, {h.label.toLowerCase()}
                    </span>
                    <span className="hit-text">{h.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          {tags.length > 0 && (
            <div className="tag-cloud" aria-label="Tags">
              {tags.map((t) => (
                <button key={t} className="tag" onClick={() => setQuery(`#${t}`)}>
                  #{t}
                </button>
              ))}
            </div>
          )}

          <PageTree onNavigate={onNavigate} />
        </>
      )}

      <div className="sidebar-foot">
        <button
          className="quiet"
          title={`Settings (${settingsShortcutLabel(IS_MAC)})`}
          aria-keyshortcuts={IS_MAC ? 'Meta+,' : 'Control+,'}
          onClick={(e) => onOpenSettings(e.currentTarget)}
        >
          {/* U+FE0E keeps the gear a text glyph, never an emoji. */}
          <span aria-hidden="true">{'\u2699\uFE0E'}</span> Settings
        </button>
        <button className="quiet workspace-path" title={`${root}\nShow in Finder`} onClick={() => void window.quest.workspaces.reveal()}>
          {tailPath(root)}
        </button>
      </div>
    </nav>
  );
}
