import fs from 'node:fs';
import path from 'node:path';
import { parseFps, type Fraction } from '@sevenvid/core';
import { AppError } from '../errors';
import { runFfprobe } from '../ffmpeg/runner';
import { mediaKindFromPath } from '../fs/FsService';

export interface VideoStreamInfo {
  index: number;
  codec: string;
  width: number;
  height: number;
  fps: Fraction;
  frames: number | null;
  pixFmt: string | null;
  rotation: number;
  bitrate: number | null;
  isImage: boolean;
}

export interface AudioStreamInfo {
  index: number;
  codec: string;
  channels: number;
  sampleRate: number;
  bitrate: number | null;
  language: string | null;
}

export interface MediaInfo {
  path: string;
  kind: 'video' | 'image' | 'audio';
  container: string;
  durationMs: number | null;
  sizeBytes: number;
  bitrate: number | null;
  video: VideoStreamInfo | null;
  audio: AudioStreamInfo | null;
  videoStreams: VideoStreamInfo[];
  audioStreams: AudioStreamInfo[];
  raw: unknown;
}

interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  pix_fmt?: string;
  bit_rate?: string;
  channels?: number;
  sample_rate?: string;
  duration?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
}

interface ProbeFormat {
  format_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
}

const IMAGE_CODECS = new Set(['png', 'mjpeg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'heif', 'av1', 'ppm']);

/** Analyzes a media file with ffprobe. Never modifies the file. */
export async function probeMedia(ffprobe: string, file: string): Promise<MediaInfo> {
  if (!fs.existsSync(file)) throw new AppError({ code: 'FILE_NOT_FOUND', operation: 'media.probe', message: `File not found: ${file}`, details: { path: file } });
  const stat = fs.statSync(file);
  const raw = (await runFfprobe(ffprobe, ['-show_format', '-show_streams', '-i', file], { operation: 'media.probe' })) as { streams?: ProbeStream[]; format?: ProbeFormat };
  const streams = raw.streams ?? [];
  const format = raw.format ?? {};
  const extKind = mediaKindFromPath(file);
  const videoStreams: VideoStreamInfo[] = [];
  const audioStreams: AudioStreamInfo[] = [];
  for (const s of streams) {
    if (s.codec_type === 'video') {
      if (s.disposition?.attached_pic === 1) continue;
      const fps = parseFps(s.avg_frame_rate && s.avg_frame_rate !== '0/0' ? s.avg_frame_rate : s.r_frame_rate) ?? { num: 25, den: 1 };
      let rotation = 0;
      const rotTag = s.tags?.rotate;
      if (rotTag && Number.isFinite(Number(rotTag))) rotation = Number(rotTag);
      for (const sd of s.side_data_list ?? []) if (typeof sd.rotation === 'number') rotation = Math.round(sd.rotation);
      rotation = ((rotation % 360) + 360) % 360;
      const isImage = extKind === 'image' || (IMAGE_CODECS.has(s.codec_name ?? '') && (s.nb_frames === '1' || !s.avg_frame_rate || s.avg_frame_rate === '0/0') && extKind !== 'video');
      const swap = rotation === 90 || rotation === 270;
      videoStreams.push({
        index: s.index,
        codec: s.codec_name ?? 'unknown',
        width: swap ? (s.height ?? 0) : (s.width ?? 0),
        height: swap ? (s.width ?? 0) : (s.height ?? 0),
        fps: isImage ? { num: 1, den: 1 } : fps,
        frames: s.nb_frames ? Number(s.nb_frames) : null,
        pixFmt: s.pix_fmt ?? null,
        rotation,
        bitrate: s.bit_rate ? Number(s.bit_rate) : null,
        isImage,
      });
    } else if (s.codec_type === 'audio') {
      audioStreams.push({ index: s.index, codec: s.codec_name ?? 'unknown', channels: s.channels ?? 0, sampleRate: s.sample_rate ? Number(s.sample_rate) : 0, bitrate: s.bit_rate ? Number(s.bit_rate) : null, language: s.tags?.language ?? null });
    }
  }
  const video = videoStreams[0] ?? null;
  const audio = audioStreams[0] ?? null;
  let kind: MediaInfo['kind'];
  if (video && video.isImage && !audio) kind = 'image';
  else if (video) kind = 'video';
  else if (audio) kind = 'audio';
  else throw new AppError({ code: 'MEDIA_UNSUPPORTED', operation: 'media.probe', message: `No decodable video or audio streams in ${path.basename(file)}`, details: { path: file, format: format.format_name } });
  const durationSec = format.duration ? Number(format.duration) : streams.map((s) => Number(s.duration ?? 0)).reduce((a, b) => Math.max(a, b), 0);
  const durationMs = kind === 'image' ? null : Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec * 1000) : null;
  if (kind !== 'image' && durationMs == null) throw new AppError({ code: 'MEDIA_UNSUPPORTED', operation: 'media.probe', message: `Could not determine the duration of ${path.basename(file)}`, details: { path: file } });
  return {
    path: file,
    kind,
    container: (format.format_name ?? '').split(',')[0] ?? '',
    durationMs,
    sizeBytes: stat.size,
    bitrate: format.bit_rate ? Number(format.bit_rate) : null,
    video,
    audio,
    videoStreams,
    audioStreams,
    raw,
  };
}

/** Fingerprint used to detect the same file imported twice (size + mtime + path). */
export function fileFingerprint(file: string): string {
  const st = fs.statSync(file);
  return `${st.size}:${Math.round(st.mtimeMs)}:${path.resolve(file)}`;
}
