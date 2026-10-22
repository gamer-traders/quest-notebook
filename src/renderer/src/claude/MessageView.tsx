import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatAction, ChatMessage, FileChange } from '@shared/ipc';
import { useStore } from '../store';
import { displayTitle } from '../page/tree';
import { actionLabel } from './labels';
import { changeVerb, drawableMessage, errorText, isWebUrl, pagePathFor, referenceLabel, undoablePaths } from './panel';
import { useClaude } from './store';

/** Shows a call to main that failed, above the message box. */
export function report(p: Promise<unknown>): void {
  p.catch((err) => useClaude.setState({ error: errorText(err) }));
}

/** Pages by path and by id, for naming what Claude touched. */
export interface PageIndex {
  /** The title of the page file at a path, as `actionLabel` wants it. */
  titleOfPath: (path: string) => string | null;
  /** The page a path belongs to: the page file's own, or for a drawing its page's. */
  pageAt: (path: string) => string | null;
  titleOf: (id: string) => string | null;
}

// Each page's id, path and title in one string. It changes when a page is added, renamed or moved,
// not with every word typed on a page, so the chat isn't drawn again while the owner writes.
const pagesKey = (s: { notebooks: { id: string; path?: string; title: string }[] }) => s.notebooks.map((n) => `${n.id}\t${n.path ?? ''}\t${n.title}`).join('\n');

export function usePageIndex(): PageIndex {
  const key = useStore(pagesKey);
  return useMemo(() => {
    const byPath = new Map<string, string>();
    const titles = new Map<string, string>();
    for (const n of useStore.getState().notebooks) {
      if (n.path) byPath.set(n.path, n.id);
      titles.set(n.id, displayTitle(n.title));
    }
    return {
      titleOfPath: (path) => titles.get(byPath.get(path) ?? '') ?? null,
      pageAt: (path) => byPath.get(pagePathFor(path)) ?? null,
      titleOf: (id) => titles.get(id) ?? null,
    };
    // The key stands for the notebooks it was made from.
  }, [key]);
}

const openPage = (id: string) => useStore.getState().openNotebook(id);

/** A line that opens its page when there is one to open. */
function PageLine({ pageId, className, children }: { pageId: string | null; className?: string; children: ReactNode }) {
  if (!pageId) return <span className={className}>{children}</span>;
  return (
    <button type="button" className={`claude-line-link${className ? ` ${className}` : ''}`} onClick={() => openPage(pageId)}>
      {children}
    </button>
  );
}

// Links open in the browser, and only web links: nothing in a reply can make the app go somewhere.
// Pictures aren't fetched; their words are shown instead. Tables, task lists and strikethrough come from GFM.
const MARKDOWN: Components = {
  a: ({ href, children }) =>
    href && isWebUrl(href) ? (
      <a
        href={href}
        title={href}
        onClick={(e) => {
          e.preventDefault();
          void window.quest.app.openExternal(href);
        }}
      >
        {children}
      </a>
    ) : (
      <span className="claude-link-off">{children}</span>
    ),
  img: ({ alt }) => <span className="claude-img">{alt ? `[image: ${alt}]` : '[image]'}</span>,
};

const REMARK = [remarkGfm];

const ReplyText = memo(function ReplyText({ text }: { text: string }) {
  return (
    <div className="claude-md">
      <Markdown skipHtml remarkPlugins={REMARK} components={MARKDOWN}>
        {text}
      </Markdown>
    </div>
  );
});

/** What Claude did, a line each: "Read *Weekly levels*", "Searched for “breakout”". */
export function ActionLines({ actions, pages }: { actions: ChatAction[]; pages: PageIndex }) {
  if (actions.length === 0) return null;
  return (
    <ul className="claude-actions" aria-label="What Claude did">
      {actions.map((a, i) => {
        const { text, target, refused } = actionLabel(a, pages.titleOfPath);
        return (
          <li key={a.id ?? i} className={refused ? 'is-refused' : undefined}>
            <PageLine pageId={a.path ? pages.pageAt(a.path) : null}>
              {text}
              {target !== null && (
                <>
                  {' '}
                  <em>{target}</em>
                </>
              )}
              {refused && ' (refused)'}
            </PageLine>
          </li>
        );
      })}
    </ul>
  );
}

interface ChangesProps {
  message: ChatMessage;
  pages: PageIndex;
  /** Pages this reply's changes didn't reach, because the owner was writing on them. */
  notApplied: string[] | undefined;
  /** A turn is running: main refuses undo until it ends. */
  busy: boolean;
}

/**
 * The pages and drawings a reply changed, each with Undo, and Undo all. A page the changes didn't reach has
 * no Undo: its file holds what the owner wrote, which an undo would put back to before the reply.
 */
