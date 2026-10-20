import { useEffect, useRef, useState } from 'react';
import type { Appearance } from '../lib/appearance';
import { useStore } from '../store';

type ShortcutKeys = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/** Cmd+, on a Mac, Ctrl+, elsewhere. The comma is also known by its key, for layouts that type another letter there. */
export function isSettingsShortcut(e: ShortcutKeys, mac: boolean): boolean {
  const command = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return command && !e.altKey && !e.shiftKey && (e.key === ',' || e.code === 'Comma');
}

export const settingsShortcutLabel = (mac: boolean) => (mac ? '⌘,' : 'Ctrl+,');

interface Row<K extends keyof Appearance> {
  key: K;
  label: string;
  hint: string;
  /** `className` lets an option show what it does: Serif in the serif, Small small. */
  options: { value: Appearance[K]; label: string; className?: string }[];
}

type AnyRow = { [K in keyof Appearance]: Row<K> }[keyof Appearance];

const ROWS: AnyRow[] = [
  {
    key: 'theme',
    label: 'Theme',
    hint: 'System follows your computer',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'system', label: 'System' },
    ],
  },
  {
    key: 'density',
    label: 'Density',
    hint: 'Spacing in the sidebar, pages and toolbars',
    options: [
      { value: 'compact', label: 'Compact' },
      { value: 'default', label: 'Default' },
      { value: 'comfortable', label: 'Comfortable' },
    ],
  },
  {
    key: 'textSize',
    label: 'Text size',
    hint: 'Writing on pages',
    options: [
      { value: 'small', label: 'Small', className: 'option-small' },
      { value: 'default', label: 'Default' },
      { value: 'large', label: 'Large', className: 'option-large' },
    ],
  },
  {
    key: 'pageWidth',
    label: 'Page width',
    hint: 'Wider pages give charts more room',
    options: [
      { value: 'narrow', label: 'Narrow' },
      { value: 'default', label: 'Default' },
      { value: 'full', label: 'Full width' },
    ],
  },
  {
    key: 'noteFont',
    label: 'Note font',
    hint: 'For page text',
    options: [
      { value: 'serif', label: 'Serif', className: 'option-serif' },
      { value: 'sans', label: 'Sans' },
    ],
  },
];

function SettingRow({ row, value }: { row: AnyRow; value: Appearance[keyof Appearance] }) {
  const id = `setting-${row.key}`;
  return (
    <div className="settings-row">
      <div>
        <span id={id} className="settings-name">
          {row.label}
        </span>
        <span id={`${id}-hint`} className="settings-hint">
          {row.hint}
        </span>
      </div>
      <div className="segmented" role="group" aria-labelledby={id} aria-describedby={`${id}-hint`}>
        {row.options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.className}
            aria-pressed={option.value === value}
            onClick={() => useStore.getState().setAppearance({ [row.key]: option.value } as Partial<Appearance>)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface Opener {
  el: Element | null;
  /** The caret or selection in it, when it's a page being written. */
  range: Range | null;
}

/**
 * What takes focus back when Settings closes. The ⚙ button passes itself, since Safari and Firefox
 * on a Mac don't focus a clicked button. The shortcut passes nothing: whatever has focus opened it,
 * and in a page the caret is kept too.
 */
export function settingsOpener(trigger: Element | null): Opener {
  if (trigger) return { el: trigger, range: null };
  const el = document.activeElement;
  const selection = document.getSelection();
  const inside = el && selection && selection.rangeCount > 0 && el.contains(selection.anchorNode);
  return { el, range: inside ? selection.getRangeAt(0).cloneRange() : null };
}

/** A press lands on the backdrop when it hits the dialog element itself, outside its box. */
export function onBackdrop(dialog: Element, e: { target: EventTarget | null; clientX: number; clientY: number }): boolean {
  if (e.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  return e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
}

/** Focus goes back, and in a page the caret goes back where it was rather than to the page's start. */
function returnFocus({ el, range }: Opener) {
  if (!(el instanceof HTMLElement) || !el.isConnected) return;
  el.focus({ preventScroll: true });
  if (range && el.contains(range.startContainer)) {
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}

/**
 * Settings, opened from the sidebar or with Cmd+,. Choices apply at once; there's nothing to save.
 * `trigger` is the button that opened it; without one, focus goes back to what had it.
 */
export function SettingsDialog({ trigger, onClose }: { trigger: Element | null; onClose: () => void }) {
  const appearance = useStore((s) => s.appearance);
  const dialog = useRef<HTMLDialogElement>(null);
  const [opener] = useState(() => settingsOpener(trigger));
  // A drag that starts inside and ends on the backdrop isn't a backdrop click.
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  // Esc, the backdrop and Close all end here, through the dialog's own close.
  const onDialogClose = () => {
    returnFocus(opener);
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onClose={onDialogClose}
      onPointerDown={(e) => (pressedBackdrop.current = onBackdrop(e.currentTarget, e))}
      onClick={(e) => {
        if (pressedBackdrop.current && onBackdrop(e.currentTarget, e)) e.currentTarget.close();
        pressedBackdrop.current = false;
      }}
    >
      <nav className="settings-nav" aria-label="Settings sections">
        <h2 id="settings-title" className="settings-title">
          Settings
        </h2>
        <ul className="settings-sections">
          <li className="settings-section is-current" aria-current="true">
            Appearance
          </li>
        </ul>
        {/* Phones have no Esc key, and no backdrop to tap once Settings fills the screen. */}
        <button type="button" className="quiet settings-close" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </nav>

      <section className="settings-body" aria-labelledby="settings-appearance">
        <header className="settings-head">
          <h3 id="settings-appearance">Appearance</h3>
          <span className="settings-esc">Esc to close</span>
        </header>

        {ROWS.map((row) => (
          <SettingRow key={row.key} row={row} value={appearance[row.key]} />
        ))}

        <footer className="settings-foot">
          <span className="muted">Saved in this browser</span>
          <button type="button" onClick={() => useStore.getState().resetAppearance()}>
            Reset to defaults
          </button>
        </footer>
      </section>
    </dialog>
  );
}
