import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { DrawingCell } from '../types';
import { useStore } from '../store';
import { useLocked } from '../claude/store';
import { DrawingCanvas } from './DrawingCanvas';
import { DrawingToolbar } from './DrawingToolbar';
import { GROW_BY, type Background, type Stroke } from './model';
import { grownHeight, strokeBottom } from './strokes';
import { usePen } from './penSettings';
import './drawing.css';

type Snapshot = Pick<DrawingCell, 'strokes' | 'height' | 'background'>;

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

/**
 * A drawing block: the toolbar, the canvas and room to grow. Every change goes to the page at once, so a
 * stroke finished just before quitting is saved. Undo and redo last while the drawing is on screen.
 */
export function DrawingView({ notebookId, drawing }: { notebookId: string; drawing: DrawingCell }) {
  const pen = usePen();
  // While Claude works on the page the drawing can be looked at, not changed: no strokes, no undo.
  const locked = useLocked(notebookId);
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);
  const [, setVersion] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);

  /** The drawing as the page holds it now: newer than this render's after a change from disk, or once off screen. */
  const latest = (): DrawingCell => {
    const item = useStore.getState().notebooks.find((n) => n.id === notebookId)?.items[drawing.id];
    return item?.type === 'drawing' ? item : drawing;
  };
  const current = (): Snapshot => {
    const { strokes, height, background } = latest();
    return { strokes, height, background };
  };

  const apply = useCallback(
    (next: Snapshot) => useStore.getState().updateItem<DrawingCell>(notebookId, drawing.id, next),
    [notebookId, drawing.id],
  );

  /** A change that undo can take back. */
  const change = (next: Partial<Snapshot>) => {
    if (locked) return;
    undo.current.push(current());
    redo.current = [];
    apply({ ...current(), ...next });
    setVersion((v) => v + 1);
  };

  const step = (from: { current: Snapshot[] }, to: { current: Snapshot[] }) => {
    if (locked) return;
    const snapshot = from.current.pop();
    if (!snapshot) return;
    to.current.push(current());
    apply(snapshot);
    setVersion((v) => v + 1);
  };

  const onStroke = (stroke: Stroke) => {
    const now = latest();
    change({ strokes: [...now.strokes, stroke], height: grownHeight(now.height, strokeBottom(stroke)) });
  };
  const onErase = (ids: string[]) => {
    const gone = new Set(ids);
    change({ strokes: latest().strokes.filter((s) => !gone.has(s.id)) });
  };
  const onBackground = (background: Background) => {
    pen.setPen({ background });
    if (background !== latest().background) change({ background });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) step(redo, undo);
      else step(undo, redo);
    } else if (e.key === 'Escape' && fullScreen) {
      leaveFullScreen();
    }
  };

  // Full screen: the window's own, when the system allows it; the overlay covers the window either way.
  useEffect(() => {
    if (!fullScreen) return;
    const el = overlay.current;
    el?.focus({ preventScroll: true });
    void el?.requestFullscreen?.().catch(() => {});
    const onChange = () => {
      if (!document.fullscreenElement) setFullScreen(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [fullScreen]);

  const leaveFullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => setFullScreen(false));
    else setFullScreen(false);
  };

  const toolbar = (
    <DrawingToolbar
      background={drawing.background}
      onBackground={onBackground}
      canUndo={undo.current.length > 0}
      canRedo={redo.current.length > 0}
      onUndo={() => step(undo, redo)}
      onRedo={() => step(redo, undo)}
      fullScreen={fullScreen}
      onFullScreen={fullScreen ? leaveFullScreen : () => setFullScreen(true)}
    />
  );

  const canvas = (where: string) => (
    <DrawingCanvas
      drawing={drawing}
      pen={pen}
      locked={locked}
      onStroke={onStroke}
      onErase={onErase}
      patternId={`rules-${drawing.id}-${where}`}
      liveKey={`${notebookId}/${drawing.id}/${where}`}
    />
  );

  const more = (
    <button className="quiet drawing-more" onClick={() => change({ height: drawing.height + GROW_BY })}>
      + More space
    </button>
  );

  return (
    <div className="drawing" tabIndex={0} onKeyDown={onKeyDown}>
      {toolbar}
      {fullScreen ? <div className="drawing-placeholder">Drawing in full screen…</div> : canvas('page')}
      {!fullScreen && more}
      {fullScreen &&
        createPortal(
          <div ref={overlay} className="drawing-fullscreen" tabIndex={-1}>
            {toolbar}
            <div className="drawing-fullscreen-sheet">
              {canvas('full')}
              {more}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
