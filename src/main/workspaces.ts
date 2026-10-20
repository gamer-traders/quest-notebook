import type { DiskDelta, OpenResult } from '@shared/ipc';
import { forgetWorkspace, readRegistry, touchWorkspace } from './registry';
import { adoptFolder, createWorkspace } from './workspace/create';
import { WorkspaceSession } from './workspace/session';

export interface WorkspaceHost {
  /** Asks the window to save what it hasn't yet, and waits, up to a few seconds. */
  flushWindow(): Promise<void>;
  diskChanged(delta: DiskDelta): void;
  lost(message: string): void;
  /** The open workspace changed: the window title follows. */
  opened(name: string | null): void;
  trash(abs: string): Promise<void>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The one open workspace, and switching between workspaces. */
export class Workspaces {
  session: WorkspaceSession | null = null;
  /** Why the last workspace couldn't be reopened at launch. */
  private launchError: { error: string; path: string } | null = null;

  constructor(
    private readonly registryFile: string,
    private readonly host: WorkspaceHost,
  ) {}

  /** At launch: reopens the workspace used last, if there is one. */
  async openLast(): Promise<void> {
    const { last } = await readRegistry(this.registryFile);
    if (!last) return;
    const result = await this.open(last, false);
    if (!result.ok) this.launchError = { error: result.error, path: last };
  }

  async current(): Promise<OpenResult | null> {
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
  async open(root: string, flushFirst = true): Promise<OpenResult> {
    try {
      const { isNew } = await adoptFolder(root);
      return await this.switchTo(root, isNew, flushFirst);
    } catch (error) {
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
    const next = await WorkspaceSession.open(
      root,
      isNew,
      {
        change: (delta) => {
          if (this.session === next) this.host.diskChanged(delta);
        },
        lost: (text) => {
          if (this.session !== next) return;
          this.session = null;
          this.launchError = { error: text, path: root };
          this.host.opened(null);
          this.host.lost(text);
        },
      },
      this.host.trash,
    );
    this.session?.close();
    this.session = next;
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

  close(): void {
    this.session?.close();
    this.session = null;
  }
}
