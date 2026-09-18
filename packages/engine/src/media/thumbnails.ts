import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg } from '../ffmpeg/runner';
import type { MediaInfo } from './probe';

export interface SpriteMeta {
  version: 1;
  path: string;
  count: number;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  intervalMs: number;
  durationMs: number;
}

/** Renders a single poster frame (or a scaled copy for images). */
export async function generatePoster(ffmpeg: string, info: MediaInfo, out: string, opts: { atMs?: number; width?: number; signal?: AbortSignal } = {}): Promise<string> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const width = opts.width ?? 480;
  if (info.kind === 'audio') return out;
  const at = opts.atMs ?? (info.durationMs ? Math.min(info.durationMs * 0.1, 2000) : 0);
  const args = info.kind === 'image'
    ? ['-i', info.path, '-vf', `scale=${width}:-2`, '-frames:v', '1', out]
    : ['-ss', (at / 1000).toFixed(3), '-i', info.path, '-vf', `scale=${width}:-2`, '-frames:v', '1', '-update', '1', out];
  await runFfmpeg({ ffmpeg, args, signal: opts.signal, operation: 'media.poster', timeoutMs: 60_000 });
  return out;
}

/** Renders a sprite sheet of evenly spaced frames used by the timeline (uniform tiles, letterboxed). */
export async function generateSprite(ffmpeg: string, info: MediaInfo, outPng: string, opts: { count?: number; tileWidth?: number; cols?: number; signal?: AbortSignal } = {}): Promise<SpriteMeta | null> {
  if (info.kind !== 'video' || !info.durationMs) return null;
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  const tileWidth = opts.tileWidth ?? 160;
  const aspect = info.video && info.video.width > 0 ? info.video.height / info.video.width : 9 / 16;
  const tileHeight = Math.max(2, Math.round((tileWidth * aspect) / 2) * 2);
  const maxCount = opts.count ?? 60;
  const count = Math.max(1, Math.min(maxCount, Math.ceil(info.durationMs / 500)));
  const cols = Math.min(opts.cols ?? 10, count);
  const rows = Math.ceil(count / cols);
  const intervalMs = info.durationMs / count;
  const vf = `fps=1/${(intervalMs / 1000).toFixed(6)},scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=decrease,pad=${tileWidth}:${tileHeight}:(ow-iw)/2:(oh-ih)/2:color=black,tile=${cols}x${rows}`;
  await runFfmpeg({ ffmpeg, args: ['-i', info.path, '-vf', vf, '-frames:v', '1', '-update', '1', outPng], signal: opts.signal, operation: 'media.sprite', timeoutMs: 180_000 });
  const meta: SpriteMeta = { version: 1, path: outPng, count, cols, rows, tileWidth, tileHeight, intervalMs, durationMs: info.durationMs };
  fs.writeFileSync(outPng.replace(/\.png$/, '.json'), JSON.stringify(meta));
  return meta;
}
