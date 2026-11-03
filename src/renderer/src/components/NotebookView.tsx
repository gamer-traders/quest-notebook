import { useEffect, useRef } from 'react';
import { ITEM_BLOCK_TYPES } from '../page/blockTypes';
import { flattenBlocks } from '../page/blocks';
import { descendantIds, displayTitle } from '../page/tree';
import { useStore } from '../store';
import { NotebookEditor } from '../editor/NotebookEditor';
import { toggleClaude } from '../claude/ClaudePanel';
import { claudeShortcutLabel } from '../claude/panel';
import { useClaude, useHoldsLock, useLocked } from '../claude/store';
import { IS_MAC } from './SettingsDialog';
import { Backlinks } from './Backlinks';
import { PagePath } from './PagePath';
import { SubPagesPanel } from './SubPagesPanel';
import { LOCKED_SUB_PAGE, deletePageLabel, deletePageQuestion } from './sidebar/labels';
import { UnreadablePage } from './UnreadablePage';

const isItemType = (type: string) => (ITEM_BLOCK_TYPES as readonly string[]).includes(type);

export function NotebookView() {
  const nb = useStore((s) => s.notebooks.find((n) => n.id === s.activeId) ?? null);
  const { updateNotebook, deletePage, openTodayJournal, clearFlash } = useStore.getState();
  const subPages = useStore((s) => (nb ? descendantIds(s.notebooks, nb.id).length : 0));
  const flash = useStore((s) => s.flashBlockId);
  const focusTitleId = useStore((s) => s.focusTitleId);
  const revision = useStore((s) => (nb ? (s.diskRevision[nb.id] ?? 0) : 0));
  const claudeOpen = useClaude((s) => s.open);
  // Claude is working on this page: it reads, scrolls and follows links, but takes no edits until the turn ends.
  const locked = useLocked(nb?.id);
  // Nor is it deleted or renamed, nor a page above it: deleting one trashes it, and renaming one moves its file.
  const holdsLock = useHoldsLock(nb?.id);
  const titleRef = useRef<HTMLInputElement>(null);

  // A page just made from the sidebar or the panel opens with its title ready to type.
  useEffect(() => {
    if (!nb || focusTitleId !== nb.id) return;
    titleRef.current?.focus();
    titleRef.current?.select();
    useStore.getState().clearFocusTitle();
  }, [focusTitleId, nb?.id]);

  // A different notebook opens at its top, unless we're jumping to a block in it.
  useEffect(() => {
    if (!useStore.getState().flashBlockId) window.scrollTo(0, 0);
  }, [nb?.id]);

  // The editor draws charts, plans and predictions a frame or two after it mounts, and they push
  // the blocks below them down. Wait until they're all drawn before scrolling to the block.
  useEffect(() => {
    if (!flash) return;
    const { notebooks, activeId } = useStore.getState();
    const items = flattenBlocks(notebooks.find((n) => n.id === activeId)?.blocks ?? []).filter((b) => isItemType(b.type)).length;
    let frame = 0;
    let tries = 0;
    const find = () => {
      const el = document.querySelector(`.page-editor [data-id="${CSS.escape(flash)}"]`);
      const drawn = document.querySelectorAll('.page-editor .item-block').length >= items;
      if ((!el || !drawn) && ++tries < 60) {
        frame = requestAnimationFrame(find);
        return;
      }
      if (!el) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    };
    find();
    const t = setTimeout(clearFlash, 1800);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(t);
    };
  }, [flash, nb?.id, clearFlash]);

  if (!nb) {
    return (
      <div className="empty-page">
        <h1>Nothing open</h1>
        <p>Pick a page on the left, or start today's journal.</p>
        <button className="primary" onClick={openTodayJournal}>
          Start today's journal
        </button>
      </div>
    );
  }

  if (nb.loadError !== undefined) return <UnreadablePage page={nb} />;

  return (
    <article className="notebook" aria-label={displayTitle(nb.title)}>
      <PagePath page={nb} />
      <header className="notebook-head">
        <input
          ref={titleRef}
          className="notebook-title"
          value={nb.title}
          placeholder="Untitled"
          aria-label="Notebook title"
          readOnly={holdsLock}
          title={holdsLock && !locked ? LOCKED_SUB_PAGE : undefined}
          onChange={(e) => updateNotebook(nb.id, { title: e.target.value })}
        />
        <div className="notebook-meta">
          <button
            className="quiet"
            aria-expanded={claudeOpen}
            aria-keyshortcuts={IS_MAC ? 'Meta+J' : 'Control+J'}
            title={`${claudeOpen ? 'Close' : 'Open'} Claude (${claudeShortcutLabel(IS_MAC)})`}
            onClick={toggleClaude}
          >
            Claude
          </button>
          <button
            className="quiet danger"
            disabled={holdsLock}
            onClick={() => {
              const { notebooks } = useStore.getState();
              if (window.confirm(deletePageQuestion(displayTitle(nb.title), descendantIds(notebooks, nb.id).length))) deletePage(nb.id);
            }}
          >
            {deletePageLabel(subPages)}
          </button>
        </div>
      </header>
      <SubPagesPanel page={nb} />

      {/* The flash is a style rule rather than a class, so the editor's own DOM is never touched. */}
      {flash && <style>{`.page-editor [data-id="${CSS.escape(flash)}"] > .bn-block { animation: flash 1.6s ease-out; border-radius: var(--radius); }`}</style>}

      {locked && (
        <div className="claude-lock" role="status">
          <span>Claude is working on this page…</span>
          <button className="quiet" onClick={() => useClaude.getState().stop()}>
            Stop
          </button>
        </div>
      )}

      {/* A change on disk starts the editor over with the new page. */}
      <NotebookEditor key={`${nb.id}:${revision}`} notebook={nb} editable={!locked} />
      <Backlinks notebookId={nb.id} />
    </article>
  );
}
