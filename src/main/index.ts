import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron';
import { EMBED_SCHEME } from '@shared/embedUrl';
import { embedResponse } from './embedProtocol';
import { registerIpc } from './ipc';
import { buildMenu } from './menu';
import { Workspaces } from './workspaces';

const PRODUCT = 'Quest Notebook';

// HTML in an embed block loads from an address of its own, as a web page does. It has to be named before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: EMBED_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let win: BrowserWindow | null = null;
let quitting = false;

const getWindow = () => (win && !win.isDestroyed() ? win : null);
const send = (channel: string, ...args: unknown[]) => getWindow()?.webContents.send(channel, ...args);

/** Asks the window to save what it hasn't yet, and waits for it, or for three seconds at most. */
function flushWindow(): Promise<void> {
  const target = getWindow();
  if (!target) return Promise.resolve();
  const nonce = randomUUID();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      ipcMain.removeListener('app:flushed', onFlushed);
      resolve();
    };
    const onFlushed = (_e: unknown, n: unknown) => n === nonce && finish();
    const timer = setTimeout(finish, 3000);
    ipcMain.on('app:flushed', onFlushed);
    target.webContents.send('app:flush-request', nonce);
  });
}

const workspaces = new Workspaces(join(app.getPath('userData'), 'workspaces.json'), {
  flushWindow,
  diskChanged: (delta) => send('workspace:disk-change', delta),
  lost: (message) => send('workspace:lost', message),
  opened: (name) => getWindow()?.setTitle(name ? `${name} — ${PRODUCT}` : PRODUCT),
  trash: (abs) => shell.trashItem(abs),
  claudeEvent: (e) => send('claude:event', e),
  confirmAdopt: async (root) => {
    const options = {
      type: 'question' as const,
      buttons: ['Open as Workspace', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Open “${basename(root)}” as a workspace?`,
      detail:
        'This folder already has files in it. Quest Notebook will show each folder in it as a space and each page file as a page, and will add a page file for any folder that has none. Other files are left alone.',
    };
    const target = getWindow();
    const { response } = target ? await dialog.showMessageBox(target, options) : await dialog.showMessageBox(options);
    return response === 0;
  },
});

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 500,
    title: workspaces.session ? `${workspaces.session.name} — ${PRODUCT}` : PRODUCT,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  created.once('ready-to-show', () => created.show());
  // The page's own <title> would replace the workspace name.
  created.on('page-title-updated', (e) => e.preventDefault());

  // Web links open in the browser. The window itself never leaves the app.
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // The app is one page and never navigates: a dropped file or a stray link would replace it.
  created.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  // Closing waits for the last edits to be saved.
  let saved = false;
  created.on('close', (e) => {
    if (saved) return;
    // macOS keeps the app running without a window: a turn mustn't go on unseen.
    workspaces.stopClaude();
    e.preventDefault();
    void flushWindow().finally(() => {
      saved = true;
      created.destroy();
      if (quitting) app.quit();
    });
  });

  if (process.env.ELECTRON_RENDERER_URL) void created.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void created.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return created;
}

void app.whenReady().then(async () => {
  app.setName(PRODUCT);
  protocol.handle(EMBED_SCHEME, (request) => embedResponse(request.url));
  registerIpc(workspaces, getWindow);
  Menu.setApplicationMenu(buildMenu((cmd) => send('app:menu', cmd)));
  await workspaces.openLast();
  win = createWindow();
  app.on('activate', () => {
    if (!getWindow()) win = createWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
});

/** How long quitting waits for the record of a turn it cut short. */
const QUIT_WAIT_MS = 3000;
/** Set once quitting waits for Claude's record: the app then exits by itself. */
let exiting = false;

// Whatever way the app quits, the claude child is stopped (closing twice is harmless). Electron doesn't wait for async
// work after will-quit, so while a turn runs (or a closed one's record is still being written) quitting waits for the
// record of the reply so far, a few seconds at most, then exits.
app.on('will-quit', (e) => {
  if (exiting) {
    e.preventDefault();
    return;
  }
  if (!workspaces.claudeBusy) {
    void workspaces.close();
    return;
  }
  e.preventDefault();
  exiting = true;
  const limit = new Promise<void>((resolve) => setTimeout(resolve, QUIT_WAIT_MS));
  void Promise.race([workspaces.close(), limit]).finally(() => app.exit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || quitting) {
    void workspaces.close();
    app.quit();
  }
});
