import { z } from 'zod';
import type { AppErrorInfo } from '@sevenvid/core';
import {
  AppErrorInfoSchema,
  AppInfoSchema,
  AppSettingsSchema,
  CapabilityInfoSchema,
  CommandSchema,
  DirEntrySchema,
  HardwareSnapshotSchema,
  LogEntrySchema,
  NotificationSchema,
  ProjectKindSchema,
  ProjectSummarySchema,
  ProjectVersionSchema,
  RecoveryInfoSchema,
  SearchResultSchema,
  SessionStateSchema,
  TaskInfoSchema,
  TemplateInfoSchema,
  ExportInfoSchema,
  NetworkLogEntrySchema,
  AssetInfoSchema,
  AssetKindSchema,
  PlaybackCapabilitiesSchema,
  WaveformDataSchema,
  ExportSettingsInputSchema,
  ModelStatusSchema,
  RuntimeStatusSchema,
  NormBoxSchema,
  MaskKindSchema,
  MaskShapeSchema,
  FaceSelectorSchema,
  SubtitleFormatSchema,
} from './schemas';

const Void = z.void().or(z.undefined()).or(z.null());

/** Request/response channels. Every channel declares its input and output schema. */
export const channels = {
  'app.info': { input: Void, output: AppInfoSchema },
  'app.ping': { input: Void, output: z.object({ pong: z.literal(true), at: z.string() }) },
  'settings.get': { input: Void, output: AppSettingsSchema },
  'settings.update': { input: z.object({ patch: z.record(z.string(), z.unknown()) }), output: AppSettingsSchema },
  'settings.reset': { input: z.object({ section: z.string().nullable() }), output: AppSettingsSchema },
  'hardware.snapshot': { input: z.object({ refresh: z.boolean().optional() }).optional(), output: HardwareSnapshotSchema },
  'capabilities.get': { input: Void, output: z.record(z.string(), CapabilityInfoSchema) },
  'capabilities.refresh': { input: Void, output: z.record(z.string(), CapabilityInfoSchema) },
  'projects.list': { input: z.object({ includeDeleted: z.boolean().optional() }).optional(), output: z.array(ProjectSummarySchema) },
  'projects.recent': { input: z.object({ limit: z.number().optional() }).optional(), output: z.array(ProjectSummarySchema) },
  'projects.create': {
    input: z.object({
      name: z.string().min(1),
      kind: ProjectKindSchema.optional(),
      templateId: z.string().nullable().optional(),
      platformPreset: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      fps: z.number().optional(),
    }),
    output: ProjectSummarySchema,
  },
  'projects.get': { input: z.object({ projectId: z.string() }), output: ProjectSummarySchema },
  'projects.open': { input: z.object({ projectId: z.string() }), output: SessionStateSchema },
  'projects.close': { input: z.object({ projectId: z.string() }), output: z.object({ closed: z.boolean() }) },
  'projects.rename': { input: z.object({ projectId: z.string(), name: z.string().min(1) }), output: ProjectSummarySchema },
  'projects.duplicate': { input: z.object({ projectId: z.string(), name: z.string().optional() }), output: ProjectSummarySchema },
  'projects.delete': { input: z.object({ projectId: z.string(), permanent: z.boolean().optional() }), output: z.object({ deleted: z.boolean() }) },
  'projects.restoreDeleted': { input: z.object({ projectId: z.string() }), output: ProjectSummarySchema },
  'projects.versions.list': { input: z.object({ projectId: z.string() }), output: z.array(ProjectVersionSchema) },
  'projects.versions.create': { input: z.object({ projectId: z.string(), label: z.string() }), output: ProjectVersionSchema },
  'projects.versions.restore': { input: z.object({ projectId: z.string(), versionId: z.string() }), output: SessionStateSchema },
  'projects.recovery.check': { input: Void, output: z.array(RecoveryInfoSchema) },
  'projects.recovery.apply': { input: z.object({ projectId: z.string(), discard: z.boolean().optional() }), output: SessionStateSchema.nullable() },
  'session.state': { input: z.object({ projectId: z.string() }), output: SessionStateSchema },
  'session.command': { input: z.object({ projectId: z.string(), command: CommandSchema }), output: SessionStateSchema },
  'session.undo': { input: z.object({ projectId: z.string() }), output: SessionStateSchema },
  'session.redo': { input: z.object({ projectId: z.string() }), output: SessionStateSchema },
  'session.save': { input: z.object({ projectId: z.string(), label: z.string().optional() }), output: SessionStateSchema },
  'session.validate': {
    input: z.object({ projectId: z.string() }),
    output: z.object({ ok: z.boolean(), errors: z.number(), warnings: z.number(), issues: z.array(z.record(z.string(), z.unknown())) }),
  },
  'tasks.list': { input: z.object({ projectId: z.string().nullable().optional(), includeFinished: z.boolean().optional(), limit: z.number().optional() }).optional(), output: z.array(TaskInfoSchema) },
  'tasks.get': { input: z.object({ taskId: z.string() }), output: TaskInfoSchema.nullable() },
  'tasks.cancel': { input: z.object({ taskId: z.string() }), output: TaskInfoSchema },
  'tasks.pause': { input: z.object({ taskId: z.string() }), output: TaskInfoSchema },
  'tasks.resume': { input: z.object({ taskId: z.string() }), output: TaskInfoSchema },
  'tasks.retry': { input: z.object({ taskId: z.string() }), output: TaskInfoSchema },
  'tasks.setPriority': { input: z.object({ taskId: z.string(), priority: z.number() }), output: TaskInfoSchema },
  'tasks.clearFinished': { input: Void, output: z.object({ removed: z.number() }) },
  'search.query': { input: z.object({ q: z.string(), types: z.array(z.string()).optional(), limit: z.number().optional() }), output: z.array(SearchResultSchema) },
  'logs.tail': { input: z.object({ limit: z.number().optional(), level: z.string().optional(), module: z.string().optional(), errorId: z.string().optional() }).optional(), output: z.array(LogEntrySchema) },
  'diagnostics.exportBundle': { input: z.object({ targetDir: z.string().nullable().optional() }).optional(), output: z.object({ path: z.string(), sizeBytes: z.number() }) },
  'errors.recent': { input: z.object({ limit: z.number().optional() }).optional(), output: z.array(AppErrorInfoSchema) },
  'notifications.recent': { input: z.object({ limit: z.number().optional() }).optional(), output: z.array(NotificationSchema) },
  'fs.listDir': { input: z.object({ path: z.string().nullable(), mediaOnly: z.boolean().optional() }), output: z.object({ path: z.string(), parent: z.string().nullable(), entries: z.array(DirEntrySchema) }) },
  'fs.roots': { input: Void, output: z.array(z.object({ label: z.string(), path: z.string() })) },
  'fs.exists': { input: z.object({ path: z.string() }), output: z.object({ exists: z.boolean(), isDirectory: z.boolean() }) },
  'dialog.pickFiles': {
    input: z.object({ kind: z.enum(['media', 'video', 'image', 'audio', 'subtitle', 'any']), multiple: z.boolean().optional(), title: z.string().optional() }),
    output: z.object({ paths: z.array(z.string()), native: z.boolean() }),
  },
  'dialog.pickDirectory': { input: z.object({ title: z.string().optional() }), output: z.object({ path: z.string().nullable(), native: z.boolean() }) },
  'dialog.saveFile': { input: z.object({ defaultPath: z.string().optional(), filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })).optional() }), output: z.object({ path: z.string().nullable(), native: z.boolean() }) },
  'shell.openPath': { input: z.object({ path: z.string() }), output: z.object({ ok: z.boolean(), error: z.string().nullable() }) },
  'shell.showInFolder': { input: z.object({ path: z.string() }), output: z.object({ ok: z.boolean() }) },
  'shell.openExternal': { input: z.object({ url: z.string().url() }), output: z.object({ ok: z.boolean(), blocked: z.boolean() }) },
  'app.quit': { input: Void, output: z.object({ ok: z.boolean() }) },
  'templates.list': { input: Void, output: z.array(TemplateInfoSchema) },
  'templates.delete': { input: z.object({ templateId: z.string() }), output: z.object({ deleted: z.boolean() }) },
  'templates.saveFromProject': { input: z.object({ projectId: z.string(), name: z.string().min(1), category: z.string().optional() }), output: TemplateInfoSchema },
  'exports.list': { input: z.object({ projectId: z.string().optional(), limit: z.number().optional() }).optional(), output: z.array(ExportInfoSchema) },
  'network.recent': { input: z.object({ limit: z.number().optional() }).optional(), output: z.array(NetworkLogEntrySchema) },
  'media.import': { input: z.object({ paths: z.array(z.string()).min(1), projectId: z.string().nullable() }), output: z.object({ assets: z.array(AssetInfoSchema), skipped: z.array(z.object({ path: z.string(), reason: z.enum(['not-found', 'unsupported', 'duplicate']) })) }) },
  'media.list': { input: z.object({ projectId: z.string().nullable().optional(), includeLibrary: z.boolean().optional(), kind: z.union([AssetKindSchema, z.array(AssetKindSchema)]).optional(), favorite: z.boolean().optional(), query: z.string().optional() }).optional(), output: z.array(AssetInfoSchema) },
  'media.get': { input: z.object({ assetId: z.string() }), output: AssetInfoSchema.nullable() },
  'media.update': { input: z.object({ assetId: z.string(), patch: z.object({ name: z.string().optional(), tags: z.array(z.string()).optional(), favorite: z.boolean().optional() }) }), output: AssetInfoSchema },
  'media.remove': { input: z.object({ assetId: z.string(), deleteCache: z.boolean().optional() }), output: z.object({ removed: z.boolean() }) },
  'media.relink': { input: z.object({ assetId: z.string(), path: z.string() }), output: TaskInfoSchema },
  'media.reanalyze': { input: z.object({ assetId: z.string() }), output: TaskInfoSchema },
  'media.waveform': { input: z.object({ assetId: z.string() }), output: WaveformDataSchema.nullable() },
  'media.url': { input: z.object({ path: z.string() }), output: z.object({ url: z.string().nullable() }) },
  'media.setPlaybackCapabilities': { input: PlaybackCapabilitiesSchema, output: z.object({ ok: z.boolean() }) },
  'media.addToTimeline': { input: z.object({ projectId: z.string(), assetId: z.string(), trackId: z.string().nullable().optional(), atMs: z.number().nullable().optional(), mode: z.enum(['overwrite', 'insert']).optional(), durationMs: z.number().nullable().optional() }), output: SessionStateSchema },
  'export.start': { input: z.object({ projectId: z.string(), settings: ExportSettingsInputSchema, outputPath: z.string().nullable().optional(), fileName: z.string().nullable().optional() }), output: ExportInfoSchema },
  'export.get': { input: z.object({ exportId: z.string() }), output: ExportInfoSchema.nullable() },
  'export.encoders': { input: z.object({ verify: z.boolean().optional() }).optional(), output: z.object({ available: z.array(z.string()), hardware: z.array(z.string()), verified: z.record(z.string(), z.object({ ok: z.boolean(), error: z.string().nullable(), ms: z.number() })) }) },
  'render.previewRange': { input: z.object({ projectId: z.string(), startMs: z.number(), endMs: z.number() }), output: TaskInfoSchema },
  'render.extractFrame': { input: z.object({ projectId: z.string(), tMs: z.number() }), output: TaskInfoSchema },
  'render.compare': { input: z.object({ projectId: z.string(), startMs: z.number(), endMs: z.number() }), output: TaskInfoSchema },
  // ---- models & runtime ----
  'models.list': { input: Void, output: z.array(ModelStatusSchema) },
  'models.get': { input: z.object({ modelId: z.string() }), output: ModelStatusSchema },
  'models.download': { input: z.object({ modelId: z.string() }), output: TaskInfoSchema },
  'models.remove': { input: z.object({ modelId: z.string() }), output: z.object({ removed: z.boolean() }) },
  'models.test': { input: z.object({ modelId: z.string() }), output: z.object({ ok: z.boolean(), ms: z.number(), message: z.string() }) },
  'runtime.status': { input: z.object({ probe: z.boolean().optional() }).optional(), output: RuntimeStatusSchema },
  'runtime.setup': { input: z.object({ extras: z.array(z.string()) }), output: TaskInfoSchema },
  'runtime.restart': { input: Void, output: RuntimeStatusSchema },
  // ---- vision / privacy ----
  'vision.detectFaces': { input: z.object({ projectId: z.string(), clipId: z.string(), sampleFps: z.number().optional() }), output: TaskInfoSchema },
  'vision.detectObjects': { input: z.object({ projectId: z.string(), clipId: z.string(), sampleFps: z.number().optional(), categories: z.array(z.string()).optional() }), output: TaskInfoSchema },
  'vision.blurFaces': { input: z.object({ projectId: z.string(), clipId: z.string(), kind: MaskKindSchema.optional(), shape: MaskShapeSchema.optional(), strength: z.number().optional(), selector: FaceSelectorSchema.optional(), sampleFps: z.number().optional() }), output: TaskInfoSchema },
  'vision.trackTarget': { input: z.object({ projectId: z.string(), clipId: z.string(), box: NormBoxSchema, startMs: z.number().optional(), endMs: z.number().optional(), kind: MaskKindSchema.optional(), shape: MaskShapeSchema.optional(), strength: z.number().optional(), detector: z.enum(['face']).nullable().optional(), label: z.string().optional() }), output: TaskInfoSchema },
  'vision.verifyMask': { input: z.object({ projectId: z.string(), maskId: z.string() }), output: TaskInfoSchema },
  'analysis.get': { input: z.object({ projectId: z.string(), clipId: z.string(), kind: z.enum(['faces', 'objects', 'ocr']) }), output: z.unknown().nullable() },
  // ---- audio ----
  'audio.detectSilence': { input: z.object({ projectId: z.string(), startMs: z.number().optional(), endMs: z.number().optional(), thresholdDb: z.number().optional(), minSilenceMs: z.number().optional(), method: z.enum(['auto', 'vad', 'silencedetect']).optional() }), output: TaskInfoSchema },
  'audio.removeSilence': { input: z.object({ projectId: z.string(), startMs: z.number().optional(), endMs: z.number().optional(), thresholdDb: z.number().optional(), minSilenceMs: z.number().optional(), paddingMs: z.number().optional(), method: z.enum(['auto', 'vad', 'silencedetect']).optional(), verify: z.boolean().optional() }), output: TaskInfoSchema },
  'audio.measure': { input: z.object({ projectId: z.string(), startMs: z.number().optional(), endMs: z.number().optional() }), output: TaskInfoSchema },
  'audio.applyPreset': { input: z.object({ projectId: z.string(), clipIds: z.array(z.string()).min(1), presetId: z.string() }), output: SessionStateSchema },
  'audio.previewEnhance': { input: z.object({ projectId: z.string(), clipId: z.string(), startMs: z.number().optional(), endMs: z.number().optional() }), output: TaskInfoSchema },
  // ---- subtitles ----
  'subtitles.transcribe': { input: z.object({ projectId: z.string(), clipId: z.string().nullable().optional(), language: z.enum(['auto', 'ar', 'en']).optional(), modelId: z.string().optional() }), output: TaskInfoSchema },
  'subtitles.import': { input: z.object({ projectId: z.string(), path: z.string(), language: z.string().optional() }), output: SessionStateSchema },
  'subtitles.export': { input: z.object({ projectId: z.string(), trackId: z.string(), format: SubtitleFormatSchema, outputPath: z.string().nullable().optional() }), output: z.object({ path: z.string(), cues: z.number() }) },
  // ---- OCR / text ----
  'ocr.detect': { input: z.object({ projectId: z.string(), clipId: z.string(), languages: z.array(z.enum(['ar', 'en'])).optional(), sampleFps: z.number().optional() }), output: TaskInfoSchema },
  'ocr.createMasks': { input: z.object({ projectId: z.string(), clipId: z.string(), kind: MaskKindSchema.optional(), trackIndexes: z.array(z.number()).optional() }), output: SessionStateSchema },
  // ---- enhancement ----
  'enhance.upscale': { input: z.object({ projectId: z.string(), clipId: z.string(), factor: z.union([z.literal(2), z.literal(4)]).optional(), method: z.enum(['lanczos', 'ai']).optional(), replaceClip: z.boolean().optional() }), output: TaskInfoSchema },
} as const;

