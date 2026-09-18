import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { runFfmpeg, type FfmpegProgress } from '../ffmpeg/runner';
import type { MediaInfo } from './probe';

/** What the preview surface (Chromium inside Electron or a browser) can decode natively. */
export interface PlaybackCapabilities {
  h264: boolean;
  hevc: boolean;
  vp9: boolean;
  av1: boolean;
  aac: boolean;
  opus: boolean;
  mp3: boolean;
}

/** Electron ships proprietary codecs; use this until the renderer reports its real capabilities. */
export const DEFAULT_PLAYBACK_CAPABILITIES: PlaybackCapabilities = { h264: true, hevc: false, vp9: true, av1: true, aac: true, opus: true, mp3: true };

const PLAYABLE_CONTAINERS = new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2', 'matroska', 'webm', 'mp3', 'wav', 'ogg', 'flac']);

export type ProxyReason = 'none' | 'resolution' | 'video-codec' | 'audio-codec' | 'container';

export interface ProxyDecision {
  needed: boolean;
  reason: ProxyReason;
  format: 'mp4' | 'webm';
}

function videoCodecPlayable(codec: string, caps: PlaybackCapabilities): boolean {
  switch (codec) {
    case 'h264':
      return caps.h264;
    case 'hevc':
      return caps.hevc;
    case 'vp9':
      return caps.vp9;
    case 'vp8':
      return true;
    case 'av1':
      return caps.av1;
    default:
      return false;
  }
}

function audioCodecPlayable(codec: string, caps: PlaybackCapabilities): boolean {
  switch (codec) {
    case 'aac':
      return caps.aac;
    case 'opus':
      return caps.opus;
    case 'mp3':
      return caps.mp3;
    case 'vorbis':
    case 'flac':
    case 'pcm_s16le':
    case 'pcm_s24le':
    case 'pcm_f32le':
      return true;
    default:
      return false;
  }
}

/** Decides whether the preview needs a proxy and in which format it should be encoded. */
export function decideProxy(info: MediaInfo, opts: { maxHeight: number; caps: PlaybackCapabilities }): ProxyDecision {
  const format: ProxyDecision['format'] = opts.caps.h264 && opts.caps.aac ? 'mp4' : 'webm';
  if (info.kind === 'image') return { needed: false, reason: 'none', format };
  const container = info.container.split(',')[0] ?? '';
  if (!PLAYABLE_CONTAINERS.has(container)) return { needed: true, reason: 'container', format };
  if (info.video && !videoCodecPlayable(info.video.codec, opts.caps)) return { needed: true, reason: 'video-codec', format };
  if (info.audio && !audioCodecPlayable(info.audio.codec, opts.caps)) return { needed: true, reason: 'audio-codec', format };
  if (info.video && info.video.height > opts.maxHeight) return { needed: true, reason: 'resolution', format };
  return { needed: false, reason: 'none', format };
}

export interface ProxyOptions {
  height: number;
  format: 'mp4' | 'webm';
  signal?: AbortSignal;
  onProgress?: (p: FfmpegProgress) => void;
  onProcess?: (proc: ChildProcess, controls: { pause: () => boolean; resume: () => boolean }) => void;
  threads?: number;
}

/** Encodes a lightweight, seek-friendly preview copy of the media. The source is never modified. */
export async function generateProxy(ffmpeg: string, info: MediaInfo, out: string, opts: ProxyOptions): Promise<string> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const height = Math.min(opts.height, info.video?.height ?? opts.height);
  const evenHeight = Math.max(2, Math.round(height / 2) * 2);
  const args: string[] = ['-i', info.path];
  if (opts.threads && opts.threads > 0) args.push('-threads', String(opts.threads));
  if (info.video && info.kind === 'video') {
    args.push('-vf', `scale=-2:${evenHeight}`, '-map', '0:v:0');
    if (opts.format === 'mp4') args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-g', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
    else args.push('-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', '32', '-b:v', '0', '-g', '30', '-pix_fmt', 'yuv420p');
  } else {
    args.push('-vn');
  }
  if (info.audio) {
    args.push('-map', '0:a:0', '-ac', '2', '-ar', '48000');
    if (opts.format === 'mp4') args.push('-c:a', 'aac', '-b:a', '128k');
    else args.push('-c:a', 'libopus', '-b:a', '96k');
  } else {
    args.push('-an');
  }
  args.push('-sn', '-dn', '-map_metadata', '-1', out);
  await runFfmpeg({ ffmpeg, args, signal: opts.signal, expectDurationMs: info.durationMs, onProgress: opts.onProgress, onProcess: opts.onProcess, operation: 'media.proxy' });
  return out;
}
