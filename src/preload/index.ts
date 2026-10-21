import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ClaudeEvent, DiskDelta, MenuCommand, QuestApi } from '@shared/ipc';

/** Listens on a channel; returns a function that stops listening. */
function listen<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Main asks before closing the window or switching workspace. Without a page to save, the answer comes at once.
let flushHandler: (() => Promise<void>) | null = null;
ipcRenderer.on('app:flush-request', async (_e, nonce: string) => {
  try {
    await flushHandler?.();
  } catch (error) {
    console.error('Saving before closing failed:', error);
  } finally {
    ipcRenderer.send('app:flushed', nonce);
  }
});

const api: QuestApi = {
  workspaces: {
    current: () => ipcRenderer.invoke('workspaces:current'),
    recent: () => ipcRenderer.invoke('workspaces:recent'),
    pickFolder: (title) => ipcRenderer.invoke('workspaces:pick', title),
    create: (parentDir, name) => ipcRenderer.invoke('workspaces:create', parentDir, name),
    open: (path) => ipcRenderer.invoke('workspaces:open', path),
    forget: (path) => ipcRenderer.invoke('workspaces:forget', path),
    reveal: () => ipcRenderer.invoke('workspaces:reveal'),
  },
  workspace: {
    flush: (batch) => ipcRenderer.invoke('workspace:flush', batch),
    saveUi: (ui, root) => ipcRenderer.invoke('workspace:ui', ui, root),
    onDiskChange: (cb) => listen<DiskDelta>('workspace:disk-change', cb),
    onLost: (cb) => listen<string>('workspace:lost', cb),
  },
  app: {
    onFlushRequest: (cb) => {
      flushHandler = cb;
      return () => {
        if (flushHandler === cb) flushHandler = null;
      };
    },
    onMenu: (cb) => listen<MenuCommand>('app:menu', cb),
    openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  },
  claude: {
    status: () => ipcRenderer.invoke('claude:status'),
    send: (req) => ipcRenderer.invoke('claude:send', req),
    stop: () => ipcRenderer.invoke('claude:stop'),
    onEvent: (cb) => listen<ClaudeEvent>('claude:event', cb),
    listChats: () => ipcRenderer.invoke('claude:list'),
    readChat: (id) => ipcRenderer.invoke('claude:read', id),
    deleteChat: (id) => ipcRenderer.invoke('claude:delete', id),
    undo: (chatId, messageId, paths, force) => ipcRenderer.invoke('claude:undo', chatId, messageId, paths, force),
  },
};

contextBridge.exposeInMainWorld('quest', api);
