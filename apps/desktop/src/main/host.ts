import { dialog, shell, app, type BrowserWindow } from 'electron';
import type { EngineHost } from '@sevenvid/engine';

const FILTERS = {
  video: { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mts', 'm2ts', 'ts', 'wmv', 'flv', '3gp', 'mpg', 'mpeg', 'mxf'] },
  image: { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'avif'] },
  audio: { name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'wma', 'aiff', 'aif'] },
  subtitle: { name: 'Subtitles', extensions: ['srt', 'vtt', 'ass'] },
};

export function createElectronHost(getWindow: () => BrowserWindow | null, isDev: boolean): EngineHost {
  return {
    mode: 'electron',
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? null,
    isDev,
    dialogs: {
      async pickFiles(opts) {
        const win = getWindow();
        const filters =
          opts.kind === 'media'
            ? [{ name: 'Media', extensions: [...FILTERS.video.extensions, ...FILTERS.image.extensions, ...FILTERS.audio.extensions] }, FILTERS.video, FILTERS.image, FILTERS.audio]
            : opts.kind === 'any'
              ? [{ name: 'All files', extensions: ['*'] }]
              : [FILTERS[opts.kind]];
        const r = await dialog.showOpenDialog(win ?? undefined!, { title: opts.title, filters, properties: opts.multiple === false ? ['openFile'] : ['openFile', 'multiSelections'] });
        return { paths: r.canceled ? [] : r.filePaths, native: true };
      },
      async pickDirectory(opts) {
        const win = getWindow();
        const r = await dialog.showOpenDialog(win ?? undefined!, { title: opts.title, properties: ['openDirectory', 'createDirectory'] });
        return { path: r.canceled ? null : (r.filePaths[0] ?? null), native: true };
      },
      async saveFile(opts) {
        const win = getWindow();
        const r = await dialog.showSaveDialog(win ?? undefined!, { defaultPath: opts.defaultPath, filters: opts.filters });
        return { path: r.canceled ? null : (r.filePath ?? null), native: true };
      },
    },
    shell: {
      openPath: (p) => shell.openPath(p),
      showInFolder: (p) => shell.showItemInFolder(p),
      openExternal: (url) => shell.openExternal(url),
    },
    quit: () => app.quit(),
    mediaUrl: (p) => `sevenvid-media://local/${encodeURIComponent(p)}`,
  };
}
