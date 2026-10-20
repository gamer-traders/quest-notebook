import { useEffect, useState } from 'react';
import type { RecentWorkspace } from '@shared/ipc';
import { safeName } from '@shared/names';
import { useStore } from '../store';
import { createAndOpen, openFolder, pickAndOpen, useWorkspaceUi } from '../workspace/session';
import { shortPath } from '../workspace/shortPath';

const goTo = (screen: 'app' | 'welcome' | 'create') => useWorkspaceUi.setState({ screen });

/** Where a new workspace starts: its name, the folder it goes in, and whether it starts with the sample pages. */
function CreateForm() {
  const [name, setName] = useState('My Quest');
  const [parent, setParent] = useState('');
  const [samples, setSamples] = useState(true);
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    const picked = await window.quest.workspaces.pickFolder('Choose where the workspace folder goes');
    if (picked) setParent(picked);
  };

  const create = async () => {
    setBusy(true);
    try {
      await createAndOpen(parent, name.trim() || 'My Quest', samples);
    } finally {
      setBusy(false);
    }
  };

  const ready = parent !== '' && name.trim() !== '' && !busy;
  return (
    <form
      className="welcome-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void create();
      }}
    >
      <h2>New workspace</h2>
      <label className="welcome-field">
        <span>Name</span>
        <input value={name} autoFocus onChange={(e) => setName(e.target.value)} aria-label="Workspace name" />
      </label>
      <div className="welcome-field">
        <span>Location</span>
        <div className="welcome-location">
          <span className={parent ? 'welcome-path' : 'welcome-path muted'}>{parent ? shortPath(parent) : 'No folder chosen yet'}</span>
          <button type="button" onClick={() => void choose()}>
            Choose…
          </button>
        </div>
      </div>
      {parent && (
        <p className="muted">
          Pages are saved in <span className="welcome-path">{shortPath(`${parent}/${safeName(name)}`)}</span>
        </p>
      )}
      <label className="welcome-check">
        <input type="checkbox" checked={samples} onChange={(e) => setSamples(e.target.checked)} />
        Start with sample pages
      </label>
      <div className="welcome-actions">
        <button type="submit" className="primary" disabled={!ready}>
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
        <button type="button" className="quiet" onClick={() => goTo('welcome')}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The first screen when no workspace is open, and the place to switch: make a workspace, open a folder,
 * or pick one used before.
 */
export function Welcome() {
  const screen = useWorkspaceUi((s) => s.screen);
  const error = useWorkspaceUi((s) => s.error);
  const workspace = useStore((s) => s.workspace);
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);

  useEffect(() => {
    void window.quest.workspaces.recent().then(setRecent);
  }, [screen, workspace?.root]);

  const forget = async (path: string) => {
    await window.quest.workspaces.forget(path);
    setRecent(await window.quest.workspaces.recent());
  };

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1 className="welcome-brand">Quest Notebook</h1>
        <p className="welcome-lede">A trading notebook whose pages are files in a folder you choose, plain enough for you, or an AI, to read and edit.</p>
        {error && (
          <p className="welcome-error" role="alert">
            {error}
          </p>
        )}

        {screen === 'create' ? (
          <CreateForm />
        ) : (
          <>
            <div className="welcome-actions">
              <button className="primary" onClick={() => goTo('create')}>
                Create a new workspace
              </button>
              <button onClick={() => void pickAndOpen()}>Open a folder</button>
            </div>

            {recent.length > 0 && (
              <section className="welcome-recent" aria-label="Recent workspaces">
                <h2>Recent</h2>
                <ul>
                  {recent.map((w) => {
                    const isOpen = w.path === workspace?.root;
                    return (
                      <li key={w.path}>
                        <button className="welcome-open" onClick={() => (isOpen ? goTo('app') : void openFolder(w.path))}>
                          <span className="welcome-name">
                            {w.name}
                            {isOpen && <span className="welcome-badge">Open</span>}
                          </span>
                          <span className="welcome-path muted">{shortPath(w.path)}</span>
                        </button>
                        <button className="quiet welcome-forget" aria-label={`Remove ${w.name} from this list`} title="Remove from this list. The folder stays as it is." onClick={() => void forget(w.path)}>
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {workspace && (
              <button className="quiet welcome-back" onClick={() => goTo('app')}>
                ← Back to {workspace.name}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
