import type { Notebook, Space } from '../types';
import type { NotebookLinkInline, PageBlock } from '../page/blockTypes';
import { DELETED_NOTEBOOK, flattenBlocks } from '../page/blocks';
import { displayTitle, pathOf } from '../page/tree';

/*
  Page links are kept in memory by page id, so renames and moves never break them, and written in files
  by title, so a person or an AI can write one: [[Weekly levels]]. When two pages share a title, the
  file names the page by its path instead: [[Markets/Bitcoin, big picture/Weekly levels]].
*/

const key = (text: string) => text.trim().toLowerCase();

const pathKey = (notebooks: Notebook[], spaces: Space[], id: string) => pathOf(notebooks, spaces, id).join('/');

/** Writes a page link's words: its page's title, or its path when another page shares the title. */
export function linkWriter(notebooks: Notebook[], spaces: Space[]): (link: NotebookLinkInline) => string {
  const byId = new Map(notebooks.map((nb) => [nb.id, nb]));
  const titleCount = new Map<string, number>();
  for (const nb of notebooks) titleCount.set(key(displayTitle(nb.title)), (titleCount.get(key(displayTitle(nb.title))) ?? 0) + 1);
  return (link) => {
    const target = byId.get(link.props.notebookId);
    if (!target) return link.props.target || DELETED_NOTEBOOK;
    const title = displayTitle(target.title);
    return (titleCount.get(key(title)) ?? 0) > 1 ? pathKey(notebooks, spaces, target.id) : title;
  };
}

/** Finds the page a link's words name: a title only one page has, then a path, then a title in the linking page's space. */
function finder(notebooks: Notebook[], spaces: Space[]): (target: string, from: Notebook) => string | null {
  const byTitle = new Map<string, Notebook[]>();
  for (const nb of notebooks) byTitle.set(key(displayTitle(nb.title)), [...(byTitle.get(key(displayTitle(nb.title))) ?? []), nb]);
  let byPath: Map<string, string> | null = null;
  return (target, from) => {
    const titled = byTitle.get(key(target)) ?? [];
    if (titled.length === 1) return titled[0].id;
    byPath ??= new Map(notebooks.map((nb) => [key(pathKey(notebooks, spaces, nb.id)), nb.id]));
    const pathed = byPath.get(key(target));
    if (pathed) return pathed;
    if (titled.length > 1) return (titled.find((nb) => nb.spaceId === from.spaceId) ?? titled[0]).id;
    return null;
  };
}

/**
 * Points links read from files at their pages. A link that already names a page is left alone, and so is one
 * whose page isn't there. Notebooks with nothing to resolve come back as the same objects.
 */
export function resolveLinks(notebooks: Notebook[], spaces: Space[]): Notebook[] {
  let find: ReturnType<typeof finder> | null = null;
  return notebooks.map((nb) => {
    let changed = false;
    const resolveBlocks = (blocks: PageBlock[]): PageBlock[] =>
      blocks.map((block) => {
        const children = resolveBlocks(block.children);
        let content = block.content;
        if (Array.isArray(block.content)) {
          content = block.content.map((part) => {
            if (part?.type !== 'notebookLink' || part.props?.notebookId || !part.props?.target) return part;
            find ??= finder(notebooks, spaces);
            const id = find(part.props.target, nb);
            if (!id) return part;
            changed = true;
            return { ...part, props: { ...part.props, notebookId: id } };
          });
        }
        return children === block.children && content === block.content ? block : { ...block, content, children };
      });
    const hasLinks = flattenBlocks(nb.blocks).some((b) => Array.isArray(b.content) && b.content.some((p) => p?.type === 'notebookLink' && !p.props?.notebookId && p.props?.target));
    if (!hasLinks) return nb;
    const blocks = resolveBlocks(nb.blocks);
    return changed ? { ...nb, blocks } : nb;
  });
}

/** The pages a page links to. */
export function linksTo(nb: Notebook): Set<string> {
  const ids = new Set<string>();
  for (const block of flattenBlocks(nb.blocks)) {
    if (!Array.isArray(block.content)) continue;
    for (const part of block.content) if (part?.type === 'notebookLink' && part.props?.notebookId) ids.add(part.props.notebookId);
  }
  return ids;
}
