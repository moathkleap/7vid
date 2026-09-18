import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { frameDurationMs, getExportPreset, type ProjectDocument } from '@sevenvid/core';
import { runFfmpeg } from '../ffmpeg/runner';
import { compileRenderGraph, type CompileOptions } from './RenderGraphCompiler';
import type { FfmpegLocation } from '../ffmpeg/locator';
import type { CompareRenderResult, TaskInfo } from '@sevenvid/ipc';
import { AppError } from '../errors';
import type { ExportService } from '../export/ExportService';
import type { Logger } from '../logging/logger';
import type { AppPaths } from '../paths/AppPaths';
import type { ProjectService } from '../project/ProjectService';
import type { SessionManager } from '../project/SessionManager';
import type { TaskManager } from '../tasks/TaskManager';

export interface PreviewRenderResult {
  path: string;
  startMs: number;
  endMs: number;
  hash: string;
}

export interface RenderFrameOptions {
  bypass?: CompileOptions['bypass'];
  /** Render masks (default true). */
  masks?: boolean;
  signal?: AbortSignal;
  /** Output file (.png or .jpg); defaults to a temp file in the scratch dir. */
  out?: string;
}

/** Renders a timeline range at proxy quality into the project cache (used for effects the live preview cannot show). */
export class PreviewRenderService {
  constructor(
    private readonly paths: AppPaths,
    private readonly ffmpeg: FfmpegLocation,
    private readonly tasks: TaskManager,
    private readonly projects: ProjectService,
    private readonly sessions: SessionManager,
    private readonly exports: ExportService,
    private readonly logger: Logger,
  ) {
    tasks.registerKind<{ projectId: string; startMs: number; endMs: number }, PreviewRenderResult>({
      kind: 'render.preview',
      lane: 'render',
      title: () => 'Render preview',
      run: async (ctx) => this.run(ctx.params, ctx),
    });
    tasks.registerKind<{ projectId: string; tMs: number }, { path: string }>({
      kind: 'render.frame',
      lane: 'render',
      title: () => 'Extract frame',
      run: async (ctx) => this.extractFrame(ctx.params.projectId, ctx.params.tMs, ctx.signal),
    });
    tasks.registerKind<{ projectId: string; startMs: number; endMs: number }, CompareRenderResult>({
      kind: 'render.compare',
      lane: 'render',
      title: () => 'Render before/after comparison',
      run: async (ctx) => this.compare(ctx.params, ctx),
    });
  }

  loadDocument(projectId: string): ProjectDocument {
    return this.sessions.isOpen(projectId) ? this.sessions.get(projectId).document : this.projects.loadLatestDocument(projectId);
  }

