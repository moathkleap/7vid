import fs from 'node:fs';
import path from 'node:path';
import { getExportPreset, newId, validateDocument, type ExportSettings, type ProjectDocument } from '@sevenvid/core';
import type { ExportInfo } from '@sevenvid/ipc';
import type { AppDatabase } from '../db/database';
import { AppError } from '../errors';
import type { EventBus } from '../events/EventBus';
import type { FfmpegLocation } from '../ffmpeg/locator';
import { runFfmpeg } from '../ffmpeg/runner';
import type { Logger } from '../logging/logger';
import type { AppPaths } from '../paths/AppPaths';
import type { ProjectService } from '../project/ProjectService';
import type { SessionManager } from '../project/SessionManager';
import { buildFfmpegArgs, compileRenderGraph, outputSizeFilters, type CompileOptions } from '../render/RenderGraphCompiler';
import type { SettingsService } from '../settings/SettingsService';
import { toAss } from '../subtitles/writers';
import type { TaskManager } from '../tasks/TaskManager';
import { chooseEncoders, EncoderProbe } from './encoders';
import { validateRenderedFile, type ExportValidation } from './validate';

export interface ExportRequest {
  projectId: string;
  settings: Partial<ExportSettings> & { presetId?: ExportSettings['presetId'] };
  outputPath?: string | null;
  fileName?: string | null;
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'export';
}

export class ExportService {
  readonly encoderProbe: EncoderProbe;

