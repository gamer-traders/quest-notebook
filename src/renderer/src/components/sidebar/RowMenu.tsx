import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Shown but not choosable, with `hint` saying why. */
  disabled?: boolean;
  hint?: string;
  danger?: boolean;
}

/**
 * The ⋯ button on a page row or a space header, and its menu. The menu closes on a choice, on Escape,
 * and on a press anywhere outside it.
 */
export function RowMenu({ label, items, onOpenChange }: { label: string; items: MenuItem[]; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const show = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) show(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      show(false);
      button.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const choices = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
      const at = choices.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      choices[(at + step + choices.length) % choices.length]?.focus();
    } else if (e.key === 'Tab') {
      show(false);
    }
  };

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    show(false);
    item.onSelect();
    // A choice that doesn't take focus somewhere else hands it back to the ⋯ button.
    requestAnimationFrame(() => {
      if (document.activeElement === document.body && button.current?.isConnected) button.current.focus();
    });
  };

  return (
    <span className="row-menu" ref={wrap} onKeyDown={onKeyDown}>
      <button ref={button} className="row-tool" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => show(!open)}>
        ⋯
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={item.danger ? 'danger' : undefined}
              aria-disabled={item.disabled || undefined}
              title={item.hint}
              onClick={() => choose(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
