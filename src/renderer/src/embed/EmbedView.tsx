import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { EmbedCell } from '../types';
import { useStore } from '../store';
import { MAX_EMBED_HEIGHT, MIN_EMBED_HEIGHT, showableUrl } from './model';
import './embed.css';

// HTML written into the page runs with no origin of its own: with scripts allowed, the app's origin would let it
// reach into the app. A web page keeps its own site's origin, which is never the app's, so it works as it does
// in a browser. Neither can move the app's window.
const SANDBOX_HTML = 'allow-scripts allow-forms allow-popups allow-modals';
const SANDBOX_PAGE = 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals';

/**
 * An embed block: HTML with its own CSS and scripts, or a web page by its address, in a frame of its own. Edit opens
 * the HTML or the address, and Done shows it, so a page isn't reloaded at every key.
 */
export function EmbedView({ notebookId, embed }: { notebookId: string; embed: EmbedCell }) {
  const source = (cell: EmbedCell) => (cell.kind === 'url' ? cell.url : cell.html);
  const [editing, setEditing] = useState(() => source(embed).trim() === '');
  const [draft, setDraft] = useState(() => source(embed));
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);

  const update = (patch: Partial<EmbedCell>) => useStore.getState().updateItem<EmbedCell>(notebookId, embed.id, patch);
  const field = embed.kind === 'url' ? 'url' : 'html';

  const done = () => {
    update({ [field]: field === 'url' ? draft.trim() : draft });
    setEditing(false);
  };

  const choose = (kind: EmbedCell['kind']) => {
    if (kind === embed.kind) return;
    // What's being written is kept with the kind it was written for.
    const kept = editing ? { [field]: field === 'url' ? draft.trim() : draft } : {};
    const next = { ...embed, ...kept, kind };
    update({ ...kept, kind });
    setDraft(source(next));
    setEditing(source(next).trim() === '');
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || field === 'url')) {
      e.preventDefault();
      done();
    }
  };

  const onResizeStart = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startHeight: embed.height };
    setDragHeight(embed.height);
  };
  const onResizeMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setDragHeight(Math.min(MAX_EMBED_HEIGHT, Math.max(MIN_EMBED_HEIGHT, Math.round(d.startHeight + e.clientY - d.startY))));
  };
  const onResizeEnd = () => {
    if (drag.current && dragHeight !== null && dragHeight !== embed.height) update({ height: dragHeight });
    drag.current = null;
    setDragHeight(null);
  };

  const height = dragHeight ?? embed.height;
  const url = embed.kind === 'url' ? showableUrl(embed.url, location.origin) : null;

  let shown;
  if (embed.kind === 'html') {
    shown = embed.html.trim() ? (
      <iframe className="embed-frame" title="Embedded HTML" sandbox={SANDBOX_HTML} srcDoc={embed.html} style={{ height }} allowFullScreen />
    ) : (
      <p className="embed-empty">Write HTML, with its CSS and scripts, and choose Done to show it.</p>
    );
  } else if (url) {
    shown = <iframe className="embed-frame" title="Embedded web page" sandbox={SANDBOX_PAGE} src={url} style={{ height }} allowFullScreen />;
  } else {
    shown = (
      <p className="embed-empty">
        {embed.url.trim() ? 'Only web pages can be shown here: an address starting with http:// or https://.' : 'Write the address of a web page, starting with https://.'}
      </p>
    );
  }

  return (
    <div className={`embed${dragHeight !== null ? ' resizing' : ''}`}>
      <div className="embed-toolbar">
        <div className="segmented" role="group" aria-label="What to show">
          <button aria-pressed={embed.kind === 'html'} onClick={() => choose('html')}>
            HTML
          </button>
          <button aria-pressed={embed.kind === 'url'} onClick={() => choose('url')}>
            Web page
          </button>
        </div>
        {editing ? (
          <button className="quiet" onClick={done}>
            Done
          </button>
        ) : (
          <button
            className="quiet"
            onClick={() => {
              setDraft(source(embed));
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </div>
      {editing &&
        (field === 'html' ? (
          <textarea
            className="embed-source"
            aria-label="HTML"
            spellCheck={false}
            value={draft}
            placeholder="<style>…</style> <div>…</div> <script>…</script>"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
          />
        ) : (
          <input
            className="embed-address"
            aria-label="Web address"
            type="url"
            spellCheck={false}
            value={draft}
            placeholder="https://"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
          />
        ))}
      {shown}
      <div
        className="embed-resize"
        role="separator"
        aria-label="Drag to change the height"
        aria-orientation="horizontal"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />
    </div>
  );
}
