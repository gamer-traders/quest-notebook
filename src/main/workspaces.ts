import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import type { ClaudeEvent, DiskDelta, OpenResult } from '@shared/ipc';
import { fileExists, locateClaude, loginShellLookup } from './claude/locate';
import { ClaudeService, type ClaudeDeps } from './claude/service';
import { forgetWorkspace, readRegistry, touchWorkspace } from './registry';
import { AdoptDeclined, adoptFolder, createWorkspace } from './workspace/create';
import { WorkspaceSession } from './workspace/session';

export interface WorkspaceHost {
  /** Asks the window to save what it hasn't yet, and waits, up to a few seconds. */
  flushWindow(): Promise<void>;
  diskChanged(delta: DiskDelta): void;
  lost(message: string): void;
  /** The open workspace changed: the window title follows. */
  opened(name: string | null): void;
  trash(abs: string): Promise<void>;
  /** Asks before a folder that already has files in it becomes a workspace. */
  confirmAdopt(root: string): Promise<boolean>;
  /** Something Claude's running turn reports, for the window. */
  claudeEvent(e: ClaudeEvent): void;
}

/** How Claude is found and started. Tests replace these; the app uses the defaults. */
export type ClaudeOptions = Partial<Pick<ClaudeDeps, 'locate' | 'spawn' | 'stopGraceMs'>>;

const locateDefault = () => locateClaude({ shellLookup: () => loginShellLookup(), exists: fileExists, home: homedir() });

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The one open workspace, and switching between workspaces. */
export class Workspaces {
  session: WorkspaceSession | null = null;
  /** Claude in the open workspace. Each workspace gets its own, closed with it. */
  claude: ClaudeService | null = null;
  /** Closed services still writing the record of a turn the close cut short. */
  private closing = new Set<Promise<void>>();
  /** Why the last workspace couldn't be reopened at launch. */
  private launchError: { error: string; path: string } | null = null;

  constructor(
    private readonly registryFile: string,
    private readonly host: WorkspaceHost,
    private readonly claudeOptions: ClaudeOptions = {},
  ) {}

  /** At launch: reopens the workspace used last, if there is one. */
  async openLast(): Promise<void> {
    const { last } = await readRegistry(this.registryFile);
    if (!last) return;
    const result = await this.open(last, false, false);
    if (!result.ok) this.launchError = { error: result.error, path: last };
  }

  /**
   * What a window loading afresh asks first. A turn still running belongs to a window that's gone (a reload): the new
   * one has no record of it, no Stop and no lock, so it's stopped, and ends as "Stopped" in the usual way.
   */
  async current(): Promise<OpenResult | null> {
    this.stopClaude();
    if (this.session) {
      try {
        return { ok: true, snapshot: await this.session.fresh() };
      } catch (error) {
        return { ok: false, error: message(error), path: this.session.root };
      }
    }
    return this.launchError ? { ok: false, ...this.launchError } : null;
  }

  /** Opens a folder as the workspace, saving and closing the one open now first. */
  async open(root: string, flushFirst = true, ask = true): Promise<OpenResult> {
    try {
      const { isNew } = await adoptFolder(root, ask ? (r) => this.host.confirmAdopt(r) : undefined);
      return await this.switchTo(root, isNew, flushFirst);
    } catch (error) {
      if (error instanceof AdoptDeclined) return { ok: false, error: '', path: root, cancelled: true };
      return { ok: false, error: message(error), path: root };
    }
  }

  async create(parentDir: string, name: string): Promise<OpenResult> {
    try {
      const root = await createWorkspace(parentDir, name);
      return await this.switchTo(root, true, true);
    } catch (error) {
      return { ok: false, error: message(error) };
    }
  }

  private async switchTo(root: string, isNew: boolean, flushFirst: boolean): Promise<OpenResult> {
    if (flushFirst) await this.host.flushWindow();
    let claude: ClaudeService | null = null;
    const next = await WorkspaceSession.open(
      root,
      isNew,
      {
        change: (delta) => {
          if (this.session === next) this.host.diskChanged(delta);
        },
        lost: (text) => {
          if (this.session !== next) return;
          this.closeClaude();
          this.session = null;
          this.launchError = { error: text, path: root };
          this.host.opened(null);
          this.host.lost(text);
        },
        fileChanges: (changes) => {
          if (this.session === next) claude?.fileChanges(changes);
        },
        repaired: (files) => {
          if (this.session === next) claude?.repaired(files);
        },
      },
      this.host.trash,
    );
    claude = new ClaudeService(root, next, {
      locate: this.claudeOptions.locate ?? locateDefault,
      spawn: this.claudeOptions.spawn ?? spawn,
      trash: this.host.trash,
      send: (e) => {
        if (this.claude === claude) this.host.claudeEvent(e);
      },
      stopGraceMs: this.claudeOptions.stopGraceMs,
    });
    // The old workspace's turn stops here, before anything of the new one is shown.
    this.closeClaude();
    this.session?.close();
    this.session = next;
    this.claude = claude;
    this.launchError = null;
    await touchWorkspace(this.registryFile, root, next.name, new Date());
    this.host.opened(next.name);
    return { ok: true, snapshot: next.snapshot };
  }

  async recent() {
    return (await readRegistry(this.registryFile)).recent;
  }

  async forget(path: string): Promise<void> {
    await forgetWorkspace(this.registryFile, path);
  }

  /** Stops Claude's running turn, if there is one: the window that showed it is closing. */
  stopClaude(): void {
    void this.claude?.stop();
  }

  /** Claude is answering, or a closed workspace's record of a turn is still being written: quitting should wait. */
  get claudeBusy(): boolean {
    return (this.claude?.running ?? false) || this.closing.size > 0;
  }

  /** Closes Claude in the open workspace, and keeps track of its record write until it's done. */
  private closeClaude(): void {
    const claude = this.claude;
    this.claude = null;
    if (!claude) return;
    const closing = claude.close();
    this.closing.add(closing);
    void closing.finally(() => this.closing.delete(closing));
  }

  /** Closes the open workspace. Resolves once every record of a turn a close cut short is written (or failed to be). */
  close(): Promise<void> {
    this.closeClaude();
    this.session?.close();
    this.session = null;
    return Promise.all([...this.closing]).then(() => {});
  }
}
