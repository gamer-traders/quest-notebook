import './claude.css';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import type { ChatReference, ClaudeStatus } from '@shared/ipc';
import { useStore } from '../store';
import { IS_MAC } from '../components/SettingsDialog';
import { Composer, focusPage, type ComposerHandle } from './Composer';
import { MessageView, StreamingReply, report, usePageIndex } from './MessageView';
import { claudeShortcutLabel, relativeDate } from './panel';
import { MAX_WIDTH, MIN_WIDTH, useClaude } from './store';

/** Set when the owner opens the panel, so the caret goes to the message box once it's there. */
let focusOnOpen = false;

/** Opens or closes the panel, from Cmd+J or the page's Claude button. Closing it from inside gives focus back to the page. */
export function toggleClaude(): void {
  const { open, setOpen } = useClaude.getState();
  if (open) {
    if (document.activeElement?.closest('.claude-panel')) focusPage();
    setOpen(false);
  } else {
    focusOnOpen = true;
    setOpen(true);
  }
}

/** Ask Claude about part of a page: it goes with the next message, and the caret goes to the message box. */
export function askClaude(ref: ChatReference): void {
  const { open, attach } = useClaude.getState();
  focusOnOpen = !open;
  attach(ref);
  if (open) document.querySelector<HTMLElement>('.claude-panel .claude-input')?.focus();
}

const QUICK_ACTIONS = ['Summarize this page', 'Tidy this page', 'Make a checklist from this page', "Turn this week's journal into a lesson page"];

const icon = (d: string) => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const CLOSE_ICON = icon('M6 6l12 12M18 6L6 18');
const PENCIL_ICON = icon('M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4');

/** The page open now, which goes with each message unless taken off. */
const useOpenPageId = () => useStore((s) => (s.view === 'notebook' && s.activeId !== null && s.notebooks.some((n) => n.id === s.activeId) ? s.activeId : null));

