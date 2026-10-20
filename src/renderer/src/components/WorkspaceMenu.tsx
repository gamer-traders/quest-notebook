import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { RecentWorkspace } from '@shared/ipc';
import { useStore } from '../store';
import { openFolder, pickAndOpen, useWorkspaceUi } from '../workspace/session';

/** The workspace's name at the top of the sidebar, and its menu: other workspaces, a new one, a folder, Finder. */
export function WorkspaceMenu() {
  const workspace = useStore((s) => s.workspace);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    void window.quest.workspaces.recent().then(setRecent);
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  useEffect(() => {
    if (open) wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open, recent]);

  const choose = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  };

  const others = recent.filter((w) => w.path !== workspace?.root);

  return (
    <div className="workspace-menu" ref={wrap} onKeyDown={onKeyDown}>
      <button ref={button} className="workspace-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={workspace?.root}>
        <span className="brand">{workspace?.name ?? 'Quest Notebook'}</span>
        <span className="workspace-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="menu workspace-list" role="menu" aria-label="Workspaces">
          {others.length > 0 && <p className="menu-heading">Switch to</p>}
          {others.map((w) => (
            <button key={w.path} role="menuitem" title={w.path} onClick={() => choose(() => void openFolder(w.path))}>
              {w.name}
            </button>
          ))}
          {others.length > 0 && <hr />}
          <button role="menuitem" onClick={() => choose(() => useWorkspaceUi.setState({ screen: 'create' }))}>
            New workspace…
          </button>
          <button role="menuitem" onClick={() => choose(() => void pickAndOpen())}>
            Open folder…
          </button>
          <button role="menuitem" onClick={() => choose(() => void window.quest.workspaces.reveal())}>
            Show in Finder
          </button>
          <button role="menuitem" onClick={() => choose(() => useWorkspaceUi.setState({ screen: 'welcome' }))}>
            All workspaces…
          </button>
        </div>
      )}
    </div>
  );
}
