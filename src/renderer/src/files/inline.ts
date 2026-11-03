import type { Inline, LinkInline, NotebookLinkInline, StyledText } from '../page/blockTypes';
import type { MarkColor } from '../types';
import { MARK_COLORS } from '../chart/palette';

/*
  How a block's words are written in a page file: Markdown-style marks a person or an AI reads at a glance.

    **bold**  *italic*  <u>underline</u>  ~~strike~~  `code`
    ==yellow highlight==  =={blue}a highlight in another colour==
    [words](https://…)    [[Page title]]

  Each mark switches its style on and off, so marks may sit next to each other in any order: '***a***'
  is bold and italic. A backslash makes the next character plain. Inside `code` everything is plain
  except \` and \\.
*/

/** The styles a page file keeps. Others, like text colour, aren't offered by the app and are dropped. */
export const KEPT_STYLES = ['bold', 'italic', 'underline', 'strike', 'code', 'backgroundColor'] as const;

interface Styles {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  code?: true;
  backgroundColor?: MarkColor;
}

const FLAGS = ['bold', 'italic', 'underline', 'strike', 'code'] as const;

const isColor = (value: unknown): value is MarkColor => (MARK_COLORS as unknown[]).includes(value);

/** The editor can't hold code with any other style, or inside a link: code wins over other styles, and a link over code. */
function keptStyles(styles: StyledText['styles'] | undefined, inLink: boolean): Styles {
  if (styles?.code === true && !inLink) return { code: true };
  const out: Styles = {};
  for (const flag of FLAGS) if (flag !== 'code' && styles?.[flag] === true) out[flag] = true;
  if (isColor(styles?.backgroundColor)) out.backgroundColor = styles.backgroundColor;
  return out;
}

const sameStyles = (a: Styles, b: Styles) =>
  FLAGS.every((flag) => a[flag] === b[flag]) && a.backgroundColor === b.backgroundColor;

const run = (text: string, styles: Styles): StyledText => ({ type: 'text', text, styles: { ...styles } });

function normalizeRuns(parts: unknown[], allowLinks: boolean): Inline[] {
  const out: Inline[] = [];
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue;
    const p = part as { type?: unknown; text?: unknown; styles?: StyledText['styles']; href?: unknown; content?: unknown; props?: unknown };
    if (p.type === 'text') {
      if (typeof p.text !== 'string' || p.text === '') continue;
      const styles = keptStyles(p.styles, !allowLinks);
      const last = out.at(-1);
      if (last && last.type === 'text' && sameStyles(last.styles as Styles, styles)) out[out.length - 1] = run(last.text + p.text, styles);
      else out.push(run(p.text, styles));
    } else if (p.type === 'link' && allowLinks && typeof p.href === 'string') {
      out.push({ type: 'link', href: p.href, content: normalizeRuns(Array.isArray(p.content) ? p.content : [], false) as StyledText[] });
    } else if (p.type === 'notebookLink') {
      const props = (p.props ?? {}) as Partial<NotebookLinkInline['props']>;
      out.push({ type: 'notebookLink', props: { notebookId: typeof props.notebookId === 'string' ? props.notebookId : '', target: typeof props.target === 'string' ? props.target : '' } });
    }
  }
  return out;
}

/** Inline content as a page file keeps it: kept styles only, no empty text, neighbours with equal styles merged. */
export function normalizeInline(content: unknown): Inline[] {
  return normalizeRuns(Array.isArray(content) ? content : [], true);
}

// ---- Writing ----

type Token = { mark: string } | { text: string; code: boolean };

/** The marks that take the styles from `from` to `to`. Code is innermost: closed first and opened last. */
function transition(from: Styles, to: Styles): string[] {
  const marks: string[] = [];
  const codeOpen = from.code === true;
  const othersChange = !sameStyles({ ...from, code: undefined }, { ...to, code: undefined });
  const closeCode = codeOpen && (!to.code || othersChange);
  if (closeCode) marks.push('`');
  if (from.backgroundColor !== to.backgroundColor) {
    if (from.backgroundColor) marks.push('==');
    if (to.backgroundColor) marks.push(to.backgroundColor === 'yellow' ? '==' : `=={${to.backgroundColor}}`);
  }
  if (!!from.bold !== !!to.bold) marks.push('**');
  if (!!from.italic !== !!to.italic) marks.push('*');
  if (!!from.strike !== !!to.strike) marks.push('~~');
  if (from.underline && !to.underline) marks.push('</u>');
  if (!from.underline && to.underline) marks.push('<u>');
  if (to.code && (!codeOpen || closeCode)) marks.push('`');
  return marks;
}

const ALWAYS_ESCAPED = new Set(['\\', '*', '`', '[', ']']);

function escapeText(text: string, before: string, after: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const prev = i === 0 ? before : text[i - 1];
    const next = i === text.length - 1 ? after : text[i + 1];
    const doubled = (c === '=' || c === '~') && (prev === c || next === c);
    const opensUnderline = c === '<' && (text.startsWith('u>', i + 1) || text.startsWith('/u>', i + 1));
    if (ALWAYS_ESCAPED.has(c) || doubled || opensUnderline) out += '\\';
    out += c;
  }
  return out;
}

