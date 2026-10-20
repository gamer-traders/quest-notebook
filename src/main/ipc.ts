import { dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import type { FlushBatch, UiState } from '@shared/ipc';
import type { Workspaces } from './workspaces';

const isWebLink = (url: unknown): url is string => typeof url === 'string' && /^https?:\/\//i.test(url);

/** Answers the window's `window.quest` calls. Channel names match src/preload/index.ts. */
export function registerIpc(workspaces: Workspaces, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('workspaces:current', () => workspaces.current());
  ipcMain.handle('workspaces:recent', () => workspaces.recent());
  ipcMain.handle('workspaces:pick', async (_e, title: string) => {
    const win = getWindow();
    const options = { title: String(title ?? ''), message: String(title ?? ''), properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle('workspaces:create', (_e, parentDir: string, name: string) => workspaces.create(String(parentDir), String(name)));
  ipcMain.handle('workspaces:open', (_e, path: string) => workspaces.open(String(path)));
  ipcMain.handle('workspaces:forget', (_e, path: string) => workspaces.forget(String(path)));
  ipcMain.handle('workspaces:reveal', async () => {
    if (workspaces.session) await shell.openPath(workspaces.session.root);
  });
  ipcMain.handle('workspace:flush', (_e, batch: FlushBatch) =>
    workspaces.session ? workspaces.session.flush(batch) : { ok: false, error: 'No workspace is open', paths: {} },
  );
  ipcMain.handle('workspace:ui', (_e, ui: UiState) => workspaces.session?.saveUi(ui));
  ipcMain.handle('app:open-external', async (_e, url: unknown) => {
    if (isWebLink(url)) await shell.openExternal(url);
  });
}
