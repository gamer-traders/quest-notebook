import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '@shared/ipc';

/** The app's menus: the standard ones, so copy and paste work, plus the workspace commands in File. */
export function buildMenu(send: (cmd: MenuCommand) => void): Menu {
  const isMac = process.platform === 'darwin';
  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      { label: 'New Workspace…', accelerator: 'CmdOrCtrl+Shift+N', click: () => send('new-workspace') },
      { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => send('open-workspace') },
      { label: isMac ? 'Show Workspace in Finder' : 'Show Workspace Folder', click: () => send('reveal-workspace') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    file,
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}
