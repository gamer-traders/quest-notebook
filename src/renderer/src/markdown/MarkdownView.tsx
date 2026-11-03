import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { MarkdownFile } from '../types';
import { useStore } from '../store';
import { ancestorsOf, displayTitle } from '../page/tree';
import { markdownName } from './model';
import { linkTarget, renderMarkdown } from './render';
import { markdownSaves } from './saving';
import './markdown.css';

/** How long typing pauses before what's written is saved. */
const SAVE_DELAY = 800;

/**
 * A Markdown file: formatted to read, and Edit for its text as it's written. Edits are saved a moment after typing
 * pauses, over the text they started from, so a change made on disk meanwhile is never written over: the owner
 * chooses whether to keep their words or take the file as it is now.
 */
export function MarkdownView({ file }: { file: MarkdownFile }) {
  const notebooks = useStore((s) => s.notebooks);
  const spaces = useStore((s) => s.spaces);
  const [editing, setEditing] = useState(false);
  const [draft, setDraftState] = useState(file.text);
  const [conflict, setConflictState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What async saves read: the latest of each, not the one from the render they started in.
  const draftRef = useRef(file.text);
  const conflictRef = useRef(false);
  const fileRef = useRef(file);
  fileRef.current = file;
  /** The text on disk the words are written over: the file as opened, then as last saved. */
  const base = useRef(file.text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDraft = (text: string) => {
    draftRef.current = text;
    setDraftState(text);
  };
  const setConflict = (on: boolean) => {
    conflictRef.current = on;
    setConflictState(on);
  };

  /** Saves the words over `over`, the text on disk they replace. While a refused save waits for the owner, only their choice saves. */
  const save = async (over?: string): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (conflictRef.current && over === undefined) return;
    const text = draftRef.current;
    const from = over ?? base.current;
    if (text === from) return;
    const { path, id } = fileRef.current;
    const result = await window.quest.workspace.saveMarkdown({ root: useStore.getState().workspace?.root, path, text, base: from });
    if (result.ok) {
      base.current = text;
      setConflict(false);
      setError(null);
      useStore.getState().setMarkdownText(id, text);
    } else if (result.stale) {
      setConflict(true);
    } else {
      setError(result.error);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // The window waits for what's written before it closes; a file left for another is saved as it goes.
  useEffect(() => {
    const forget = markdownSaves.register(() => saveRef.current());
    return () => {
      forget();
      void saveRef.current();
    };
  }, [file.id]);

  // A change from disk shows at once, unless there are words of the owner's still to save.
  useEffect(() => {
    if (draftRef.current !== base.current) return;
    base.current = file.text;
    setDraft(file.text);
  }, [file.text]);

  const onChange = (text: string) => {
    setDraft(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current(), SAVE_DELAY);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === 's' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  const done = () => {
    void save();
    setEditing(false);
  };

  const keepMine = () => void save(file.text);
  const takeTheirs = () => {
    base.current = file.text;
    setDraft(file.text);
    setConflict(false);
  };

  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const { notebooks, markdown, openNotebook } = useStore.getState();
    const link = a.dataset.wikilink !== undefined ? { wikilink: a.dataset.wikilink } : { href: a.getAttribute('href') ?? '' };
    const to = linkTarget(link, file, notebooks, markdown);
    if (to && 'open' in to) openNotebook(to.open);
    else if (to) void window.quest.app.openExternal(to.web);
  };

  const html = useMemo(() => renderMarkdown(draft), [draft]);
  const space = spaces.find((s) => s.id === file.spaceId);
  const parent = notebooks.find((n) => n.id === file.parentId);
  const chain = parent ? [...ancestorsOf(notebooks, parent.id), parent] : [];
  const name = markdownName(file);

  return (
    <article className="notebook markdown-page" aria-label={name}>
      <nav className="page-path" aria-label="Page path">
        <span className="path-item">
          <span className="path-part">{space?.name ?? ''}</span>
          <span className="path-sep" aria-hidden="true">
            ›
          </span>
        </span>
        {chain.map((page) => (
          <span className="path-item" key={page.id}>
            <button className="path-part" onClick={() => useStore.getState().openNotebook(page.id)}>
              {displayTitle(page.title)}
            </button>
            <span className="path-sep" aria-hidden="true">
              ›
            </span>
          </span>
        ))}
        <span className="path-item">
          <span className="path-here" aria-current="page">
            {name}.md
          </span>
        </span>
      </nav>
      <header className="notebook-head">
        <h1 className="markdown-title">{name}</h1>
        <div className="notebook-meta">
          <button className="quiet" onClick={editing ? done : () => setEditing(true)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </header>
      {conflict && (
        <div className="migration-banner storage-warning" role="alert">
          <p>This file changed on disk while you were editing it. Your words are still here.</p>
          <span className="markdown-choices">
            <button className="quiet" onClick={keepMine}>
              Keep my version
            </button>
            <button className="quiet" onClick={takeTheirs}>
              Use the file’s version
            </button>
          </span>
        </div>
      )}
      {error && (
        <div className="migration-banner storage-warning" role="alert">
          <p>This file couldn't be saved: {error}</p>
        </div>
      )}
      {editing ? (
        <textarea
          className="markdown-source"
          aria-label={`${name}.md`}
          spellCheck
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
      ) : (
        <div className="markdown-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </article>
  );
}
