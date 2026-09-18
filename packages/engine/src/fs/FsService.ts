import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DirEntry } from '@sevenvid/ipc';
import { AppError } from '../errors';
import type { AppPaths } from '../paths/AppPaths';

export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mts', 'm2ts', 'ts', 'wmv', 'flv', '3gp', 'mpg', 'mpeg', 'mxf'];
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'avif'];
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'wma', 'aiff', 'aif'];
export const SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'ass'];

export function mediaKindFromPath(p: string): 'video' | 'image' | 'audio' | null {
  const ext = path.extname(p).slice(1).toLowerCase();
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  return null;
}

export class FsService {
  constructor(private readonly paths: AppPaths) {}

  roots(): Array<{ label: string; path: string }> {
    const roots: Array<{ label: string; path: string }> = [
      { label: 'home', path: os.homedir() },
      { label: 'projects', path: this.paths.projects },
      { label: 'exports', path: this.paths.exports },
    ];
    if (process.platform === 'win32') {
      for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const drive = `${letter}:\\`;
        if (fs.existsSync(drive)) roots.push({ label: drive, path: drive });
      }
    } else {
      roots.push({ label: 'root', path: '/' });
      for (const mnt of ['/media', '/mnt', '/Volumes']) if (fs.existsSync(mnt)) roots.push({ label: mnt, path: mnt });
    }
    const dev = process.env.SEVENVID_DEV_MEDIA_DIR;
    if (dev && fs.existsSync(dev)) roots.unshift({ label: 'sample-media', path: dev });
    return roots;
  }

  listDir(dir: string | null, mediaOnly = false): { path: string; parent: string | null; entries: DirEntry[] } {
    const target = path.resolve(dir ?? os.homedir());
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(target, { withFileTypes: true });
    } catch (err) {
      throw AppError.from(err, { code: 'FILE_ACCESS_DENIED', operation: 'fs.listDir', details: { path: target } });
    }
    const entries: DirEntry[] = [];
    for (const d of names) {
      if (d.name.startsWith('.')) continue;
      const full = path.join(target, d.name);
      const isDirectory = d.isDirectory();
      const mediaKind = isDirectory ? null : mediaKindFromPath(d.name);
      if (mediaOnly && !isDirectory && !mediaKind) continue;
      let sizeBytes: number | null = null;
      let modifiedAt: string | null = null;
      if (!isDirectory) {
        try {
          const st = fs.statSync(full);
          sizeBytes = st.size;
          modifiedAt = st.mtime.toISOString();
        } catch {
          continue;
        }
      }
      entries.push({ name: d.name, path: full, isDirectory, sizeBytes, modifiedAt, mediaKind });
    }
    entries.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    const parent = path.dirname(target);
    return { path: target, parent: parent === target ? null : parent, entries };
  }

  exists(p: string): { exists: boolean; isDirectory: boolean } {
    try {
      const st = fs.statSync(p);
      return { exists: true, isDirectory: st.isDirectory() };
    } catch {
      return { exists: false, isDirectory: false };
    }
  }

  /** Free space (bytes) on the volume that contains `p`, or null when unavailable. */
  freeSpace(p: string): number | null {
    try {
      const st = fs.statfsSync(p);
      return Number(st.bavail) * Number(st.bsize);
    } catch {
      return null;
    }
  }
}
