import type { MarkdownFile, Notebook } from '../../types';
import { childrenOf } from '../../page/tree';
import { markdownName } from '../../markdown/model';

/** A row in the sidebar: a page, with whether its sub-pages show, or a Markdown file. */
export type Row =
  | { kind: 'page'; page: Notebook; depth: number; hasChildren: boolean; open: boolean }
  | { kind: 'markdown'; file: MarkdownFile; depth: number };

const byName = (a: MarkdownFile, b: MarkdownFile) => markdownName(a).localeCompare(markdownName(b));

/** A space's rows as the sidebar lists them: each page, then what's in it when it's expanded; Markdown files after the pages beside them. */
export function visibleRows(notebooks: Notebook[], markdown: MarkdownFile[], spaceId: string, expanded: Record<string, boolean>): Row[] {
  const rows: Row[] = [];
  const files = markdown.filter((m) => m.spaceId === spaceId);
  const walk = (parentId: string | null, depth: number) => {
    for (const page of childrenOf(notebooks, spaceId, parentId)) {
      const hasChildren = notebooks.some((nb) => nb.parentId === page.id && nb.spaceId === spaceId) || files.some((m) => m.parentId === page.id);
      const open = hasChildren && expanded[page.id] === true;
      rows.push({ kind: 'page', page, depth, hasChildren, open });
      if (open) walk(page.id, depth + 1);
    }
    for (const file of files.filter((m) => m.parentId === parentId).sort(byName)) rows.push({ kind: 'markdown', file, depth });
  };
  walk(null, 0);
  return rows;
}