const escapeCode = (text: string) => text.replace(/[\\`]/g, (c) => `\\${c}`);

function render(tokens: Token[]): string {
  let out = '';
  tokens.forEach((token, i) => {
    if ('mark' in token) {
      out += token.mark;
      return;
    }
    if (token.code) {
      out += escapeCode(token.text);
      return;
    }
    const next = tokens[i + 1];
    const after = next ? ('mark' in next ? next.mark[0] : next.text[0]) : '';
    const prevToken = tokens[i - 1];
    let text = escapeText(token.text, out.at(-1) ?? '', after ?? '');
    // '{' straight after '==' would read as the start of a colour: '=={blue}'.
    if (prevToken && 'mark' in prevToken && prevToken.mark === '==' && text.startsWith('{')) text = `\\${text}`;
    out += text;
  });
  return out;
}

const escapeHref = (href: string) => href.replace(/[\\()]/g, (c) => `\\${c}`);

/** A block's inline content written as marked-up text. `linkText` gives the words inside a page link's [[ ]]. */
export function inlineToMarkup(content: unknown, linkText: (link: NotebookLinkInline) => string): string {
  const tokens: Token[] = [];
  let state: Styles = {};
  const moveTo = (to: Styles) => {
    for (const mark of transition(state, to)) tokens.push({ mark });
    state = to;
  };
  for (const part of normalizeInline(content)) {
    if (part.type === 'text') {
      moveTo(part.styles as Styles);
      tokens.push({ text: part.text, code: state.code === true });
    } else if (part.type === 'notebookLink') {
      // Inside code the link would read as code.
      if (state.code) moveTo({ ...state, code: undefined });
      tokens.push({ mark: `[[${linkText(part)}]]` });
    } else {
      moveTo({});
      tokens.push({ mark: '[' });
      for (const word of part.content) {
        moveTo(word.styles as Styles);
        tokens.push({ text: word.text, code: state.code === true });
      }
      moveTo({});
      tokens.push({ mark: `](${escapeHref(part.href)})` });
    }
  }
  moveTo({});
  return render(tokens);
}

// ---- Reading ----

interface Reader {
  text: string;
  i: number;
  styles: Styles;
}

const COLOR_MARK = /^==\{([a-z]+)\}/;

/** Reads a web link's '[words](address)' starting at '[', or returns null and leaves the reader where it was. */
function readWebLink(r: Reader): LinkInline | null {
  const start = r.i;
  r.i++;
  const words = readRuns(r, true);
  if (!r.text.startsWith('](', r.i)) {
    r.i = start;
    return null;
  }
  let i = r.i + 2;
  let href = '';
  while (i < r.text.length && r.text[i] !== ')') {
    if (r.text[i] === '\\' && i + 1 < r.text.length) i++;
    href += r.text[i];
    i++;
  }
  if (i >= r.text.length) {
    r.i = start;
    return null;
  }
  r.i = i + 1;
  return { type: 'link', href, content: normalizeRuns(words, false) as StyledText[] };
}

/** Reads runs until the end, or, inside a link's words, until the '](' that ends them. */
function readRuns(r: Reader, inLink: boolean): Inline[] {
  const out: Inline[] = [];
  const plain = (c: string) => out.push(run(c, r.styles));
  const { text } = r;
  while (r.i < text.length) {
    // Long enough for the longest mark, "=={purple}".
    const rest = text.slice(r.i, r.i + 12);
    const c = text[r.i];

    if (r.styles.code) {
      if (c === '\\' && (text[r.i + 1] === '`' || text[r.i + 1] === '\\')) {
        plain(text[r.i + 1]);
        r.i += 2;
      } else if (c === '`') {
        r.styles = { ...r.styles, code: undefined };
        r.i++;
      } else {
        plain(c);
        r.i++;
      }
      continue;
    }

    if (inLink && rest.startsWith('](')) return out;

    if (c === '\\') {
      plain(r.i + 1 < text.length ? text[r.i + 1] : '\\');
      r.i += 2;
      continue;
    }

    const color = COLOR_MARK.exec(rest);
    if (color && isColor(color[1])) {
      r.styles = { ...r.styles, backgroundColor: color[1] };
      r.i += color[0].length;
      continue;
    }

    const marks: [string, (s: Styles) => Styles][] = [
      ['==', (s) => ({ ...s, backgroundColor: s.backgroundColor ? undefined : 'yellow' })],
      ['**', (s) => ({ ...s, bold: s.bold ? undefined : true })],
      ['*', (s) => ({ ...s, italic: s.italic ? undefined : true })],
      ['~~', (s) => ({ ...s, strike: s.strike ? undefined : true })],
      ['<u>', (s) => ({ ...s, underline: true })],
      ['</u>', (s) => ({ ...s, underline: undefined })],
      ['`', (s) => ({ ...s, code: true })],
    ];
    const mark = marks.find(([m]) => rest.startsWith(m));
    if (mark) {
      r.styles = mark[1](r.styles);
      r.i += mark[0].length;
      continue;
    }

    if (!inLink && rest.startsWith('[[')) {
      const end = text.indexOf(']]', r.i + 2);
      if (end >= 0) {
        out.push({ type: 'notebookLink', props: { notebookId: '', target: text.slice(r.i + 2, end) } });
        r.i = end + 2;
        continue;
      }
    }

    if (!inLink && c === '[') {
      const link = readWebLink(r);
      if (link) {
        out.push(link);
        continue;
      }
    }

    plain(c);
    r.i++;
  }
  return out;
}

/** Marked-up text read back into inline content. Page links come back unresolved: their words are in `target`. */
export function markupToInline(text: string): Inline[] {
  const reader: Reader = { text, i: 0, styles: {} };
  return normalizeInline(readRuns(reader, false));
}