/** Push events from the engine to the UI. */
export const events = {
  'task.updated': TaskInfoSchema,
  'task.progress': z.object({ taskId: z.string(), progress: z.number(), message: z.string().nullable(), etaMs: z.number().nullable() }),
  'session.updated': z.object({ projectId: z.string(), state: SessionStateSchema, origin: z.enum(['command', 'undo', 'redo', 'ai', 'restore', 'save', 'external']) }),
  'session.closed': z.object({ projectId: z.string() }),
  'capabilities.updated': z.record(z.string(), CapabilityInfoSchema),
  'hardware.updated': HardwareSnapshotSchema,
  'settings.updated': AppSettingsSchema,
  'error': AppErrorInfoSchema,
  'notification': NotificationSchema,
  'log': LogEntrySchema,
  'projects.changed': z.object({ projectId: z.string().nullable(), reason: z.string() }),
  'recovery.available': z.array(RecoveryInfoSchema),
  'models.changed': z.object({ modelId: z.string() }),
  'assets.changed': z.object({ projectId: z.string().nullable(), assetId: z.string(), reason: z.enum(['imported', 'analyzed', 'proxy', 'updated', 'removed', 'relinked']) }),
  'exports.changed': z.object({ exportId: z.string(), status: z.string() }),
} as const;

