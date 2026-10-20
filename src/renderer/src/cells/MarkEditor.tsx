import type { Level, MarkColor, MarkLine, MarkWidth, Pin, TextLabel, Trend } from '../types';
import { MARK_COLORS } from '../chart/palette';

export type MarkTarget =
  | { kind: 'level'; mark: Level }
  | { kind: 'trend'; mark: Trend }
  | { kind: 'pin'; mark: Pin }
  | { kind: 'text'; mark: TextLabel };

interface Props {
  target: MarkTarget;
  title: string;
  onChange: (patch: Partial<Level & Trend & Pin & TextLabel>) => void;
  onDelete: () => void;
  onClose: () => void;
}

const COLOR_NAME: Record<MarkColor, string> = {
  yellow: 'Yellow',
  blue: 'Blue',
  green: 'Green',
  red: 'Red',
  purple: 'Purple',
  gray: 'Gray',
};

const LINES: { id: MarkLine; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dotted', label: 'Dotted' },
];

const WIDTHS: { id: MarkWidth; label: string }[] = [
  { id: 'thin', label: 'Thin' },
  { id: 'normal', label: 'Normal' },
  { id: 'thick', label: 'Thick' },
];

/** The bar that opens when you select a mark: colour, line style and width, and what it says. */
export function MarkEditor({ target, title, onChange, onDelete, onClose }: Props) {
  const { kind, mark } = target;
  const color = mark.color ?? 'yellow';
  const isLine = kind === 'level' || kind === 'trend';
  const line = isLine ? (mark.line ?? 'solid') : 'solid';
  const width = isLine ? (mark.width ?? 'normal') : 'normal';

  return (
    <div className="mark-editor" role="group" aria-label={`Edit ${title}`}>
      <div className="mark-editor-row">
        <strong>{title}</strong>
        <div className="swatches" role="radiogroup" aria-label="Color">
          {MARK_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={c === color}
              aria-label={COLOR_NAME[c]}
              title={COLOR_NAME[c]}
              className={`swatch swatch-${c}`}
              onClick={() => onChange({ color: c })}
            />
          ))}
        </div>
        {isLine && (
          <>
            <div className="segmented" role="group" aria-label="Line style">
              {LINES.map((l) => (
                <button key={l.id} aria-pressed={l.id === line} onClick={() => onChange({ line: l.id })}>
                  {l.label}
                </button>
              ))}
            </div>
            <div className="segmented" role="group" aria-label="Line width">
              {WIDTHS.map((w) => (
                <button key={w.id} aria-pressed={w.id === width} onClick={() => onChange({ width: w.id })}>
                  {w.label}
                </button>
              ))}
            </div>
          </>
        )}
        <span className="mark-editor-end">
          <button className="quiet danger" onClick={onDelete}>
            Delete
          </button>
          <button className="quiet" onClick={onClose}>
            Done
          </button>
        </span>
      </div>
      {isLine ? (
        <textarea
          className="mark-note"
          rows={2}
          value={mark.note ?? ''}
          placeholder="Add a note. It shows when you point at the line."
          aria-label="Note"
          onChange={(e) => onChange({ note: e.target.value })}
        />
      ) : (
        <input
          className="mark-note"
          value={mark.text}
          aria-label={kind === 'pin' ? 'Note' : 'Label text'}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      )}
    </div>
  );
}
