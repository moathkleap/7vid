import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { newId, type ProjectDocument } from '@sevenvid/core';
import type { TaskInfo, UpscaleResult } from '@sevenvid/ipc';
import type { CapabilityRegistry } from '../capabilities/CapabilityRegistry';
import { AppError } from '../errors';
import type { FfmpegLocation } from '../ffmpeg/locator';
import { runFfmpeg } from '../ffmpeg/runner';
import type { HardwareMonitor } from '../hardware/HardwareMonitor';
import type { Logger } from '../logging/logger';
import type { MediaService } from '../media/MediaService';
import { probeMedia } from '../media/probe';
import type { ProjectService } from '../project/ProjectService';
import type { SessionManager } from '../project/SessionManager';
import type { TaskManager } from '../tasks/TaskManager';
import type { WorkerService } from '../worker/WorkerService';

type Ctx = { progress: (v: number, m?: string | null) => void; signal: AbortSignal; setPauseHandlers: (h: { pause: () => void; resume: () => void } | null) => void };

export interface UpscaleOptions {
  projectId: string;
  clipId: string;
  factor?: 2 | 4;
  method?: 'lanczos' | 'ai';
  replaceClip?: boolean;
}

const MAX_OUTPUT_PIXELS = 7680 * 4320;

/** Resolution enhancement: Lanczos upscaling through FFmpeg (always available) and AI upscaling through the worker when a GPU runtime exists. */
export class EnhanceService {
  constructor(
    private readonly ffmpeg: FfmpegLocation,
    private readonly tasks: TaskManager,
    private readonly projects: ProjectService,
    private readonly sessions: SessionManager,
    private readonly media: MediaService,
    private readonly hardware: HardwareMonitor,
    private readonly capabilities: CapabilityRegistry,
    private readonly worker: WorkerService,
    private readonly logger: Logger,
  ) {
    tasks.registerKind<UpscaleOptions, UpscaleResult>({ kind: 'enhance.upscale', lane: 'render', pausable: true, title: () => 'Upscale clip', run: (ctx) => this.upscale(ctx.params, ctx) });
  }

  startUpscale(p: UpscaleOptions): TaskInfo {
    const session = this.sessions.get(p.projectId);
    const clip = session.document.tracks.flatMap((t) => t.clips).find((c) => c.id === p.clipId);
    if (!clip) throw new AppError({ code: 'COMMAND_FAILED', operation: 'enhance.upscale', message: `Clip ${p.clipId} not found` });
    const asset = session.document.assets[clip.assetId];
    if (!asset?.hasVideo) throw new AppError({ code: 'INVALID_INPUT', operation: 'enhance.upscale', message: 'Only clips with video can be upscaled' });
    if (!asset.width || !asset.height) throw new AppError({ code: 'MEDIA_ANALYSIS_FAILED', operation: 'enhance.upscale', message: 'Source dimensions are unknown; re-analyze the media first' });
    const factor = p.factor ?? 2;
    const pixels = asset.width * factor * asset.height * factor;
    if (pixels > MAX_OUTPUT_PIXELS) throw new AppError({ code: 'HARDWARE_INSUFFICIENT', operation: 'enhance.upscale', message: `Output ${asset.width * factor}×${asset.height * factor} exceeds the 8K limit`, details: { width: asset.width * factor, height: asset.height * factor } });
    const hw = this.hardware.current;
    if (hw && pixels > 3840 * 2160 && hw.memory.availableMb < 4096) throw new AppError({ code: 'HARDWARE_INSUFFICIENT', operation: 'enhance.upscale', message: `Upscaling to ${asset.width * factor}×${asset.height * factor} needs at least 4 GB of free memory (${hw.memory.availableMb} MB available)`, details: { availableMb: hw.memory.availableMb } });
    if ((p.method ?? 'lanczos') === 'ai') {
      const cap = this.capabilities.status('upscale.ai');
      if (cap.status !== 'available') {
        const code = cap.status === 'needs-hardware' ? 'HARDWARE_INSUFFICIENT' : cap.status === 'needs-model' ? 'MODEL_NOT_INSTALLED' : 'WORKER_UNAVAILABLE';
        throw new AppError({ code, operation: 'enhance.upscale', message: `AI upscaling is not available on this machine (${cap.status})`, details: { capability: cap } });
      }
    }
    return this.tasks.enqueue({ kind: 'enhance.upscale', params: { ...p, factor, method: p.method ?? 'lanczos', replaceClip: p.replaceClip ?? true }, projectId: p.projectId, priority: 2 });
  }

