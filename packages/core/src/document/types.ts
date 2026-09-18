import type { Fraction } from '../time';

export const DOCUMENT_SCHEMA_VERSION = 1 as const;

export type ProjectKind = 'editor' | 'creator';
export type TrackKind = 'video' | 'audio' | 'overlay';
export type AssetKind = 'video' | 'image' | 'audio';
export type AspectPresetId = '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | 'custom';
export type PlatformPresetId =
  | 'youtube'
  | 'tiktok'
  | 'reels'
  | 'instagram-post'
  | 'shorts'
  | 'presentation'
  | 'custom';

export interface SequenceSettings {
  width: number;
  height: number;
  fps: Fraction;
  sampleRate: number;
  channels: number;
  aspectPreset: AspectPresetId;
  platformPreset: PlatformPresetId;
}

/** A lightweight reference to a media asset kept inside the document so it is self-contained. */
export interface AssetRef {
  id: string;
  kind: AssetKind;
  name: string;
  sourcePath: string;
  proxyPath: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: Fraction | null;
  hasVideo: boolean;
  hasAudio: boolean;
  missing: boolean;
}

export type FitMode = 'contain' | 'cover' | 'stretch' | 'blur-fill';

export interface Transform {
  /** Crop fractions (0..1) measured from each edge of the source frame. */
  cropLeft: number;
  cropTop: number;
  cropRight: number;
  cropBottom: number;
  /** Rotation in degrees, clockwise. */
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  /** Uniform scale multiplier applied after fitting. */
  scale: number;
  /** Position offset as fraction of sequence width/height (0 = centered). */
  offsetX: number;
  offsetY: number;
  fit: FitMode;
  opacity: number;
}

export type EffectType =
  | 'color'
  | 'sharpen'
  | 'denoise'
  | 'stabilize'
  | 'audio-normalize'
  | 'audio-denoise'
  | 'audio-voice'
  | 'audio-eq'
  | 'audio-compressor'
  | 'audio-duck';

export type EffectParamValue = number | string | boolean;

export interface Effect {
  id: string;
  type: EffectType;
  enabled: boolean;
  params: Record<string, EffectParamValue>;
}

export interface ClipAudio {
  /** Gain in dB. */
  gainDb: number;
  muted: boolean;
  fadeInMs: number;
  fadeOutMs: number;
}

export interface FreezeFrame {
  /** Source position (ms) of the frozen frame. */
  atSourceMs: number;
}

export interface Clip {
  id: string;
  trackId: string;
  assetId: string;
  name: string;
  /** Position on the timeline in ms. */
  startMs: number;
  /** Duration on the timeline in ms (after speed change). */
  durationMs: number;
  /** Source in/out points in ms (before speed change). */
  sourceInMs: number;
  sourceOutMs: number;
  /** Playback speed multiplier; 1 = normal, 2 = double speed, 0.5 = slow motion. */
  speed: number;
  reverse: boolean;
  freeze: FreezeFrame | null;
  transform: Transform;
  effects: Effect[];
  audio: ClipAudio;
  /** Id of the clip on another track whose edits stay linked (e.g. audio of the same asset). */
  linkedClipId: string | null;
  color: string | null;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  locked: boolean;
  solo: boolean;
  /** Track gain in dB (audio tracks). */
  gainDb: number;
  clips: Clip[];
}

export type MaskKind = 'blur' | 'pixelate' | 'box' | 'custom';
export type MaskShape = 'rect' | 'ellipse';
export type MaskSource = 'auto-face' | 'auto-object' | 'auto-text' | 'manual';
export type MaskStatus = 'ok' | 'partial' | 'lost';

export interface MaskKeyframe {
  /** Time on the timeline in ms. */
  tMs: number;
  /** Normalized box (0..1) relative to the sequence (composite) frame; linearly interpolated between keyframes. */
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number | null;
}

/** Result of measuring a rendered mask (Laplacian variance inside the box, before vs after). */
export interface MaskVerification {
  ok: boolean;
  at: string;
  /** Mean sharpness inside the box without / with the mask. */
  before: number;
  after: number;
  samples: number;
}

export interface MaskTrack {
  id: string;
  clipId: string;
  kind: MaskKind;
  shape: MaskShape;
  /** Blur radius / pixel size / (ignored for box). */
  strength: number;
  /** Edge feather in normalized units. */
  feather: number;
  /** Solid color for box masks (#rrggbb). */
  color: string;
  keyframes: MaskKeyframe[];
  /** Path of an external keyframes file relative to the project data dir (large tracks). */
  keyframesFile: string | null;
  source: MaskSource;
  label: string;
  enabled: boolean;
  status: MaskStatus;
  /** Timeline range covered by the mask. */
  startMs: number;
  endMs: number;
  /** Ranges inside [startMs, endMs) where tracking lost the target (mask holds the last known box there). */
  lostRanges?: Array<{ startMs: number; endMs: number }>;
  verification?: MaskVerification | null;
}

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  backgroundColor: string | null;
  position: 'bottom' | 'center' | 'top';
  marginV: number;
  bold: boolean;
}

export interface SubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker: string | null;
}

export type SubtitleSource = 'stt' | 'manual' | 'imported' | 'creator' | 'translation';

export interface SubtitleTrack {
  id: string;
  name: string;
  language: string;
  cues: SubtitleCue[];
  style: SubtitleStyle;
  enabled: boolean;
  burnIn: boolean;
  source: SubtitleSource;
}

export interface Marker {
  id: string;
  tMs: number;
  label: string;
  color: string;
}

export interface MasterAudio {
  gainDb: number;
  normalize: boolean;
  /** Target integrated loudness in LUFS when normalize is enabled. */
  targetLufs: number;
}

export interface DocumentMeta {
  templateId: string | null;
  description: string;
  tags: string[];
}

export interface ProjectDocument {
  schemaVersion: typeof DOCUMENT_SCHEMA_VERSION;
  id: string;
  name: string;
  kind: ProjectKind;
  createdAt: string;
  updatedAt: string;
  settings: SequenceSettings;
  assets: Record<string, AssetRef>;
  tracks: Track[];
  masks: MaskTrack[];
  subtitles: SubtitleTrack[];
  markers: Marker[];
  master: MasterAudio;
  meta: DocumentMeta;
}
