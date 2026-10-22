import { dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import type { FlushBatch, UiState } from '@shared/ipc';
import { parseSendRequest, parseUndoArgs } from './claude/service';
import type { Workspaces } from './workspaces';

const isWebLink = (url: unknown): url is string => typeof url === 'string' && /^https?:\/\//i.test(url);

/** Answers the window's `window.quest` calls. Channel names match src/preload/index.ts. */
export function registerIpc(workspaces: Workspaces, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('workspaces:current', () => workspaces.current());
  ipcMain.handle('workspaces:recent', () => workspaces.recent());
  ipcMain.handle('workspaces:pick', async (_e, title: string) => {
    // For automated end-to-end runs, which can't click a system dialog: the picker answers with this folder.
    if (process.env.QUEST_PICK_FOLDER) return process.env.QUEST_PICK_FOLDER;
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
  ipcMain.handle('workspace:ui', (_e, ui: UiState, root?: string) => workspaces.session?.saveUi(ui, root));
  ipcMain.handle('app:open-external', async (_e, url: unknown) => {
    if (isWebLink(url)) await shell.openExternal(url);
  });

  // Claude in the open workspace. Every argument from the window is checked here; claude:event goes out from index.ts.
  ipcMain.handle('claude:status', () => workspaces.claude?.status() ?? { state: 'error', message: 'No workspace is open' });
  ipcMain.handle('claude:send', (_e, req: unknown) => {
    const parsed = parseSendRequest(req);
    if ('error' in parsed) return parsed;
    return workspaces.claude?.send(parsed) ?? { error: 'No workspace is open' };
  });
  ipcMain.handle('claude:stop', () => workspaces.claude?.stop());
  ipcMain.handle('claude:list', () => workspaces.claude?.listChats() ?? []);
  ipcMain.handle('claude:read', (_e, id: unknown) => (typeof id === 'string' ? (workspaces.claude?.readChat(id) ?? null) : null));
  ipcMain.handle('claude:delete', async (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Bad request');
    if (!workspaces.claude) throw new Error('No workspace is open');
    await workspaces.claude.deleteChat(id);
  });
  ipcMain.handle('claude:image', (_e, chatId: unknown, file: unknown) =>
    typeof chatId === 'string' && typeof file === 'string' ? (workspaces.claude?.image(chatId, file) ?? null) : null,
  );
  ipcMain.handle('claude:undo', async (_e, ...args: unknown[]) => {
    const parsed = parseUndoArgs(args);
    if (!parsed) throw new Error('Bad request');
    if (!workspaces.claude) throw new Error('No workspace is open');
    return workspaces.claude.undo(parsed.chatId, parsed.messageId, parsed.paths, parsed.force);
  });
}
