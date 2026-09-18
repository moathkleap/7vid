import { z } from 'zod';
import type { AppErrorInfo, CapabilityInfo, Command, ProjectDocument, AppSettings } from '@sevenvid/core';

/** Passthrough schema for large domain objects that are validated by the core package itself. */
export function passthrough<T>(check: (v: unknown) => boolean = () => true) {
  return z.custom<T>((v) => check(v));
}

export const ProjectDocumentSchema = passthrough<ProjectDocument>(
  (v) => typeof v === 'object' && v !== null && 'schemaVersion' in v && 'tracks' in v,
);
export const CommandSchema = passthrough<Command>((v) => typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string');
export const AppErrorInfoSchema = passthrough<AppErrorInfo>((v) => typeof v === 'object' && v !== null && 'errorId' in v);
export const CapabilityInfoSchema = passthrough<CapabilityInfo>((v) => typeof v === 'object' && v !== null && 'status' in v);
export const AppSettingsSchema = passthrough<AppSettings>((v) => typeof v === 'object' && v !== null && 'general' in v);

export const ProjectKindSchema = z.enum(['editor', 'creator']);

export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: ProjectKindSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string().nullable(),
  thumbnailPath: z.string().nullable(),
  durationMs: z.number(),
  width: z.number(),
  height: z.number(),
  dataDir: z.string(),
  deletedAt: z.string().nullable(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectVersionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  seq: z.number(),
  label: z.string().nullable(),
  reason: z.enum(['autosave', 'manual', 'ai', 'restore', 'creator', 'recovery']),
  hash: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
});
export type ProjectVersion = z.infer<typeof ProjectVersionSchema>;

export const HistoryStateSchema = z.object({
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  undoLabel: z.string().nullable(),
  redoLabel: z.string().nullable(),
  size: z.number(),
});

export const SaveStateSchema = z.object({
  dirty: z.boolean(),
  lastSavedAt: z.string().nullable(),
  saving: z.boolean(),
  lastError: AppErrorInfoSchema.nullable(),
});

