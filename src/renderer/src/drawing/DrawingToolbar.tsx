import type { ReactNode } from 'react';
import { BACKGROUNDS, INK_COLORS, TOOLS, type Background, type Tool } from './model';
import { usePen } from './penSettings';

const TOOL_LABEL: Record<Tool, string> = { pen: 'Pen', pencil: 'Pencil', marker: 'Marker', highlighter: 'Highlighter', eraser: 'Eraser' };
const SIZE_LABEL = ['Fine', 'Medium', 'Bold'] as const;
const BACKGROUND_LABEL: Record<Background, string> = { blank: 'Blank', grid: 'Grid', lines: 'Lines' };

// Line icons on a 24-unit grid, in the text colour, like the / menu's.
const icon = (d: string) => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const TOOL_ICON: Record<Tool, ReactNode> = {
  pen: icon('M4 20l4-1 10-10-3-3L5 16zM14 7l3 3'),
  pencil: icon('M4 20l2-5L16 5l3 3L9 18zM14 7l3 3M4 20l2-1'),
  marker: icon('M6 18l-2 2h5l1-1M9 15l6-9 3 3-6 9-4 1z'),
  highlighter: icon('M4 20h7M9 15l7-11 4 3-7 11H9z'),
  eraser: icon('M8 20h12M5 15l8-9 6 6-8 8H9z'),
};

const UNDO = icon('M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3');
const REDO = icon('M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3');
const ENLARGE = icon('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5');

interface Props {
  background: Background;
  onBackground: (background: Background) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  fullScreen: boolean;
  onFullScreen: () => void;
}

/** The drawing's tools: pens and the eraser, three sizes, the colours, the background, undo and full screen. */
export function DrawingToolbar({ background, onBackground, canUndo, canRedo, onUndo, onRedo, fullScreen, onFullScreen }: Props) {
  const { tool, size, color, setPen } = usePen();
  return (
    <div className="drawing-toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="segmented tools" role="group" aria-label="Tool">
        {TOOLS.map((t) => (
          <button key={t} aria-pressed={tool === t} title={TOOL_LABEL[t]} aria-label={TOOL_LABEL[t]} onClick={() => setPen({ tool: t })}>
            {TOOL_ICON[t]}
          </button>
        ))}
      </div>

      <div className="segmented drawing-sizes" role="group" aria-label="Size">
        {SIZE_LABEL.map((label, i) => (
          <button key={label} aria-pressed={size === i} title={label} aria-label={label} onClick={() => setPen({ size: i as 0 | 1 | 2 })}>
            <span className={`size-dot size-${i}`} aria-hidden />
          </button>
        ))}
      </div>

      <div className="drawing-colors" role="group" aria-label="Colour">
        {INK_COLORS.map((c) => (
          <button
            key={c}
            className={`swatch swatch-${c}`}
            aria-pressed={color === c}
            title={c === 'ink' ? 'Ink' : c[0].toUpperCase() + c.slice(1)}
            aria-label={c === 'ink' ? 'Ink' : c}
            disabled={tool === 'eraser'}
            onClick={() => setPen({ color: c })}
          />
        ))}
      </div>

      <div className="segmented" role="group" aria-label="Background">
        {BACKGROUNDS.map((b) => (
          <button key={b} aria-pressed={background === b} onClick={() => onBackground(b)}>
            {BACKGROUND_LABEL[b]}
          </button>
        ))}
      </div>

      <div className="drawing-actions">
        <button className="quiet" title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
          {UNDO}
        </button>
        <button className="quiet" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
          {REDO}
        </button>
        {fullScreen ? (
          <button className="primary" onClick={onFullScreen}>
            Done
          </button>
        ) : (
          <button className="quiet" title="Full screen" aria-label="Full screen" onClick={onFullScreen}>
            {ENLARGE}
          </button>
        )}
      </div>
    </div>
  );
}