  private async upscale(p: UpscaleOptions, ctx: Ctx): Promise<UpscaleResult> {
    const ffmpeg = this.ffmpeg.ffmpeg;
    const ffprobe = this.ffmpeg.ffprobe;
    if (!ffmpeg || !ffprobe) throw new AppError({ code: 'FFMPEG_NOT_FOUND', operation: 'enhance.upscale', message: 'FFmpeg is required' });
    const session = this.sessions.get(p.projectId);
    const doc: ProjectDocument = session.document;
    const clip = doc.tracks.flatMap((t) => t.clips).find((c) => c.id === p.clipId);
    if (!clip) throw new AppError({ code: 'COMMAND_FAILED', operation: 'enhance.upscale', message: `Clip ${p.clipId} not found` });
    const asset = doc.assets[clip.assetId]!;
    const factor = p.factor ?? 2;
    const method = p.method ?? 'lanczos';
    const src = await probeMedia(ffprobe, asset.sourcePath);
    if (!src.video) throw new AppError({ code: 'MEDIA_UNSUPPORTED', operation: 'enhance.upscale', message: 'Source has no video stream' });
    const outW = src.video.width * factor;
    const outH = src.video.height * factor;
    const dir = path.join(this.projects.get(p.projectId).dataDir, 'generated');
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(asset.sourcePath).replace(/\.[^.]+$/, '');
    const isImage = src.kind === 'image';
    const out = path.join(dir, `${base}-x${factor}-${method}-${newId().slice(-6)}.${isImage ? 'png' : 'mp4'}`);
    if (method === 'ai') await this.upscaleAi(src.path, out, factor, src, ctx);
    else await this.upscaleLanczos(ffmpeg, src.path, out, factor, isImage, src.durationMs, ctx);
    ctx.progress(0.9, 'verify');
    const check = await probeMedia(ffprobe, out);
    const okDims = Boolean(check.video && Math.abs(check.video.width - outW) <= 2 && Math.abs(check.video.height - outH) <= 2);
    const okDur = isImage || !src.durationMs || !check.durationMs || Math.abs(check.durationMs - src.durationMs) <= Math.max(200, src.durationMs * 0.02);
    if (!okDims || !okDur) {
      fs.rmSync(out, { force: true });
      throw new AppError({ code: 'EXPORT_VALIDATION_FAILED', operation: 'enhance.upscale', message: `Upscaled file failed validation (${check.video?.width}×${check.video?.height}, ${check.durationMs} ms)`, details: { expected: { width: outW, height: outH, durationMs: src.durationMs }, actual: { width: check.video?.width, height: check.video?.height, durationMs: check.durationMs } } });
    }
    ctx.progress(0.93, 'import');
    const imported = this.media.import([out], p.projectId);
    const row = imported.assets[0];
    if (!row) throw new AppError({ code: 'MEDIA_ANALYSIS_FAILED', operation: 'enhance.upscale', message: 'Upscaled file could not be registered' });
    const analyze = this.tasks.list({ includeFinished: true }).find((t) => t.kind === 'media.analyze' && t.params.assetId === row.id);
    if (analyze) await this.tasks.wait(analyze.id);
    const ready = this.media.requireRow(row.id);
    if (ready.analysisStatus !== 'ready') throw new AppError({ code: 'MEDIA_ANALYSIS_FAILED', operation: 'enhance.upscale', message: 'Upscaled file could not be analyzed', details: { error: ready.analysisError } });
    let replaced = false;
    if (p.replaceClip !== false) {
      const ref = this.media.toAssetRef(ready);
      session.executeBatch([{ type: 'asset.add', asset: ref }, { type: 'clip.replaceAsset', clipId: clip.id, asset: ref }], `upscale ${clip.name} ×${factor}`, 'ai');
      replaced = true;
    }
    ctx.progress(1, null);
    this.logger.info({ module: 'render', operation: 'upscale', clipId: clip.id, method, factor, out, replaced }, 'upscale complete');
    return { clipId: clip.id, assetId: row.id, path: out, width: check.video!.width, height: check.video!.height, factor, method, replaced };
  }

