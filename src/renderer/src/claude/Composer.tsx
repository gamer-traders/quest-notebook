import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import type { ChatReference } from '@shared/ipc';
import { useStore } from '../store';
import { displayTitle } from '../page/tree';
import { linkChoiceLabel, linkChoicePath, linkChoices, type LinkChoice } from '../editor/linkItems';
import { atQuery, isTooLong, referenceLabel, withoutQuery } from './panel';
import { useClaude } from './store';

type PageChoice = Extract<LinkChoice, { kind: 'notebook' }>;

export interface ComposerHandle {
  focus: () => void;
  /** Puts words in the box, to be edited before sending. */
  fill: (text: string) => void;
}

/** Puts focus back on the page: its text, or its title when it has no editor. */
export function focusPage(): void {
  const target = document.querySelector<HTMLElement>('.page-editor [contenteditable="true"]') ?? document.querySelector<HTMLElement>('.notebook-title');
  if (target) target.focus();
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

// Drawn like the [[ menu's page icon.
const PAGE_ICON = (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h3" />
  </svg>
);

function Chip({ label, title, removeLabel, onRemove }: { label: string; title?: string; removeLabel: string; onRemove: () => void }) {
  return (
    <li className="claude-chip" title={title}>
      <span className="claude-chip-label">{label}</span>
      <button type="button" className="claude-chip-remove" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
        ×
      </button>
    </li>
  );
}

/** What goes with the next message: the open page, unless taken off, and pages or passages attached. */
function Chips({ openPageId }: { openPageId: string | null }) {
  const attachments = useClaude((s) => s.attachments);
  const skipOpenPage = useClaude((s) => s.skipOpenPage);
  const openTitle = useStore((s) => (openPageId ? displayTitle(s.notebooks.find((n) => n.id === openPageId)?.title ?? '') : ''));
  const { setSkipOpenPage, detach } = useClaude.getState();
  const showPage = openPageId !== null && !skipOpenPage;
  if (!showPage && attachments.length === 0) return null;

  const key = (r: ChatReference, i: number) => `${r.kind}-${r.pageId}-${i}`;
  return (
    <ul className="claude-chips" aria-label="Sent with your message">
      {showPage && <Chip label="This page" title={openTitle} removeLabel="Leave out this page" onRemove={() => setSkipOpenPage(true)} />}
      {attachments.map((r, i) => (
        <Chip
          key={key(r, i)}
          label={referenceLabel(r)}
          title={r.kind === 'selection' ? r.text.slice(0, 300) : undefined}
          removeLabel={`Remove ${referenceLabel(r)}`}
          onRemove={() => detach(i)}
        />
      ))}
    </ul>
  );
}

/**
 * The message box. Enter sends and Shift+Enter starts a new line. Typing @ offers pages to attach, by title and
 * path like the [[ menu; arrows move, Enter or Tab choose, Escape closes.
 */
export function Composer({ ref, openPageId }: { ref?: Ref<ComposerHandle>; openPageId: string | null }) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState(0);
  // Where the @ is that the owner closed the picker on, so it stays closed for that @.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const nextCaret = useRef<number | null>(null);
  const listId = useId();

  const running = useClaude((s) => s.running !== null);
  const sending = useClaude((s) => s.sending);
  const error = useClaude((s) => s.error);

  const at = atQuery(text, caret);
  const asking = at !== null && at.start !== dismissed;
  // The pages only matter while the picker is open; otherwise every word typed on a page would draw this again.
  const notebooks = useStore((s) => (asking ? s.notebooks : null));
  const spaces = useStore((s) => s.spaces);
  const query = asking ? at.query : null;
  const choices = useMemo(
    () => (notebooks && query !== null ? linkChoices(notebooks, query, '').filter((c): c is PageChoice => c.kind === 'notebook') : []),
    [notebooks, query],
  );
  const pickerOpen = choices.length > 0;
  const active = Math.min(picked, choices.length - 1);
  const optionId = (i: number) => `${listId}-${i}`;

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    fill: (words) => {
      setText(words);
      setCaret(words.length);
      nextCaret.current = words.length;
      area.current?.focus();
    },
  }));

  // The caret goes where a choice or a fill left it, once the new text is in the box.
  useLayoutEffect(() => {
    if (nextCaret.current === null || !area.current) return;
    area.current.setSelectionRange(nextCaret.current, nextCaret.current);
    nextCaret.current = null;
  }, [text]);

  useEffect(() => {
    if (pickerOpen) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [pickerOpen, active, listId]);

  const busy = running || sending;
  const tooLong = isTooLong(text);
  const canSend = !busy && !tooLong && text.trim() !== '';

  const submit = async () => {
    if (!canSend) return;
    const sent = text;
    await useClaude.getState().send(sent, openPageId);
    // Kept when it didn't go, so nothing typed is lost.
    if (!useClaude.getState().error) setText((now) => (now === sent ? '' : now));
  };

  const choose = (choice: PageChoice) => {
    if (!at) return;
    const next = withoutQuery(text, at.start, caret);
    setText(next.text);
    setCaret(next.caret);
    nextCaret.current = next.caret;
    useClaude.getState().attach({ kind: 'page', pageId: choice.notebookId, title: displayTitle(choice.title) });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter ends a word being composed in an input method; it doesn't send.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (pickerOpen && at) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setPicked((active + step + choices.length) % choices.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        choose(choices[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(at.start);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      focusPage();
    }
  };

  const onEdit = (value: string, caretAt: number) => {
    setText(value);
    setCaret(caretAt);
    setPicked(0);
    if (dismissed !== null && atQuery(value, caretAt)?.start !== dismissed) setDismissed(null);
  };

  return (
    <div className="claude-composer">
      {error && (
        <p className="claude-error" role="alert">
          <span>{error}</span>
          <button type="button" className="claude-chip-remove" aria-label="Dismiss" title="Dismiss" onClick={() => useClaude.setState({ error: null })}>
            ×
          </button>
        </p>
      )}
      <Chips openPageId={openPageId} />
      <div className="claude-box">
        <textarea
          ref={area}
          className="claude-input"
          rows={1}
          value={text}
          placeholder="Ask Claude, or type @ to add a page"
          aria-label="Message Claude"
          aria-autocomplete="list"
          aria-controls={pickerOpen ? listId : undefined}
          aria-activedescendant={pickerOpen ? optionId(active) : undefined}
          aria-describedby={tooLong ? `${listId}-long` : undefined}
          onChange={(e) => onEdit(e.target.value, e.target.selectionStart)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
        />
        {pickerOpen && (
          <ul id={listId} className="claude-picker" role="listbox" aria-label="Pages">
            {choices.map((c, i) => (
              <li
                key={c.notebookId}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'is-active' : undefined}
                // The caret stays in the box.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setPicked(i)}
                onClick={() => choose(c)}
              >
                <span className="claude-picker-icon">{PAGE_ICON}</span>
                <span className="claude-picker-text">
                  <span className="claude-picker-title">{linkChoiceLabel(c)}</span>
                  <span className="claude-picker-path">{linkChoicePath(c, notebooks ?? [], spaces)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="claude-send">
          <span className="claude-hint">{running ? 'Claude is working…' : 'Shift+Enter for a new line'}</span>
          {running && (
            <button type="button" className="quiet" onClick={() => useClaude.getState().stop()}>
              Stop
            </button>
          )}
          <button type="button" className="primary" disabled={!canSend} onClick={() => void submit()}>
            Send
          </button>
        </div>
      </div>
      {tooLong && (
        <p id={`${listId}-long`} className="claude-too-long">
          Too long to send
        </p>
      )}
    </div>
  );
}
