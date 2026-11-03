import { markdownToHTML } from '@blocknote/core';
import { displayTitle } from '../page/tree';
import { useStore } from '../store';
import { linksInPastedHTML } from './copyLink';
import { insertLinks } from './NotebookLink';
import type { PageEditor } from './schema';

const HAS_TABLE = /<table[\s>]/i;

/**
 * A page has no table block, and a pasted table would run all its cells together into one line.
 * Each row becomes a paragraph instead, its cells set apart by bars, as a markdown table writes them.
 */
export function tablesToParagraphs(html: string): string {
  if (!HAS_TABLE.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const table of doc.querySelectorAll('table')) {
    const rows = [...table.rows].map((row) => {
      const p = doc.createElement('p');
      p.textContent = [...row.cells].map((cell) => cell.textContent?.trim() ?? '').join(' | ');
      return p;
    });
    table.replaceWith(...rows);
  }
  return doc.body.innerHTML;
}

interface PasteContext {
  event: ClipboardEvent;
  editor: PageEditor;
  defaultPasteHandler: () => boolean | undefined;
}

const LINK_TEXT = /^\[\[([^[\]]+)\]\]$/;

/** The page '[[Title]]' names, when exactly one page has that title, ignoring case and spaces at the ends. */
function pageNamedBy(text: string): string | null {
  const title = LINK_TEXT.exec(text.trim())?.[1].trim().toLowerCase();
  if (!title) return null;
  const named = useStore.getState().notebooks.filter((nb) => displayTitle(nb.title).trim().toLowerCase() === title);
  return named.length === 1 ? named[0].id : null;
}

/**
 * Pastes a page link from "Copy link for [[ ]]", or a plain '[[Title]]' that names one page, as link chips.
 * Pastes a web page, a Notion page or markdown that holds a table with its rows as paragraphs. Anything else pastes as usual.
 */
export function pastePage({ event, editor, defaultPasteHandler }: PasteContext): boolean | undefined {
  const data = event.clipboardData;
  // The editor's own copies keep their blocks, and code from VS Code becomes a code block.
  // (Pasting into a code block's code is its own editor's business: the page never sees it.)
  const usual = !data || ['blocknote/html', 'vscode-editor-data'].some((type) => data.types.includes(type));
  if (!usual) {
    const links = linksInPastedHTML(data.getData('text/html'));
    const named = links.length === 0 ? pageNamedBy(data.getData('text/plain')) : null;
    if (links.length > 0 || named) {
      insertLinks(editor, named ? [named] : links);
      return true;
    }
    // Plain text is read as markdown, as the editor reads it.
    const html = data.getData('text/html') || markdownToHTML(data.getData('text/plain'));
    if (HAS_TABLE.test(html)) {
      editor.pasteHTML(tablesToParagraphs(html));
      return true;
    }
  }
  return defaultPasteHandler();
}
