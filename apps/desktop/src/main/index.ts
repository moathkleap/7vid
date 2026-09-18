import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, net, protocol, session, shell } from 'electron';
import { pathToFileURL } from 'node:url';
import { AppError, createEngine, type Engine } from '@sevenvid/engine';
import { createElectronHost } from './host';
import { buildMenu } from './menu';

// node:sqlite is stable enough for our use but still flagged experimental in Node 22.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w);
});

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let engine: Engine | null = null;

protocol.registerSchemesAsPrivileged([{ scheme: 'sevenvid-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } }]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function resourcesDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.resolve(__dirname, '../../../../resources');
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0c10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => (mainWindow = null));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void engine?.invoke('shell.openExternal', { url }).catch(() => undefined);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) e.preventDefault();
  });
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function installCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; script-src 'self' 'unsafe-inline' http://localhost:* http://127.0.0.1:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file: sevenvid-media:; media-src 'self' blob: file: sevenvid-media:; font-src 'self' data:; connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: sevenvid-media:; media-src 'self' blob: sevenvid-media:; font-src 'self' data:; connect-src 'self'";
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
}

/** Serves local media the engine allows (assets and derived cache files) with Range support via net.fetch. */
function installMediaProtocol(e: Engine): void {
  protocol.handle('sevenvid-media', (request) => {
    const url = new URL(request.url);
    const file = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const abs = process.platform === 'win32' ? file : `/${file.replace(/^\/+/, '')}`;
    if (!e.media.isPathAllowed(abs)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(abs).toString(), { headers: request.headers });
  });
}

function wireIpc(e: Engine): void {
  ipcMain.handle('sevenvid:api', async (_event, channel: string, input: unknown) => {
    try {
      const data = await e.invoke(channel as never, input as never);
      return { ok: true, data: data ?? null };
    } catch (err) {
      return { ok: false, error: AppError.from(err, { code: 'UNKNOWN', operation: channel }).info };
    }
  });
  e.bus.onAny((event, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(`sevenvid:event:${event}`, payload);
    }
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.sevenvid.app');
  engine = createEngine({
    host: createElectronHost(() => mainWindow, isDev),
    paths: { userData: process.env.SEVENVID_USER_DATA ?? app.getPath('userData'), resources: resourcesDir() },
    logToConsole: isDev,
  });
  wireIpc(engine);
  installMediaProtocol(engine);
  installCsp();
  Menu.setApplicationMenu(buildMenu({ isDev, openExternal: (url) => void engine?.invoke('shell.openExternal', { url }) }));
  await engine.start();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

let disposing = false;
app.on('before-quit', (e) => {
  if (!engine || disposing) return;
  e.preventDefault();
  disposing = true;
  engine
    .dispose()
    .catch(() => undefined)
    .finally(() => {
      engine = null;
      app.quit();
    });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

void shell;