  constructor(
    private readonly db: AppDatabase,
    private readonly paths: AppPaths,
    private readonly ffmpeg: FfmpegLocation,
    private readonly tasks: TaskManager,
    private readonly projects: ProjectService,
    private readonly sessions: SessionManager,
    private readonly settings: SettingsService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {
    this.encoderProbe = new EncoderProbe(ffmpeg);
    tasks.registerKind<{ exportId: string }, ExportValidation>({
      kind: 'render.export',
      lane: 'render',
      pausable: true,
      title: (p) => `Export ${path.basename(db.exports.get(p.exportId)?.outputPath ?? p.exportId)}`,
      run: (ctx) => this.runExport(ctx.params.exportId, ctx),
    });
  }

  resolveSettings(input: ExportRequest['settings']): ExportSettings {
    const base = getExportPreset(input.presetId ?? 'youtube-1080p').settings;
    return { ...base, ...input, presetId: input.presetId ?? base.presetId };
  }

  /** Creates the export record and queues the render task. */
  start(req: ExportRequest): ExportInfo {
    if (!this.ffmpeg.ffmpeg || !this.ffmpeg.ffprobe) throw new AppError({ code: 'FFMPEG_NOT_FOUND', operation: 'export.start', message: 'FFmpeg is required to export' });
    const project = this.projects.get(req.projectId);
    const doc = this.loadDocument(req.projectId);
    const report = validateDocument(doc);
    if (!report.ok) throw new AppError({ code: 'VALIDATION_FAILED', operation: 'export.start', message: `Timeline has ${report.errors} validation error(s): ${report.issues.filter((i) => i.severity === 'error').map((i) => i.message).slice(0, 3).join('; ')}`, details: { issues: report.issues } });
    if (doc.tracks.every((t) => t.clips.length === 0)) throw new AppError({ code: 'VALIDATION_FAILED', operation: 'export.start', message: 'The timeline is empty; nothing to export' });
    const settings = this.resolveSettings(req.settings);
    const dir = req.outputPath ? path.dirname(req.outputPath) : (this.settings.get().storage.exportsDir ?? this.paths.exports);
    const ext = settings.container === 'webm' ? 'webm' : settings.container === 'mov' ? 'mov' : 'mp4';
    const file = req.outputPath ?? path.join(dir, `${safeName(req.fileName ?? project.name)}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const free = safeFreeSpace(path.dirname(file));
    if (free != null && free < 200 * 1024 * 1024) throw new AppError({ code: 'DISK_FULL', operation: 'export.start', message: `Only ${Math.round(free / 1048576)} MB free at ${path.dirname(file)}`, details: { free } });
    const row = this.db.exports.insert({ id: newId('exp'), projectId: req.projectId, taskId: null, presetId: settings.presetId, settings: settings as unknown as Record<string, unknown>, outputPath: file, status: 'queued' });
    const task = this.tasks.enqueue({ kind: 'render.export', params: { exportId: row.id }, projectId: req.projectId, priority: 1 });
    const updated = this.db.exports.update(row.id, { taskId: task.id })!;
    this.bus.emit('exports.changed', { exportId: row.id, status: 'queued' });
    return updated;
  }

  get(exportId: string): ExportInfo | undefined {
    return this.db.exports.get(exportId);
  }

  private loadDocument(projectId: string): ProjectDocument {
    return this.sessions.isOpen(projectId) ? this.sessions.get(projectId).document : this.projects.loadLatestDocument(projectId);
  }

  /** Renders a document range to a file (shared by export and preview renders). */
  async render(doc: ProjectDocument, outputPath: string, settings: ExportSettings, opts: { range?: CompileOptions['range']; usePreviewQuality?: boolean; pathOverrides?: Record<string, string>; signal?: AbortSignal; onProgress?: (ratio: number, message: string | null) => void; onProcess?: Parameters<typeof runFfmpeg>[0]['onProcess']; scratchDir: string; clipVideoFilters?: CompileOptions['clipVideoFilters']; finalVideoFilters?: string[]; finalAudioFilters?: string[]; bypass?: CompileOptions['bypass'] }): Promise<{ durationMs: number; warnings: string[]; encoder: string; masksApplied: number }> {
    const ffmpeg = this.ffmpeg.ffmpeg!;
    fs.mkdirSync(opts.scratchDir, { recursive: true });
    const seq = doc.settings;
    const target = { width: seq.width, height: seq.height, fps: settings.fps ?? seq.fps, sampleRate: seq.sampleRate, channels: seq.channels };
    let subtitlesAssPath: string | null = null;
    if (settings.burnSubtitles) {
      const track = doc.subtitles.find((s) => s.enabled && s.burnIn && s.cues.length > 0);
      if (track) {
        subtitlesAssPath = path.join(opts.scratchDir, `subtitles-${track.id}.ass`);
        fs.writeFileSync(subtitlesAssPath, toAss(track, seq), 'utf8');
      }
    }
    const outputSize = settings.width && settings.height && (settings.width !== seq.width || settings.height !== seq.height) ? { width: settings.width, height: settings.height } : null;
    const finalVideoFilters = [...(opts.finalVideoFilters ?? []), ...(outputSize ? outputSizeFilters(outputSize.width, outputSize.height) : [])];
    const graph = compileRenderGraph({ doc, target, range: opts.range ?? null, pathOverrides: opts.pathOverrides, subtitlesAssPath, fontsDir: fs.existsSync(path.join(this.paths.resources, 'fonts')) ? path.join(this.paths.resources, 'fonts') : null, clipVideoFilters: opts.clipVideoFilters, finalVideoFilters, finalAudioFilters: opts.finalAudioFilters, masks: { scratchDir: opts.scratchDir }, bypass: opts.bypass });
    const scriptPath = path.join(opts.scratchDir, `filter-${newId()}.txt`);
    fs.writeFileSync(scriptPath, graph.filterScript, 'utf8');
    const preferHw = this.settings.get().gpu.preferHardwareEncoding && !opts.usePreviewQuality;
    const enc = opts.usePreviewQuality
      ? { videoEncoder: 'libx264', videoArgs: ['-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p'], audioEncoder: 'aac', audioArgs: ['-b:a', '96k'], hardware: false }
      : chooseEncoders(this.ffmpeg, this.encoderProbe, settings, preferHw);
    const args = buildFfmpegArgs(graph, scriptPath, { ...enc, container: settings.container, fps: target.fps, threads: this.settings.get().performance.ffmpegThreads }, outputPath);
    try {
      await runFfmpeg({ ffmpeg, args, logger: this.logger, signal: opts.signal, expectDurationMs: graph.durationMs, onProgress: (p) => opts.onProgress?.(p.ratio ?? 0, p.fps ? `${Math.round(p.fps)} fps · ${p.speed ? p.speed.toFixed(2) + 'x' : ''}`.trim() : null), onProcess: opts.onProcess, operation: 'render' });
    } catch (err) {
      if (enc.hardware && !opts.signal?.aborted) {
        this.logger.warn({ operation: 'render', encoder: enc.videoEncoder, err }, 'hardware encoder failed at render time; retrying with software encoder');
        const sw = chooseEncoders(this.ffmpeg, this.encoderProbe, { ...settings, hardwareAcceleration: 'off' }, false);
        const swArgs = buildFfmpegArgs(graph, scriptPath, { ...sw, container: settings.container, fps: target.fps, threads: this.settings.get().performance.ffmpegThreads }, outputPath);
        await runFfmpeg({ ffmpeg, args: swArgs, logger: this.logger, signal: opts.signal, expectDurationMs: graph.durationMs, onProgress: (p) => opts.onProgress?.(p.ratio ?? 0, null), onProcess: opts.onProcess, operation: 'render' });
        return { durationMs: graph.durationMs, warnings: [...graph.warnings, `hardware encoder ${enc.videoEncoder} failed; used ${sw.videoEncoder}`], encoder: sw.videoEncoder, masksApplied: graph.masksApplied };
      }
      throw err;
    } finally {
      fs.rmSync(scriptPath, { force: true });
      for (const f of graph.tempFiles) fs.rmSync(f, { force: true });
    }
    return { durationMs: graph.durationMs, warnings: graph.warnings, encoder: enc.videoEncoder, masksApplied: graph.masksApplied };
  }

  private async runExport(exportId: string, ctx: { progress: (v: number, m?: string | null) => void; signal: AbortSignal; setPauseHandlers: (h: { pause: () => void; resume: () => void } | null) => void }): Promise<ExportValidation> {
    const row = this.db.exports.get(exportId);
    if (!row) throw new AppError({ code: 'INVALID_INPUT', operation: 'render.export', message: `Export ${exportId} not found` });
    const settings = row.settings as unknown as ExportSettings;
    const doc = this.loadDocument(row.projectId!);
    this.db.exports.update(exportId, { status: 'running' });
    this.bus.emit('exports.changed', { exportId, status: 'running' });
    const project = this.projects.get(row.projectId!);
    const t0 = Date.now();
    try {
      const rendered = await this.render(doc, row.outputPath, settings, {
        signal: ctx.signal,
        scratchDir: path.join(project.dataDir, 'cache', 'render'),
        onProgress: (ratio, message) => ctx.progress(Math.min(0.95, ratio * 0.95), message),
        onProcess: (_proc, controls) => ctx.setPauseHandlers({ pause: () => void controls.pause(), resume: () => void controls.resume() }),
      });
      ctx.setPauseHandlers(null);
      this.db.exports.update(exportId, { status: 'validating' });
      this.bus.emit('exports.changed', { exportId, status: 'validating' });
      ctx.progress(0.96, 'validating');
      const expectSize = settings.width && settings.height ? { width: settings.width, height: settings.height } : { width: doc.settings.width, height: doc.settings.height };
      const validation = await validateRenderedFile(this.ffmpeg.ffmpeg!, this.ffmpeg.ffprobe!, row.outputPath, { durationMs: rendered.durationMs, width: expectSize.width, height: expectSize.height, fps: settings.fps ?? doc.settings.fps }, { signal: ctx.signal, decode: this.settings.get().export.validateAfterExport });
      const result = { ...validation, warnings: rendered.warnings, encoder: rendered.encoder } as ExportValidation & { warnings: string[]; encoder: string };
      if (!validation.ok) {
        const failed = validation.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ');
        const err = new AppError({ code: 'EXPORT_VALIDATION_FAILED', operation: 'render.export', message: `Exported file failed validation: ${failed}`, details: { exportId, validation } });
        this.db.exports.update(exportId, { status: 'failed', validation: result as unknown as Record<string, unknown>, error: err.info, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, sizeBytes: validation.sizeBytes });
        this.bus.emit('exports.changed', { exportId, status: 'failed' });
        throw err;
      }
      this.db.exports.update(exportId, { status: 'done', validation: result as unknown as Record<string, unknown>, sizeBytes: validation.sizeBytes, durationMs: Date.now() - t0, finishedAt: new Date().toISOString() });
      this.bus.emit('exports.changed', { exportId, status: 'done' });
      ctx.progress(1, null);
      this.logger.info({ operation: 'export', exportId, file: row.outputPath, durationMs: Date.now() - t0, encoder: rendered.encoder, status: 'done' }, 'export complete');
      return validation;
    } catch (err) {
      const appErr = AppError.from(err, { code: 'RENDER_FAILED', operation: 'render.export', details: { exportId } });
      const cancelled = ctx.signal.aborted || appErr.info.code === 'TASK_CANCELLED';
      this.db.exports.update(exportId, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? null : appErr.info, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0 });
      this.bus.emit('exports.changed', { exportId, status: cancelled ? 'cancelled' : 'failed' });
      if (cancelled || appErr.info.code === 'RENDER_FAILED' || appErr.info.code === 'FFMPEG_FAILED') {
        try {
          if (fs.existsSync(row.outputPath) && !cancelled) fs.renameSync(row.outputPath, `${row.outputPath}.failed`);
          else if (cancelled) fs.rmSync(row.outputPath, { force: true });
        } catch {
          /* ignore */
        }
      }
      throw appErr;
    }
  }
}

function safeFreeSpace(dir: string): number | null {
  try {
    const st = fs.statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return null;
  }
}
