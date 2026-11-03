import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { NotebookView } from './components/NotebookView';
import { ReviewView } from './components/ReviewView';
import { IS_MAC, SettingsDialog, isSettingsShortcut } from './components/SettingsDialog';
import { SaveWarning } from './components/SaveWarning';
import { DiskNotice } from './components/DiskNotice';
import { Welcome } from './components/Welcome';
import { useWorkspaceUi } from './workspace/session';
import { MarkdownView } from './markdown/MarkdownView';
import { isMarkdownId } from './markdown/model';

export function App() {
  const view = useStore((s) => s.view);
  const openMarkdown = useStore((s) => (isMarkdownId(s.activeId) ? (s.markdown.find((m) => m.id === s.activeId) ?? null) : null));
  const workspace = useStore((s) => s.workspace);
  const screen = useWorkspaceUi((s) => s.screen);
  const [navOpen, setNavOpen] = useState(false);
  // Open Settings, and the button that opened it: none for the shortcut.
  const [settings, setSettings] = useState<{ trigger: Element | null } | null>(null);

  // The page path's space part asks for the sidebar, which only needs opening on phones.
  useEffect(() => {
    const open = () => setNavOpen(true);
    window.addEventListener('open-nav', open);
    return () => window.removeEventListener('open-nav', open);
  }, []);

  // Cmd+, opens Settings from anywhere. It's caught on the way down, before the page editor can take it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSettingsShortcut(e, IS_MAC)) return;
      e.preventDefault();
      e.stopPropagation();
      setSettings((open) => open ?? { trigger: null });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Nothing shows for the moment it takes main to say which workspace is open, so the welcome screen doesn't flash.
  if (screen === 'loading') return <div className="app-loading" />;
  if (!workspace || screen !== 'app') return <Welcome />;

  return (
    <div className={`app${navOpen ? ' nav-open' : ''}`}>
      <div className="topbar">
        <button className="quiet" aria-expanded={navOpen} onClick={() => setNavOpen((o) => !o)}>
          {navOpen ? 'Close' : 'Notebooks'}
        </button>
        <span className="brand">{workspace.name}</span>
      </div>
      <Sidebar onNavigate={() => setNavOpen(false)} onOpenSettings={(trigger) => setSettings({ trigger })} />
      <main className="main">
        <SaveWarning />
        <DiskNotice />
        {view === 'review' ? <ReviewView /> : openMarkdown ? <MarkdownView key={openMarkdown.id} file={openMarkdown} /> : <NotebookView />}
      </main>
      {settings && <SettingsDialog trigger={settings.trigger} onClose={() => setSettings(null)} />}
    </div>
  );
}
