import { execFile } from 'node:child_process';
import path from 'node:path';
import type { EngineHost } from '../api/host';

/** Host services for browser mode: no native dialogs (the UI uses the in-app file browser instead). */
export function createBrowserHost(opts: { appVersion: string; isDev?: boolean; onQuit?: () => void; mediaUrl?: (path: string) => string | null }): EngineHost {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  return {
    mode: 'browser',
    appVersion: opts.appVersion,
    electronVersion: null,
    isDev: opts.isDev ?? true,
    dialogs: {
      pickFiles: async () => ({ paths: [], native: false }),
      pickDirectory: async () => ({ path: null, native: false }),
      saveFile: async () => ({ path: null, native: false }),
    },
    shell: {
      openPath: (p) => new Promise((resolve) => execFile(opener, [p], (err) => resolve(err ? err.message : ''))),
      showInFolder: (p) => {
        execFile(opener, [path.dirname(p)], () => undefined);
      },
      openExternal: (url) => new Promise((resolve) => execFile(opener, [url], () => resolve())),
    },
    quit: () => opts.onQuit?.(),
    mediaUrl: (p) => opts.mediaUrl?.(p) ?? null,
  };
}