function ChangedLines({ message, pages, notApplied = [], busy }: ChangesProps) {
  const changes = message.changes ?? [];
  if (changes.length === 0) return null;
  const undone = message.undone ?? [];
  const undoable = undoablePaths(message, notApplied);
  const undo = (paths: string[] | null) => report(useClaude.getState().undo(message.id, paths));

  const line = (c: FileChange) => {
    const title = (c.pageId && pages.titleOf(c.pageId)) || c.path;
    const isUndone = undone.includes(c.path);
    const skipped = c.pageId !== undefined && notApplied.includes(c.pageId);
    return (
      <li key={c.path} className={isUndone ? 'is-undone' : undefined}>
        <PageLine pageId={c.pageId && pages.titleOf(c.pageId) !== null ? c.pageId : null} className="claude-change">
          {changeVerb(c)} <em>{title}</em>
          {isUndone && <span className="sr-only"> (undone)</span>}
        </PageLine>
        {skipped && <span className="claude-not-applied">not applied: you were editing this page</span>}
        {!isUndone && !skipped && (
          <button type="button" className="quiet claude-undo" disabled={busy} aria-label={`Undo: ${changeVerb(c)} ${title}`} onClick={() => undo([c.path])}>
            Undo
          </button>
        )}
      </li>
    );
  };

  // With every change reached, all of them: main works out which are left.
  const all = undoable.length === undoablePaths(message).length ? null : undoable;
  return (
    <div className="claude-changes">
      <p className="claude-changes-head">Changed:</p>
      <ul>{changes.map(line)}</ul>
      {undoable.length >= 2 && (
        <button type="button" className="quiet claude-undo-all" disabled={busy} onClick={() => undo(all)}>
          Undo all
        </button>
      )}
    </div>
  );
}

function References({ message }: { message: ChatMessage }) {
  const refs = message.references ?? [];
  if (refs.length === 0) return null;
  return (
    <ul className="claude-chips" aria-label="Attached">
      {refs.map((r, i) => (
        <li key={`${r.pageId}-${i}`} className="claude-chip" title={r.kind === 'selection' ? r.text.slice(0, 300) : undefined}>
          {referenceLabel(r)}
        </li>
      ))}
    </ul>
  );
}

interface MessageProps {
  message: ChatMessage;
  pages: PageIndex;
  notApplied: string[] | undefined;
  busy: boolean;
}

/** One message: the owner's on a highlighter tint, Claude's on paper, with what it did and changed. */
export const MessageView = memo(function MessageView({ message: saved, pages, notApplied, busy }: MessageProps) {
  // Read from a file that may be damaged: only what can be drawn is.
  const message = drawableMessage(saved);
  if (message.role === 'user') {
    return (
      <li className="claude-msg is-user">
        <References message={message} />
        <p className="claude-plain">{message.text}</p>
      </li>
    );
  }
  return (
    <li className="claude-msg is-reply">
      {message.text && <ReplyText text={message.text} />}
      <ActionLines actions={message.actions ?? []} pages={pages} />
      {message.error && <p className="claude-msg-error">{message.error}</p>}
      <ChangedLines message={message} pages={pages} notApplied={notApplied} busy={busy} />
    </li>
  );
});

interface Shown {
  text: string;
  actions: ChatAction[];
}

/**
 * The reply being written. It takes the store's pieces at most once a frame, joining only the new ones,
 * and shows them as plain text: parsing Markdown on every piece would stutter. The finished reply is Markdown.
 */
export function StreamingReply({ pages, onGrow }: { pages: PageIndex; onGrow: () => void }) {
  const joined = useRef<{ pieces: string[] | null; count: number; text: string }>({ pieces: null, count: 0, text: '' });

  const read = (): Shown => {
    const { text: pieces, actions } = useClaude.getState().streaming;
    const j = joined.current;
    if (pieces !== j.pieces) Object.assign(j, { pieces, count: 0, text: '' });
    if (pieces.length > j.count) {
      j.text += pieces.slice(j.count).join('');
      j.count = pieces.length;
    }
    return { text: j.text, actions };
  };

  const [shown, setShown] = useState(read);

  useEffect(() => {
    let frame = 0;
    const unsubscribe = useClaude.subscribe((s, prev) => {
      if (s.streaming === prev.streaming || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setShown(read());
      });
    });
    // Anything that came between the first draw and subscribing.
    setShown(read());
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
    // `read` only touches a ref and the store.
  }, []);

  useLayoutEffect(onGrow, [shown, onGrow]);

  return (
    <li className="claude-msg is-reply is-streaming" aria-busy="true">
      {shown.text ? <p className="claude-plain">{shown.text}</p> : shown.actions.length === 0 && <p className="claude-working">Working…</p>}
      <ActionLines actions={shown.actions} pages={pages} />
    </li>
  );
}