export type ChannelMap = typeof channels;
export type ChannelName = keyof ChannelMap;
export type ChannelInput<C extends ChannelName> = z.input<ChannelMap[C]['input']>;
export type ChannelOutput<C extends ChannelName> = z.output<ChannelMap[C]['output']>;

export type EventMap = typeof events;
export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = z.output<EventMap[E]>;

export type ApiHandler<C extends ChannelName> = (input: ChannelInput<C>) => Promise<ChannelOutput<C>> | ChannelOutput<C>;
export type ApiHandlers = { [C in ChannelName]: ApiHandler<C> };

/** The single API surface exposed to the renderer (preload in Electron, WebSocket client in browser mode). */
export interface SevenvidApi {
  readonly mode: 'electron' | 'browser';
  invoke<C extends ChannelName>(channel: C, input?: ChannelInput<C>): Promise<ChannelOutput<C>>;
  subscribe<E extends EventName>(event: E, handler: (payload: EventPayload<E>) => void): () => void;
}

export type IpcResponse<T> = { ok: true; data: T } | { ok: false; error: AppErrorInfo };

export function isChannel(name: string): name is ChannelName {
  return Object.prototype.hasOwnProperty.call(channels, name);
}

export function isEvent(name: string): name is EventName {
  return Object.prototype.hasOwnProperty.call(events, name);
}