  private async upscaleLanczos(ffmpeg: string, src: string, out: string, factor: number, isImage: boolean, durationMs: number | null, ctx: Ctx): Promise<void> {
    const vf = `scale=iw*${factor}:ih*${factor}:flags=lanczos,unsharp=5:5:0.4:5:5:0.0`;
    const args = isImage
      ? ['-i', src, '-vf', vf, '-frames:v', '1', '-update', '1', out]
      : ['-i', src, '-vf', `${vf},format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-c:a', 'copy', '-movflags', '+faststart', out];
    await runFfmpeg({ ffmpeg, args, logger: this.logger, signal: ctx.signal, expectDurationMs: durationMs, operation: 'enhance.upscale', onProgress: (pr) => ctx.progress(0.05 + (pr.ratio ?? 0) * 0.8, pr.speed ? `${pr.speed.toFixed(2)}x` : null), onProcess: (_proc, controls) => ctx.setPauseHandlers({ pause: () => void controls.pause(), resume: () => void controls.resume() }) });
    ctx.setPauseHandlers(null);
  }

  /** AI upscaling frame by frame through the worker (Real-ESRGAN); video is processed in chunks and re-muxed with the original audio. */
  private async upscaleAi(src: string, out: string, factor: number, info: Awaited<ReturnType<typeof probeMedia>>, ctx: Ctx): Promise<void> {
    const ffmpeg = this.ffmpeg.ffmpeg!;
    const work = path.join(path.dirname(out), `.ai-${newId()}`);
    fs.mkdirSync(work, { recursive: true });
    try {
      if (info.kind === 'image') {
        await this.worker.upscaleImage(src, out, { factor, signal: ctx.signal });
        return;
      }
      const fps = info.video!.fps;
      const frameDir = path.join(work, 'in');
      const upDir = path.join(work, 'out');
      fs.mkdirSync(frameDir, { recursive: true });
      fs.mkdirSync(upDir, { recursive: true });
      ctx.progress(0.03, 'extract frames');
      await runFfmpeg({ ffmpeg, args: ['-i', src, '-vsync', 'cfr', '-r', `${fps.num}/${fps.den}`, path.join(frameDir, '%07d.png')], signal: ctx.signal, operation: 'enhance.upscale.extract', logger: this.logger });
      const frames = fs.readdirSync(frameDir).filter((f) => f.endsWith('.png')).sort();
      for (let i = 0; i < frames.length; i++) {
        if (ctx.signal.aborted) throw new AppError({ code: 'TASK_CANCELLED', operation: 'enhance.upscale', message: 'cancelled' });
        await this.worker.upscaleImage(path.join(frameDir, frames[i]!), path.join(upDir, frames[i]!), { factor, signal: ctx.signal });
        fs.rmSync(path.join(frameDir, frames[i]!), { force: true });
        ctx.progress(0.05 + (0.8 * (i + 1)) / frames.length, `frame ${i + 1}/${frames.length}`);
      }
      ctx.progress(0.86, 'encode');
      const args = ['-framerate', `${fps.num}/${fps.den}`, '-i', path.join(upDir, '%07d.png'), '-i', src, '-map', '0:v', '-map', '1:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', out];
      await runFfmpeg({ ffmpeg, args, signal: ctx.signal, operation: 'enhance.upscale.encode', logger: this.logger });
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
}

export function probeDimensions(ffprobe: string, file: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    execFile(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], (err, stdout) => {
      if (err) return reject(AppError.from(err, { code: 'FFMPEG_FAILED', operation: 'probeDimensions' }));
      const [w, h] = String(stdout).trim().split(',').map(Number);
      resolve({ width: w ?? 0, height: h ?? 0 });
    });
  });
}
