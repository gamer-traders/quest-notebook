import { Marked, type TokenizerAndRendererExtension } from 'marked';
import DOMPurify from 'dompurify';
import type { MarkdownFile, Notebook } from '../types';
import { displayTitle } from '../page/tree';
import { markdownName } from './model';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** `[[Target]]` and `[[Target|words]]`, as Obsidian writes links: a page or another Markdown file, by its name. */
const wikilink: TokenizerAndRendererExtension = {
  name: 'wikilink',
  level: 'inline',
  start(src) {
    const at = src.indexOf('[[');
    return at >= 0 ? at : undefined;
  },
  tokenizer(src) {
    const m = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
    if (!m) return undefined;
    return { type: 'wikilink', raw: m[0], target: m[1].trim(), label: (m[2] ?? m[1]).trim() };
  },
  renderer(token) {
    return `<a href="#" class="wikilink" data-wikilink="${escapeHtml(token.target)}">${escapeHtml(token.label)}</a>`;
  },
};

// Its own instance, so nothing else in the app shares or changes how Markdown is read.
const marked = new Marked({ gfm: true }, { extensions: [wikilink] });

/**
 * A Markdown file as HTML to show. Anything in it that could run, or reach beyond the text, is taken out: scripts,
 * frames, event handlers, script links, forms and styles, so a file can't act in the app or dress up as it.
 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form'], FORBID_ATTR: ['style'] });
}

/** Where a link in a Markdown file goes: a page or Markdown file to open, a web page, or nowhere. */
export type LinkTarget = { open: string } | { web: string } | null;

const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** `rel` from the folder `dir`, as a path from the workspace folder. Null when it would leave the workspace. */
function resolvePath(dir: string, rel: string): string | null {
  const parts = rel.startsWith('/') ? [] : dir.split('/').filter(Boolean);
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

/**
 * Where a link goes. A `[[name]]` finds a Markdown file beside this one first, then a page by its title, then a
 * Markdown file anywhere; case doesn't count. A written link finds a web page, or a Markdown file by its path.
 */
export function linkTarget(link: { wikilink?: string; href?: string }, from: MarkdownFile, pages: Notebook[], files: MarkdownFile[]): LinkTarget {
  if (link.wikilink !== undefined) {
    const want = link.wikilink.split('#')[0].trim().replace(/\.md$/i, '').toLowerCase();
    if (!want) return null;
    const named = (m: MarkdownFile) => markdownName(m).toLowerCase() === want || m.path.replace(/\.md$/i, '').toLowerCase() === want;
    const beside = files.find((m) => m.id !== from.id && folderOf(m.path) === folderOf(from.path) && named(m));
    if (beside) return { open: beside.id };
    const page = pages.find((p) => !p.loadError && displayTitle(p.title).trim().toLowerCase() === want);
    if (page) return { open: page.id };
    const any = files.find((m) => m.id !== from.id && named(m));
    return any ? { open: any.id } : null;
  }

  const href = (link.href ?? '').trim();
  if (/^https?:\/\//i.test(href)) return { web: href };
  if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(href.split('#')[0]);
  } catch {
    return null;
  }
  const path = resolvePath(folderOf(from.path), rel);
  if (!path || !/\.md$/i.test(path)) return null;
  const file = files.find((m) => m.path === path) ?? files.find((m) => m.path.toLowerCase() === path.toLowerCase());
  return file ? { open: file.id } : null;
}
