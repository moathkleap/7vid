import { FPS_30, type Fraction } from './time';
import type { AspectPresetId, PlatformPresetId } from './document/types';

export interface AspectPreset {
  id: AspectPresetId;
  label: string;
  width: number;
  height: number;
  ratio: number;
}

export const ASPECT_PRESETS: Record<Exclude<AspectPresetId, 'custom'>, AspectPreset> = {
  '16:9': { id: '16:9', label: '16:9', width: 1920, height: 1080, ratio: 16 / 9 },
  '9:16': { id: '9:16', label: '9:16', width: 1080, height: 1920, ratio: 9 / 16 },
  '1:1': { id: '1:1', label: '1:1', width: 1080, height: 1080, ratio: 1 },
  '4:5': { id: '4:5', label: '4:5', width: 1080, height: 1350, ratio: 4 / 5 },
  '4:3': { id: '4:3', label: '4:3', width: 1440, height: 1080, ratio: 4 / 3 },
};

export interface PlatformPreset {
  id: PlatformPresetId;
  nameKey: string;
  aspect: AspectPresetId;
  width: number;
  height: number;
  fps: Fraction;
  maxDurationMs: number | null;
  exportPresetId: ExportPresetId;
}

export const PLATFORM_PRESETS: Record<Exclude<PlatformPresetId, 'custom'>, PlatformPreset> = {
  youtube: { id: 'youtube', nameKey: 'presets.platform.youtube', aspect: '16:9', width: 1920, height: 1080, fps: FPS_30, maxDurationMs: null, exportPresetId: 'youtube-1080p' },
  tiktok: { id: 'tiktok', nameKey: 'presets.platform.tiktok', aspect: '9:16', width: 1080, height: 1920, fps: FPS_30, maxDurationMs: 10 * 60_000, exportPresetId: 'tiktok' },
  reels: { id: 'reels', nameKey: 'presets.platform.reels', aspect: '9:16', width: 1080, height: 1920, fps: FPS_30, maxDurationMs: 90_000, exportPresetId: 'instagram-reels' },
  'instagram-post': { id: 'instagram-post', nameKey: 'presets.platform.instagramPost', aspect: '4:5', width: 1080, height: 1350, fps: FPS_30, maxDurationMs: 60_000, exportPresetId: 'instagram-post' },
  shorts: { id: 'shorts', nameKey: 'presets.platform.shorts', aspect: '9:16', width: 1080, height: 1920, fps: FPS_30, maxDurationMs: 60_000, exportPresetId: 'youtube-shorts' },
  presentation: { id: 'presentation', nameKey: 'presets.platform.presentation', aspect: '16:9', width: 1920, height: 1080, fps: FPS_30, maxDurationMs: null, exportPresetId: 'high-quality' },
};

export type VideoCodecId = 'h264' | 'h265' | 'av1' | 'vp9';
export type AudioCodecId = 'aac' | 'opus' | 'mp3';
export type ContainerId = 'mp4' | 'mov' | 'webm';
export type ExportPresetId =
  | 'youtube-1080p'
  | 'youtube-4k'
  | 'youtube-shorts'
  | 'tiktok'
  | 'instagram-reels'
  | 'instagram-post'
  | 'high-quality'
  | 'uhd-4k'
  | 'web-small'
  | 'custom';

export type QualityMode = 'crf' | 'bitrate';

export interface ExportSettings {
  presetId: ExportPresetId;
  container: ContainerId;
  videoCodec: VideoCodecId;
  audioCodec: AudioCodecId;
  width: number | null;
  height: number | null;
  fps: Fraction | null;
  qualityMode: QualityMode;
  /** CRF (lower = better) for quality mode 'crf'. */
  crf: number;
  /** Video bitrate in kbps for quality mode 'bitrate'. */
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  /** Encoder speed preset (x264/x265 style). */
  speedPreset: 'ultrafast' | 'veryfast' | 'fast' | 'medium' | 'slow' | 'slower';
  hardwareAcceleration: 'auto' | 'off';
  burnSubtitles: boolean;
}

export interface ExportPreset {
  id: ExportPresetId;
  nameKey: string;
  settings: ExportSettings;
}

function preset(id: ExportPresetId, nameKey: string, s: Partial<ExportSettings>): ExportPreset {
  return {
    id,
    nameKey,
    settings: {
      presetId: id,
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      width: null,
      height: null,
      fps: null,
      qualityMode: 'crf',
      crf: 20,
      videoBitrateKbps: 12000,
      audioBitrateKbps: 192,
      speedPreset: 'medium',
      hardwareAcceleration: 'auto',
      burnSubtitles: true,
      ...s,
    },
  };
}

export const EXPORT_PRESETS: ExportPreset[] = [
  preset('youtube-1080p', 'presets.export.youtube1080', { width: 1920, height: 1080, crf: 18, videoBitrateKbps: 12000 }),
  preset('youtube-4k', 'presets.export.youtube4k', { width: 3840, height: 2160, crf: 18, videoBitrateKbps: 45000, videoCodec: 'h265' }),
  preset('youtube-shorts', 'presets.export.shorts', { width: 1080, height: 1920, crf: 19, videoBitrateKbps: 10000 }),
  preset('tiktok', 'presets.export.tiktok', { width: 1080, height: 1920, crf: 20, videoBitrateKbps: 8000 }),
  preset('instagram-reels', 'presets.export.reels', { width: 1080, height: 1920, crf: 20, videoBitrateKbps: 8000 }),
  preset('instagram-post', 'presets.export.instagramPost', { width: 1080, height: 1350, crf: 20, videoBitrateKbps: 6000 }),
  preset('high-quality', 'presets.export.highQuality', { crf: 16, videoBitrateKbps: 20000, speedPreset: 'slow' }),
  preset('uhd-4k', 'presets.export.uhd4k', { width: 3840, height: 2160, crf: 17, videoBitrateKbps: 50000, videoCodec: 'h265', speedPreset: 'slow' }),
  preset('web-small', 'presets.export.webSmall', { width: 1280, height: 720, crf: 24, videoBitrateKbps: 3000, speedPreset: 'fast', audioBitrateKbps: 128 }),
  preset('custom', 'presets.export.custom', {}),
];

export function getExportPreset(id: ExportPresetId): ExportPreset {
  return EXPORT_PRESETS.find((p) => p.id === id) ?? EXPORT_PRESETS[EXPORT_PRESETS.length - 1]!;
}

export const CONTAINER_CODECS: Record<ContainerId, { video: VideoCodecId[]; audio: AudioCodecId[] }> = {
  mp4: { video: ['h264', 'h265', 'av1'], audio: ['aac', 'mp3', 'opus'] },
  mov: { video: ['h264', 'h265'], audio: ['aac', 'mp3'] },
  webm: { video: ['vp9', 'av1'], audio: ['opus'] },
};
