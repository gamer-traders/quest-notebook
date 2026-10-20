import { useEffect, useRef, useState } from 'react';

/** How a rename ended: from the keyboard, which hands focus back to the row, or by clicking away. */
export type RenameEnd = 'key' | 'blur';

/**
 * A name edited in place. Enter or clicking away keeps it, Escape puts it back.
 * `onDone` gets the new text, or null when nothing should change.
 */
export function InlineRename({ value, label, onDone }: { value: string; label: string; onDone: (next: string | null, end: RenameEnd) => void }) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const finish = (next: string | null, end: RenameEnd) => {
    if (finished.current) return;
    finished.current = true;
    onDone(next === value ? null : next, end);
  };

  return (
    <input
      ref={input}
      className="inline-rename"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(text, 'key');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(null, 'key');
        }
      }}
      onBlur={() => finish(text, 'blur')}
    />
  );
}
