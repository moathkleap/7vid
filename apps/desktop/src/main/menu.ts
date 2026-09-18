import { app, Menu, type MenuItemConstructorOptions } from 'electron';

export function buildMenu(opts: { isDev: boolean; openExternal: (url: string) => void }): Menu {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'hide' as const }, { role: 'quit' as const }] }] : []),
    {
      label: 'File',
      submenu: [{ role: 'close' }, ...(isMac ? [] : [{ role: 'quit' as const }])],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        ...(opts.isDev ? [{ role: 'reload' as const }, { role: 'forceReload' as const }, { role: 'toggleDevTools' as const }, { type: 'separator' as const }] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [{ role: 'close' as const }])] },
    { role: 'help', submenu: [{ label: 'Project on GitHub', click: () => opts.openExternal('https://github.com/moathkleap/7vid') }] },
  ];
  return Menu.buildFromTemplate(template);
}