/** Earlier chats, newest first, each with delete. */
function ChatsMenu() {
  const chats = useClaude((s) => s.chats);
  const current = useClaude((s) => s.chat?.id ?? null);
  const runningChat = useClaude((s) => s.running?.chatId ?? null);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: globalThis.PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  useEffect(() => {
    if (open) wrap.current?.querySelector<HTMLButtonElement>('.claude-chat-open:not(:disabled)')?.focus();
  }, [open]);

  const sorted = [...chats].sort((a, b) => b.updated.localeCompare(a.updated));

  const choose = (id: string) => {
    setOpen(false);
    button.current?.focus();
    report(useClaude.getState().openChat(id));
  };

  const remove = (id: string) => {
    if (!window.confirm('Delete this chat?')) return;
    report(useClaude.getState().deleteChat(id).then(() => button.current?.focus()));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('.claude-chat-open:not(:disabled)') ?? [])];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = at < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  };

  return (
    <div className="claude-chats" ref={wrap} onKeyDown={onKeyDown}>
      <button ref={button} type="button" className="quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Chats{' '}
        <span className="claude-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="menu claude-chat-list" role="group" aria-label="Chats">
          {sorted.length === 0 ? (
            <p className="claude-chat-empty">No chats yet</p>
          ) : (
            <ul>
              {sorted.map((c) => {
                const title = c.title.trim() || 'Untitled chat';
                return (
                  <li key={c.id} className={`claude-chat-row${c.id === current ? ' is-current' : ''}`}>
                    <button
                      type="button"
                      className="claude-chat-open"
                      aria-current={c.id === current ? 'true' : undefined}
                      // While Claude answers, only its own chat can be shown.
                      disabled={runningChat !== null && c.id !== runningChat}
                      onClick={() => choose(c.id)}
                    >
                      <span className="claude-chat-title">{title}</span>
                      <span className="claude-chat-date">{relativeDate(c.updated)}</span>
                    </button>
                    <button
                      type="button"
                      className="claude-chat-delete"
                      aria-label={`Delete chat: ${title}`}
                      title="Delete chat"
                      disabled={c.id === runningChat}
                      onClick={() => remove(c.id)}
                    >
                      {CLOSE_ICON}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Header({ ready, onNewChat }: { ready: boolean; onNewChat: () => void }) {
  const title = useClaude((s) => s.chat?.title.trim() || 'New chat');
  const busy = useClaude((s) => s.running !== null || s.sending);
  const shown = ready ? title : 'Claude';
  return (
    <header className="claude-head">
      <h2 className="claude-title" title={shown}>
        {shown}
      </h2>
      {ready && <ChatsMenu />}
      {ready && (
        <button type="button" className="quiet" disabled={busy} onClick={onNewChat}>
          New chat
        </button>
      )}
      <button type="button" className="quiet claude-icon" aria-label="Close Claude" title={`Close (${claudeShortcutLabel(IS_MAC)})`} onClick={toggleClaude}>
        {CLOSE_ICON}
      </button>
    </header>
  );
}

/** In place of the chat when Claude Code can't be used yet: what to do about it, and Check again. */
function Setup({ status }: { status: ClaudeStatus }) {
  const [checking, setChecking] = useState(false);
  const check = () => {
    setChecking(true);
    report(useClaude.getState().refresh().finally(() => setChecking(false)));
  };
  return (
    <div className="claude-setup">
      {status.state === 'missing' && (
        <p>
          Claude Code isn't installed. Install it from{' '}
          <a
            href="https://claude.com/claude-code"
            onClick={(e) => {
              e.preventDefault();
              void window.quest.app.openExternal('https://claude.com/claude-code');
            }}
          >
            claude.com/claude-code
          </a>
          , then check again.
        </p>
      )}
      {status.state === 'logged-out' && (
        <p>
          Claude Code isn't logged in. Open Terminal, run <code>claude auth login</code>, then check again.
        </p>
      )}
      {status.state === 'error' && <p className="claude-setup-error">{status.message || 'Claude Code reported an error.'}</p>}
      <button type="button" disabled={checking} onClick={check}>
        {checking ? 'Checking…' : 'Check again'}
      </button>
    </div>
  );
}

/** An empty chat's starters. Each sends at once, with the open page; the pencil puts it in the box to edit first. */
function QuickActions({ openPageId, composer }: { openPageId: string | null; composer: RefObject<ComposerHandle | null> }) {
  const start = (text: string) => {
    const { setSkipOpenPage, send } = useClaude.getState();
    setSkipOpenPage(false);
    // The starters go once the message is sent, so the caret waits in the box.
    composer.current?.focus();
    void send(text, openPageId);
  };
  return (
    <div className="claude-empty">
      <p className="claude-empty-lede">Claude reads your notebook and can edit and add pages. Start with one of these, or write your own.</p>
      <ul className="claude-quick">
        {QUICK_ACTIONS.map((text, i) => (
          <li key={text}>
            <button type="button" id={`claude-quick-${i}`} className="claude-quick-send" onClick={() => start(text)}>
              {text}
            </button>
            <button
              type="button"
              className="quiet claude-icon"
              aria-label="Edit first"
              title="Edit first"
              aria-describedby={`claude-quick-${i}`}
              onClick={() => composer.current?.fill(text)}
            >
              {PENCIL_ICON}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The messages, the reply being written, and the message box. Not drawn again while the panel is resized. */
const Conversation = memo(function Conversation({ composer }: { composer: RefObject<ComposerHandle | null> }) {
  const chat = useClaude((s) => s.chat);
  const running = useClaude((s) => s.running);
  const sending = useClaude((s) => s.sending);
  const notApplied = useClaude((s) => s.notApplied);
  const pages = usePageIndex();
  const openPageId = useOpenPageId();
  const scroller = useRef<HTMLDivElement>(null);
  // Follows the bottom while Claude writes, until the owner scrolls up to read.
  const stick = useRef(true);

  const toBottom = useCallback(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, []);

  // Another chat, or a message just sent, starts at the bottom again.
  useLayoutEffect(() => {
    stick.current = true;
  }, [chat?.id, sending]);
  useLayoutEffect(toBottom, [chat, running, sending, toBottom]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  };

  const messages = chat?.messages ?? [];
  const busy = running !== null || sending;
  const streaming = running !== null && chat?.id === running.chatId;

  return (
    <>
      <div className="claude-scroll" ref={scroller} onScroll={onScroll}>
        {messages.length === 0 && !busy ? (
          <QuickActions openPageId={openPageId} composer={composer} />
        ) : (
          <ol className="claude-messages">
            {messages.map((m) => (
              <MessageView key={m.id} message={m} pages={pages} notApplied={notApplied[m.id]} busy={busy} />
            ))}
            {streaming && <StreamingReply pages={pages} onGrow={toBottom} />}
          </ol>
        )}
        {sending && <p className="claude-working">Sending…</p>}
      </div>
      <Composer ref={composer} openPageId={openPageId} />
    </>
  );
});

const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));

/**
 * Claude, in a column on the right of the window (over the page on narrow windows). Its left edge drags to
 * resize it, or takes the arrow keys.
 */
export function ClaudePanel() {
  const status = useClaude((s) => s.status);
  const storedWidth = useClaude((s) => s.width);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const drag = useRef<{ x: number; from: number; to: number | null } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const width = dragWidth ?? storedWidth;
  const ready = status?.state === 'ready';

  // Each opening looks for the CLI again and reads the chat list.
  useEffect(() => report(useClaude.getState().refresh()), []);

  // Once the check has answered, the caret goes to the message box, or to Check again.
  useEffect(() => {
    if (!focusOnOpen || status === null) return;
    focusOnOpen = false;
    if (status.state === 'ready') composer.current?.focus();
    else panel.current?.querySelector<HTMLButtonElement>('.claude-setup button')?.focus();
  }, [status]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // From the width it's drawn at, which a narrow window can make less than the one remembered.
    drag.current = { x: e.clientX, from: panel.current?.getBoundingClientRect().width ?? width, to: null };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.to = clampWidth(d.from + d.x - e.clientX);
    setDragWidth(d.to);
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragWidth(null);
    if (d.to !== null) useClaude.getState().setWidth(d.to);
  };

  const onResizeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const to = { ArrowLeft: width + step, ArrowRight: width - step, Home: MIN_WIDTH, End: MAX_WIDTH }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    useClaude.getState().setWidth(to);
  };

  const newChat = () => {
    report(useClaude.getState().openChat(null));
    composer.current?.focus();
  };

  return (
    <aside ref={panel} className={`claude-panel${dragWidth !== null ? ' is-resizing' : ''}`} aria-label="Claude" style={{ '--claude-width': `${width}px` } as CSSProperties}>
      <div
        className="claude-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Claude panel"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={onResizeKey}
      />
      <Header ready={ready} onNewChat={newChat} />
      {status === null ? (
        <p className="claude-checking">Checking…</p>
      ) : ready ? (
        <Conversation composer={composer} />
      ) : (
        <Setup status={status} />
      )}
    </aside>
  );
}