export const SessionStateSchema = z.object({
  projectId: z.string(),
  document: ProjectDocumentSchema,
  history: HistoryStateSchema,
  save: SaveStateSchema,
  revision: z.number(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const TaskStatusSchema = z.enum(['queued', 'running', 'paused', 'done', 'failed', 'cancelled', 'interrupted']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskInfoSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  parentTaskId: z.string().nullable(),
  status: TaskStatusSchema,
  priority: z.number(),
  progress: z.number(),
  progressMessage: z.string().nullable(),
  etaMs: z.number().nullable(),
  params: z.record(z.string(), z.unknown()),
  result: z.unknown().nullable(),
  error: AppErrorInfoSchema.nullable(),
  attempts: z.number(),
  cancellable: z.boolean(),
  pausable: z.boolean(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type TaskInfo = z.infer<typeof TaskInfoSchema>;

export const GpuInfoSchema = z.object({
  vendor: z.string(),
  model: z.string(),
  vramMb: z.number().nullable(),
  vramUsedMb: z.number().nullable(),
  utilizationPercent: z.number().nullable(),
  temperatureC: z.number().nullable(),
  driver: z.string().nullable(),
  kind: z.enum(['nvidia', 'amd', 'intel', 'apple', 'other']),
  supportsCuda: z.boolean(),
});

export const HardwareSnapshotSchema = z.object({
  at: z.string(),
  os: z.object({ platform: z.string(), distro: z.string(), release: z.string(), arch: z.string() }),
  cpu: z.object({ brand: z.string(), cores: z.number(), physicalCores: z.number(), speedGhz: z.number().nullable(), loadPercent: z.number().nullable() }),
  memory: z.object({ totalMb: z.number(), usedMb: z.number(), availableMb: z.number() }),
  gpus: z.array(GpuInfoSchema),
  disks: z.array(z.object({ mount: z.string(), fs: z.string(), sizeMb: z.number(), usedMb: z.number(), availableMb: z.number() })),
  dataDisk: z.object({ mount: z.string(), sizeMb: z.number(), availableMb: z.number() }).nullable(),
  ffmpeg: z.object({ available: z.boolean(), version: z.string().nullable(), path: z.string().nullable(), hwEncoders: z.array(z.string()) }),
  python: z.object({ available: z.boolean(), version: z.string().nullable(), path: z.string().nullable(), venvReady: z.boolean(), device: z.string().nullable() }),
});
export type HardwareSnapshot = z.infer<typeof HardwareSnapshotSchema>;

export const RecoveryInfoSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  versionId: z.string().nullable(),
  journalEntries: z.number(),
  lastAutosaveAt: z.string().nullable(),
  reason: z.enum(['unclean-shutdown', 'journal-ahead']),
});
export type RecoveryInfo = z.infer<typeof RecoveryInfoSchema>;

export const LogEntrySchema = z.object({
  time: z.string(),
  level: z.string(),
  module: z.string().nullable(),
  operation: z.string().nullable(),
  taskId: z.string().nullable(),
  model: z.string().nullable(),
  durationMs: z.number().nullable(),
  status: z.string().nullable(),
  msg: z.string(),
  errorId: z.string().nullable(),
  raw: z.record(z.string(), z.unknown()),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const SearchResultSchema = z.object({
  type: z.enum(['project', 'asset', 'character', 'scene', 'operation', 'model', 'template']),
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  projectId: z.string().nullable(),
  score: z.number(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const DirEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isDirectory: z.boolean(),
  sizeBytes: z.number().nullable(),
  modifiedAt: z.string().nullable(),
  mediaKind: z.enum(['video', 'image', 'audio']).nullable(),
});
export type DirEntry = z.infer<typeof DirEntrySchema>;

export const NotificationSchema = z.object({
  id: z.string(),
  level: z.enum(['info', 'success', 'warning', 'error']),
  titleKey: z.string(),
  messageKey: z.string().nullable(),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  taskId: z.string().nullable(),
  errorId: z.string().nullable(),
  at: z.string(),
});
export type NotificationInfo = z.infer<typeof NotificationSchema>;

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
  electron: z.string().nullable(),
  node: z.string(),
  mode: z.enum(['electron', 'browser']),
  paths: z.object({
    userData: z.string(),
    projects: z.string(),
    cache: z.string(),
    logs: z.string(),
    models: z.string(),
    exports: z.string(),
    resources: z.string(),
  }),
  isDev: z.boolean(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const TemplateInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
  category: z.string(),
  builtin: z.boolean(),
  description: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  platformPreset: z.string().nullable(),
  settings: z.object({ width: z.number(), height: z.number(), fps: z.number(), aspectPreset: z.string() }).nullable(),
  subtitleStyle: z.record(z.string(), z.unknown()).nullable(),
  exportPresetId: z.string().nullable(),
  targetDurationMs: z.number().nullable(),
  createdAt: z.string(),
});
export type TemplateInfo = z.infer<typeof TemplateInfoSchema>;

export const ExportInfoSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  taskId: z.string().nullable(),
  presetId: z.string(),
  settings: z.record(z.string(), z.unknown()),
  outputPath: z.string(),
  status: z.enum(['queued', 'running', 'validating', 'done', 'failed', 'cancelled']),
  validation: z.record(z.string(), z.unknown()).nullable(),
  sizeBytes: z.number().nullable(),
  durationMs: z.number().nullable(),
  error: AppErrorInfoSchema.nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ExportInfo = z.infer<typeof ExportInfoSchema>;

export const NetworkLogEntrySchema = z.object({
  id: z.number(),
  ts: z.string(),
  providerId: z.string().nullable(),
  host: z.string(),
  purpose: z.string(),
  bytesOut: z.number(),
  bytesIn: z.number(),
  status: z.string(),
});
export type NetworkLogEntry = z.infer<typeof NetworkLogEntrySchema>;

export const AssetKindSchema = z.enum(['video', 'image', 'audio', 'music', 'voice', 'character', 'generated', 'template', 'font']);
export const AssetInfoSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  kind: AssetKindSchema,
  name: z.string(),
  sourcePath: z.string(),
  mime: z.string().nullable(),
  container: z.string().nullable(),
  durationMs: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  fps: z.object({ num: z.number(), den: z.number() }).nullable(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  channels: z.number().nullable(),
  sampleRate: z.number().nullable(),
  bitrate: z.number().nullable(),
  sizeBytes: z.number().nullable(),
  thumbnailPath: z.string().nullable(),
  spritePath: z.string().nullable(),
  spriteMeta: z.object({ count: z.number(), cols: z.number(), rows: z.number(), tileWidth: z.number(), tileHeight: z.number(), intervalMs: z.number() }).nullable(),
  waveformPath: z.string().nullable(),
  proxyPath: z.string().nullable(),
  proxyStatus: z.enum(['none', 'pending', 'running', 'ready', 'failed', 'not-needed']),
  analysisStatus: z.enum(['pending', 'running', 'ready', 'failed']),
  analysisError: AppErrorInfoSchema.nullable(),
  tags: z.array(z.string()),
  favorite: z.boolean(),
  missing: z.boolean(),
  origin: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssetInfo = z.infer<typeof AssetInfoSchema>;

export const PlaybackCapabilitiesSchema = z.object({ h264: z.boolean(), hevc: z.boolean(), vp9: z.boolean(), av1: z.boolean(), aac: z.boolean(), opus: z.boolean(), mp3: z.boolean() });

export const WaveformDataSchema = z.object({ version: z.literal(1), samplesPerSecond: z.number(), durationMs: z.number(), peaks: z.array(z.number()) });

export const ExportSettingsInputSchema = z.object({
  presetId: z.string().optional(),
  container: z.enum(['mp4', 'mov', 'webm']).optional(),
  videoCodec: z.enum(['h264', 'h265', 'av1', 'vp9']).optional(),
  audioCodec: z.enum(['aac', 'opus', 'mp3']).optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  fps: z.object({ num: z.number(), den: z.number() }).nullable().optional(),
  qualityMode: z.enum(['crf', 'bitrate']).optional(),
  crf: z.number().optional(),
  videoBitrateKbps: z.number().optional(),
  audioBitrateKbps: z.number().optional(),
  speedPreset: z.enum(['ultrafast', 'veryfast', 'fast', 'medium', 'slow', 'slower']).optional(),
  hardwareAcceleration: z.enum(['auto', 'off']).optional(),
  burnSubtitles: z.boolean().optional(),
});

// ---- Phase 3: models, runtime, vision, audio, subtitles, OCR ----

export const NormBoxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type NormBoxInput = z.infer<typeof NormBoxSchema>;

export const ModelFileSchema = z.object({ path: z.string(), url: z.string(), sha256: z.string().nullable(), sizeBytes: z.number().nullable() });
export const ModelSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  capability: z.string(),
  providerId: z.string(),
  version: z.string(),
  kind: z.string(),
  files: z.array(ModelFileSchema),
  sizeBytes: z.number(),
  vramMb: z.number().nullable(),
  ramMb: z.number().nullable(),
  requiresGpu: z.boolean(),
  languages: z.array(z.string()),
  license: z.string(),
  description: z.string(),
  descriptionAr: z.string(),
  host: z.string(),
  recommended: z.enum(['always', 'optional', 'gpu']),
});
export const ModelStatusSchema = z.object({
  spec: ModelSpecSchema,
  status: z.enum(['installed', 'available', 'downloading', 'broken', 'partial']),
  installPath: z.string(),
  files: z.array(z.object({ path: z.string(), present: z.boolean(), sizeBytes: z.number().nullable(), expectedBytes: z.number().nullable() })),
  checksumOk: z.boolean().nullable(),
  lastTest: z.object({ ok: z.boolean(), ms: z.number(), message: z.string(), at: z.string() }).nullable(),
  installedBytes: z.number(),
  downloadTaskId: z.string().nullable(),
  /** Hardware fit computed from the live hardware snapshot. */
  fit: z.object({ ok: z.boolean(), reasonKey: z.string().nullable(), params: z.record(z.string(), z.union([z.string(), z.number()])) }),
  /** Whether the download can be started from inside the app (single files over HTTPS). */
  downloadable: z.boolean(),
});
export type ModelStatusInfo = z.infer<typeof ModelStatusSchema>;

export const RuntimeStatusSchema = z.object({
  python: z.object({ path: z.string(), version: z.string(), source: z.string(), venvReady: z.boolean(), workerInstalled: z.boolean() }).nullable(),
  worker: z.object({ running: z.boolean(), version: z.string().nullable(), device: z.string().nullable(), capabilities: z.record(z.string(), z.object({ available: z.boolean(), reason: z.string().nullable() })) }).nullable(),
  workerSourceDir: z.string(),
  venvDir: z.string(),
  lastError: z.string().nullable(),
  setupTaskId: z.string().nullable(),
  extras: z.array(z.object({ id: z.string(), installed: z.boolean(), approxMb: z.number() })),
});
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

export const MaskKindSchema = z.enum(['blur', 'pixelate', 'box', 'custom']);
export const MaskShapeSchema = z.enum(['rect', 'ellipse']);
export const FaceSelectorSchema = z.union([z.enum(['all', 'largest', 'leftmost', 'rightmost', 'center']), z.number().int().min(0)]);

export const TimeRangeSchema = z.object({ startMs: z.number(), endMs: z.number() });

export const SubtitleFormatSchema = z.enum(['srt', 'vtt', 'ass']);

/** Typed shapes of task results produced by the phase-3 services (delivered through TaskInfo.result). */
export interface FaceTrackInfo {
  index: number;
  detections: number;
  startMs: number;
  endMs: number;
  meanArea: number;
  meanCenterX: number;
  meanScore: number;
  box: NormBoxInput;
}
export interface DetectFacesResult {
  clipId: string;
  sampleFps: number;
  framesAnalyzed: number;
  totalDetections: number;
  tracks: FaceTrackInfo[];
  /** Per sampled frame, boxes in sequence coordinates with timeline times. */
  frames: Array<{ tMs: number; boxes: Array<NormBoxInput & { score: number; track: number }> }>;
  analyzedFile: 'proxy' | 'source';
  durationMs: number;
}
export interface DetectObjectsResult {
  clipId: string;
  sampleFps: number;
  framesAnalyzed: number;
  labels: Array<{ label: string; count: number; maxScore: number }>;
  frames: Array<{ tMs: number; boxes: Array<NormBoxInput & { score: number; label: string }> }>;
  tracks: Array<{ index: number; label: string; startMs: number; endMs: number; detections: number; box: NormBoxInput }>;
}
export interface BlurFacesResult {
  clipId: string;
  masks: Array<{ maskId: string; trackIndex: number; startMs: number; endMs: number; keyframes: number; coverage: number; status: 'ok' | 'partial' }>;
  facesDetected: number;
  framesAnalyzed: number;
  sampleFps: number;
  skipped: Array<{ trackIndex: number; reason: 'too-short' | 'not-selected' }>;
}
export interface TrackTargetResult {
  clipId: string;
  maskId: string;
  status: 'ok' | 'partial' | 'lost';
  keyframes: number;
  coveredStartMs: number;
  coveredEndMs: number;
  requestedEndMs: number;
  lostRanges: Array<{ startMs: number; endMs: number }>;
}
export interface MaskVerificationResult {
  maskId: string;
  ok: boolean;
  samples: Array<{ tMs: number; before: number; after: number; ratio: number; ok: boolean }>;
  threshold: number;
  method: 'laplacian-variance' | 'block-mean-error';
}
export interface SilenceDetectionResult {
  method: 'vad' | 'silencedetect';
  ranges: Array<{ startMs: number; endMs: number }>;
  totalSilenceMs: number;
  durationMs: number;
  thresholdDb: number | null;
  minSilenceMs: number;
  speechMs: number;
}
export interface RemoveSilenceResult extends SilenceDetectionResult {
  cutRanges: Array<{ startMs: number; endMs: number }>;
  removedMs: number;
  beforeDurationMs: number;
  afterDurationMs: number;
  verified: boolean | null;
  remainingSilences: Array<{ startMs: number; endMs: number }>;
}
export interface LoudnessResult {
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDb: number | null;
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
  durationMs: number;
}
export interface EnhancePreviewResult {
  clipId: string;
  startMs: number;
  endMs: number;
  beforePath: string;
  afterPath: string;
  before: LoudnessResult;
  after: LoudnessResult;
  effects: string[];
}
export interface TranscribeResult {
  trackId: string;
  language: string;
  languageProbability: number;
  cues: number;
  durationMs: number;
  device: string;
  modelId: string;
  words: number;
  verification: { sorted: boolean; withinDuration: boolean; speechOverlap: number | null };
}
export interface OcrLine {
  text: string;
  confidence: number;
  box: NormBoxInput;
  language: 'ar' | 'en' | 'mixed' | 'unknown';
}
export interface OcrTrack {
  index: number;
  text: string;
  language: OcrLine['language'];
  startMs: number;
  endMs: number;
  box: NormBoxInput;
  confidence: number;
  frames: number;
}
export interface OcrResult {
  clipId: string;
  languages: string[];
  sampleFps: number;
  framesAnalyzed: number;
  frames: Array<{ tMs: number; lines: OcrLine[] }>;
  tracks: OcrTrack[];
  text: string;
}
export interface UpscaleResult {
  clipId: string;
  assetId: string;
  path: string;
  width: number;
  height: number;
  factor: number;
  method: 'lanczos' | 'ai';
  replaced: boolean;
}
export interface CompareRenderResult {
  startMs: number;
  endMs: number;
  beforePath: string;
  afterPath: string;
  bypassed: { effects: number; masks: number; audioEffects: number };
}