  scratchDir(projectId: string): string {
    const dir = path.join(this.projects.get(projectId).dataDir, 'cache', 'render');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  extractFrameTask(projectId: string, tMs: number): TaskInfo {
    this.projects.get(projectId);
    return this.tasks.enqueue({ kind: 'render.frame', params: { projectId, tMs }, projectId, priority: 4 });
  }

  compareTask(projectId: string, startMs: number, endMs: number): TaskInfo {
    if (!(endMs > startMs)) throw new AppError({ code: 'INVALID_INPUT', operation: 'render.compare', message: 'Invalid range' });
    this.projects.get(projectId);
    return this.tasks.enqueue({ kind: 'render.compare', params: { projectId, startMs, endMs }, projectId, priority: 3 });
  }

  /**
   * Renders the fully composited frame at `tMs` (all tracks, transforms, effects, masks) to an image file.
   * Shared by frame extraction, mask verification and before/after comparisons.
   */
  async renderFrame(doc: ProjectDocument, projectId: string, tMs: number, opts: RenderFrameOptions = {}): Promise<string> {
    if (!this.ffmpeg.ffmpeg) throw new AppError({ code: 'FFMPEG_NOT_FOUND', operation: 'render.frame', message: 'FFmpeg is required' });
    const frame = frameDurationMs(doc.settings.fps);
    const target = { width: doc.settings.width, height: doc.settings.height, fps: doc.settings.fps, sampleRate: doc.settings.sampleRate, channels: doc.settings.channels };
    const scratch = this.scratchDir(projectId);
    const graph = compileRenderGraph({ doc, target, range: { startMs: Math.max(0, tMs), endMs: Math.max(0, tMs) + Math.max(frame * 2, 100) }, masks: opts.masks === false ? null : { scratchDir: scratch }, bypass: opts.bypass, videoOnly: true });
    const script = path.join(scratch, `frame-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`);
    fs.writeFileSync(script, graph.filterScript, 'utf8');
    const out = opts.out ?? path.join(scratch, `frame-${Math.round(tMs)}-${Math.random().toString(36).slice(2, 7)}.png`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const args: string[] = [];
    for (const input of graph.inputs) args.push(...input.args, '-i', input.path);
    args.push('-filter_complex_script', script, '-map', graph.videoLabel!, '-frames:v', '1', '-update', '1', '-f', 'image2', out);
    try {
      await runFfmpeg({ ffmpeg: this.ffmpeg.ffmpeg, args, signal: opts.signal, operation: 'render.frame', logger: this.logger });
    } finally {
      fs.rmSync(script, { force: true });
      for (const f of graph.tempFiles) fs.rmSync(f, { force: true });
    }
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new AppError({ code: 'RENDER_FAILED', operation: 'render.frame', message: 'Frame file was not produced' });
    return out;
  }

  /** Extracts the composited frame at `tMs` into the exports folder (user-facing "extract frame"). */
  async extractFrame(projectId: string, tMs: number, signal?: AbortSignal): Promise<{ path: string }> {
    const doc = this.loadDocument(projectId);
    const project = this.projects.get(projectId);
    const dir = this.paths.exports;
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${project.name.replace(/[\\/:*?"<>|]+/g, '-')}-frame-${Math.round(tMs)}ms.png`);
    await this.renderFrame(doc, projectId, tMs, { signal, out });
    return { path: out };
  }

  renderRange(projectId: string, startMs: number, endMs: number): TaskInfo {
    if (!(endMs > startMs)) throw new AppError({ code: 'INVALID_INPUT', operation: 'render.previewRange', message: 'Invalid range' });
    this.projects.get(projectId);
    return this.tasks.enqueue({ kind: 'render.preview', params: { projectId, startMs, endMs }, projectId, priority: 3 });
  }

  private previewSettings() {
    const preset = getExportPreset('web-small').settings;
    return { ...preset, container: 'mp4' as const, videoCodec: 'h264' as const, audioCodec: 'aac' as const, width: null, height: null, fps: null, burnSubtitles: true };
  }

  private proxyOverrides(doc: ProjectDocument): Record<string, string> {
    const pathOverrides: Record<string, string> = {};
    for (const a of Object.values(doc.assets)) if (a.proxyPath && fs.existsSync(a.proxyPath)) pathOverrides[a.id] = a.proxyPath;
    return pathOverrides;
  }

  private async run(p: { projectId: string; startMs: number; endMs: number }, ctx: { progress: (v: number, m?: string | null) => void; signal: AbortSignal }): Promise<PreviewRenderResult> {
    const doc = this.loadDocument(p.projectId);
    const project = this.projects.get(p.projectId);
    const hash = crypto.createHash('sha1').update(JSON.stringify({ tracks: doc.tracks, masks: doc.masks, subtitles: doc.subtitles, master: doc.master, settings: doc.settings, range: [p.startMs, p.endMs] })).digest('hex').slice(0, 16);
    const dir = path.join(project.dataDir, 'cache', 'preview');
    const out = path.join(dir, `${hash}.mp4`);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return { path: out, startMs: p.startMs, endMs: p.endMs, hash };
    fs.mkdirSync(dir, { recursive: true });
    await this.exports.render(doc, out, this.previewSettings(), { range: { startMs: p.startMs, endMs: p.endMs }, usePreviewQuality: true, pathOverrides: this.proxyOverrides(doc), signal: ctx.signal, scratchDir: this.scratchDir(p.projectId), onProgress: (r, m) => ctx.progress(r, m) });
    this.logger.info({ operation: 'preview', projectId: p.projectId, hash, ms: p.endMs - p.startMs }, 'preview rendered');
    return { path: out, startMs: p.startMs, endMs: p.endMs, hash };
  }

  /** Renders the same range twice: with every effect/mask bypassed and with the full document. */
  private async compare(p: { projectId: string; startMs: number; endMs: number }, ctx: { progress: (v: number, m?: string | null) => void; signal: AbortSignal }): Promise<CompareRenderResult> {
    const doc = this.loadDocument(p.projectId);
    const project = this.projects.get(p.projectId);
    const dir = path.join(project.dataDir, 'cache', 'compare');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = Date.now().toString(36);
    const before = path.join(dir, `${stamp}-before.mp4`);
    const after = path.join(dir, `${stamp}-after.mp4`);
    const common = { range: { startMs: p.startMs, endMs: p.endMs }, usePreviewQuality: true, pathOverrides: this.proxyOverrides(doc), signal: ctx.signal, scratchDir: this.scratchDir(p.projectId) };
    await this.exports.render(doc, before, this.previewSettings(), { ...common, bypass: { videoEffects: true, audioEffects: true, masks: true }, onProgress: (r, m) => ctx.progress(r * 0.5, m) });
    await this.exports.render(doc, after, this.previewSettings(), { ...common, onProgress: (r, m) => ctx.progress(0.5 + r * 0.5, m) });
    const clips = doc.tracks.flatMap((t) => t.clips);
    return {
      startMs: p.startMs,
      endMs: p.endMs,
      beforePath: before,
      afterPath: after,
      bypassed: { effects: clips.reduce((n, c) => n + c.effects.filter((e) => e.enabled && !e.type.startsWith('audio-')).length, 0), masks: doc.masks.filter((m) => m.enabled).length, audioEffects: clips.reduce((n, c) => n + c.effects.filter((e) => e.enabled && e.type.startsWith('audio-')).length, 0) },
    };
  }
}
