import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_PRESETS, getDocumentDurationMs, isAudioEffect, newId, type AudioPresetId, type Command, type ProjectDocument } from '@sevenvid/core';
import type { EnhancePreviewResult, LoudnessResult, RemoveSilenceResult, SessionState, SilenceDetectionResult, TaskInfo } from '@sevenvid/ipc';
import { AppError } from '../errors';
import type { FfmpegLocation } from '../ffmpeg/locator';
import { runFfmpeg } from '../ffmpeg/runner';
import type { Logger } from '../logging/logger';
import type { ProjectService } from '../project/ProjectService';
import type { SessionManager } from '../project/SessionManager';
import { buildFfmpegAudioArgs, compileRenderGraph, type CompileOptions } from '../render/RenderGraphCompiler';
import type { TaskManager } from '../tasks/TaskManager';
import type { WorkerService } from '../worker/WorkerService';
import type { CapabilityRegistry } from '../capabilities/CapabilityRegistry';

export interface SilenceOptions {
  projectId: string;
  startMs?: number;
  endMs?: number;
  thresholdDb?: number;
  minSilenceMs?: number;
  method?: 'auto' | 'vad' | 'silencedetect';
}

export interface RemoveSilenceOptions extends SilenceOptions {
  paddingMs?: number;
  verify?: boolean;
}

interface Range {
  startMs: number;
  endMs: number;
}

type Ctx = { progress: (v: number, m?: string | null) => void; signal: AbortSignal };

const DEFAULT_THRESHOLD_DB = -35;
const DEFAULT_MIN_SILENCE_MS = 700;

/** Silence detection, loudness measurement, silence removal and enhancement previews on the mixed timeline audio. */
export class AudioService {
  constructor(
    private readonly ffmpeg: FfmpegLocation,
    private readonly tasks: TaskManager,
    private readonly projects: ProjectService,
    private readonly sessions: SessionManager,
    private readonly worker: WorkerService,
    private readonly capabilities: CapabilityRegistry,
    private readonly logger: Logger,
  ) {
    tasks.registerKind<SilenceOptions, SilenceDetectionResult>({ kind: 'audio.detectSilence', lane: 'default', title: () => 'Detect silence', run: (ctx) => this.detectSilence(ctx.params, ctx) });
    tasks.registerKind<RemoveSilenceOptions, RemoveSilenceResult>({ kind: 'audio.removeSilence', lane: 'default', title: () => 'Remove silence', run: (ctx) => this.removeSilence(ctx.params, ctx) });
    tasks.registerKind<{ projectId: string; startMs?: number; endMs?: number }, LoudnessResult>({ kind: 'audio.measure', lane: 'default', title: () => 'Measure loudness', run: (ctx) => this.measureProject(ctx.params, ctx) });
    tasks.registerKind<{ projectId: string; clipId: string; startMs?: number; endMs?: number }, EnhancePreviewResult>({ kind: 'audio.previewEnhance', lane: 'render', title: () => 'Audio before/after preview', run: (ctx) => this.previewEnhance(ctx.params, ctx) });
  }

  private requireFfmpeg(): string {
    if (!this.ffmpeg.ffmpeg) throw new AppError({ code: 'FFMPEG_NOT_FOUND', operation: 'audio', message: 'FFmpeg is required for audio analysis' });
    return this.ffmpeg.ffmpeg;
  }

  private doc(projectId: string): ProjectDocument {
    return this.sessions.isOpen(projectId) ? this.sessions.get(projectId).document : this.projects.loadLatestDocument(projectId);
  }

  private scratch(projectId: string, sub = 'audio'): string {
    const dir = path.join(this.projects.get(projectId).dataDir, 'cache', sub);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  startDetectSilence(opts: SilenceOptions): TaskInfo {
    this.projects.get(opts.projectId);
    return this.tasks.enqueue({ kind: 'audio.detectSilence', params: opts, projectId: opts.projectId, priority: 4 });
  }

  startRemoveSilence(opts: RemoveSilenceOptions): TaskInfo {
    this.sessions.get(opts.projectId);
    return this.tasks.enqueue({ kind: 'audio.removeSilence', params: opts, projectId: opts.projectId, priority: 4 });
  }

  startMeasure(opts: { projectId: string; startMs?: number; endMs?: number }): TaskInfo {
    this.projects.get(opts.projectId);
    return this.tasks.enqueue({ kind: 'audio.measure', params: opts, projectId: opts.projectId, priority: 4 });
  }

  startPreviewEnhance(opts: { projectId: string; clipId: string; startMs?: number; endMs?: number }): TaskInfo {
    this.projects.get(opts.projectId);
    return this.tasks.enqueue({ kind: 'audio.previewEnhance', params: opts, projectId: opts.projectId, priority: 3 });
  }

  /** Renders the mixed timeline audio for a range to a WAV file (what the user would hear). */
  async renderAudio(doc: ProjectDocument, projectId: string, range: Range, out: string, opts: { sampleRate: number; channels: number; bypass?: CompileOptions['bypass']; signal?: AbortSignal; onProgress?: (r: number) => void }): Promise<string> {
    const ffmpeg = this.requireFfmpeg();
    const target = { width: doc.settings.width, height: doc.settings.height, fps: doc.settings.fps, sampleRate: opts.sampleRate, channels: opts.channels };
    const graph = compileRenderGraph({ doc, target, range, audioOnly: true, bypass: opts.bypass });
    const scratch = this.scratch(projectId);
    const script = path.join(scratch, `audio-${newId()}.txt`);
    fs.writeFileSync(script, graph.filterScript, 'utf8');
    try {
      await runFfmpeg({ ffmpeg, args: buildFfmpegAudioArgs(graph, script, out, { sampleRate: opts.sampleRate, channels: opts.channels }), logger: this.logger, signal: opts.signal, expectDurationMs: graph.durationMs, onProgress: (p) => opts.onProgress?.(p.ratio ?? 0), operation: 'audio.render' });
    } finally {
      fs.rmSync(script, { force: true });
    }
    if (!fs.existsSync(out) || fs.statSync(out).size < 100) throw new AppError({ code: 'RENDER_FAILED', operation: 'audio.render', message: 'Audio render produced no output' });
    return out;
  }

  /** FFmpeg silencedetect on a file: ranges in ms relative to the file start. */
  async silenceDetectFile(file: string, thresholdDb: number, minSilenceMs: number, signal?: AbortSignal): Promise<Range[]> {
    const ffmpeg = this.requireFfmpeg();
    const stderr = await new Promise<string>((resolve, reject) => {
      execFile(ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-af', `silencedetect=n=${thresholdDb}dB:d=${(minSilenceMs / 1000).toFixed(3)}`, '-f', 'null', '-'], { maxBuffer: 32 * 1024 * 1024, signal }, (err, _stdout, err2) => {
        if (err) reject(AppError.from(err, { code: 'FFMPEG_FAILED', operation: 'audio.silencedetect' }));
        else resolve(String(err2));
      });
    });
    const ranges: Range[] = [];
    let start: number | null = null;
    for (const line of stderr.split('\n')) {
      const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
      const e = /silence_end:\s*(-?[\d.]+)/.exec(line);
      if (s) start = Math.max(0, Number(s[1]) * 1000);
      if (e && start != null) {
        ranges.push({ startMs: Math.round(start), endMs: Math.round(Number(e[1]) * 1000) });
        start = null;
      }
    }
    if (start != null) {
      const durMs = await this.fileDurationMs(file);
      if (durMs - start >= minSilenceMs) ranges.push({ startMs: Math.round(start), endMs: Math.round(durMs) });
    }
    return ranges;
  }

  private fileDurationMs(file: string): Promise<number> {
    const ffprobe = this.ffmpeg.ffprobe!;
    return new Promise((resolve, reject) => {
      execFile(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], (err, stdout) => (err ? reject(AppError.from(err, { code: 'FFMPEG_FAILED', operation: 'audio.probe' })) : resolve(Number(String(stdout).trim()) * 1000 || 0)));
    });
  }

  /** ebur128 + volumedetect on a file. */
  async measureFile(file: string, signal?: AbortSignal): Promise<LoudnessResult> {
    const ffmpeg = this.requireFfmpeg();
    const stderr = await new Promise<string>((resolve, reject) => {
      execFile(ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-af', 'ebur128=peak=true,volumedetect', '-f', 'null', '-'], { maxBuffer: 32 * 1024 * 1024, signal }, (err, _stdout, err2) => {
        if (err) reject(AppError.from(err, { code: 'FFMPEG_FAILED', operation: 'audio.measure' }));
        else resolve(String(err2));
      });
    });
    const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
    const num = (re: RegExp, text = summary): number | null => {
      const m = re.exec(text);
      if (!m) return null;
      const v = Number(m[1]);
      return Number.isFinite(v) ? v : null;
    };
    const durationMs = await this.fileDurationMs(file);
    return {
      integratedLufs: num(/Integrated loudness:[\s\S]*?I:\s*(-?[\d.]+) LUFS/),
      loudnessRangeLu: num(/Loudness range:[\s\S]*?LRA:\s*(-?[\d.]+) LU/),
      truePeakDb: num(/True peak:[\s\S]*?Peak:\s*(-?[\d.]+) dBFS/),
      meanVolumeDb: num(/mean_volume:\s*(-?[\d.]+) dB/, stderr),
      maxVolumeDb: num(/max_volume:\s*(-?[\d.]+) dB/, stderr),
      durationMs,
    };
  }

  private vadAvailable(): boolean {
    return this.capabilities.isAvailable('audio.vad');
  }

  private async detectSilence(opts: SilenceOptions, ctx: Ctx): Promise<SilenceDetectionResult> {
    const doc = this.doc(opts.projectId);
    return this.detectOnDocument(doc, opts, ctx);
  }

  private async detectOnDocument(doc: ProjectDocument, opts: SilenceOptions, ctx: Ctx): Promise<SilenceDetectionResult> {
    const total = getDocumentDurationMs(doc);
    if (total <= 0) throw new AppError({ code: 'VALIDATION_FAILED', operation: 'audio.detectSilence', message: 'The timeline is empty' });
    const range = { startMs: Math.max(0, opts.startMs ?? 0), endMs: Math.min(total, opts.endMs ?? total) };
    if (range.endMs <= range.startMs) throw new AppError({ code: 'INVALID_INPUT', operation: 'audio.detectSilence', message: 'Invalid range' });
    const minSilenceMs = Math.max(100, opts.minSilenceMs ?? DEFAULT_MIN_SILENCE_MS);
    const thresholdDb = opts.thresholdDb ?? DEFAULT_THRESHOLD_DB;
    const useVad = opts.method === 'vad' || (opts.method !== 'silencedetect' && this.vadAvailable());
    if (opts.method === 'vad' && !this.vadAvailable()) throw new AppError({ code: 'MODEL_NOT_INSTALLED', operation: 'audio.detectSilence', message: 'Voice activity detection needs the Python runtime and the Silero VAD model', details: { capability: 'audio.vad' } });
    const wav = path.join(this.scratch(opts.projectId), `mix-${newId()}.wav`);
    try {
      ctx.progress(0.05, 'render audio');
      await this.renderAudio(doc, opts.projectId, range, wav, { sampleRate: useVad ? 16000 : 48000, channels: 1, signal: ctx.signal, onProgress: (r) => ctx.progress(0.05 + r * 0.4, 'render audio') });
      let ranges: Range[];
      let speechMs = 0;
      const durationMs = range.endMs - range.startMs;
      if (useVad) {
        ctx.progress(0.5, 'voice activity');
        const vad = await this.worker.vad(wav, { minSilenceMs, minSpeechMs: 200, signal: ctx.signal, onProgress: (r) => ctx.progress(0.5 + r * 0.45, 'voice activity') });
        ranges = vad.silence.map((s) => ({ startMs: Math.round(s.start_ms), endMs: Math.round(s.end_ms) })).filter((r) => r.endMs - r.startMs >= minSilenceMs);
        speechMs = vad.speech.reduce((n, s) => n + (s.end_ms - s.start_ms), 0);
      } else {
        ctx.progress(0.5, 'silencedetect');
        ranges = await this.silenceDetectFile(wav, thresholdDb, minSilenceMs, ctx.signal);
        speechMs = durationMs - ranges.reduce((n, r) => n + (r.endMs - r.startMs), 0);
      }
      const shifted = ranges.map((r) => ({ startMs: r.startMs + range.startMs, endMs: Math.min(range.endMs, r.endMs + range.startMs) })).filter((r) => r.endMs > r.startMs);
      ctx.progress(1, null);
      return { method: useVad ? 'vad' : 'silencedetect', ranges: shifted, totalSilenceMs: shifted.reduce((n, r) => n + (r.endMs - r.startMs), 0), durationMs, thresholdDb: useVad ? null : thresholdDb, minSilenceMs, speechMs: Math.max(0, speechMs) };
    } finally {
      fs.rmSync(wav, { force: true });
    }
  }

  /** Cuts detected silences (keeping `paddingMs` on each side) and verifies the result by re-detecting. */
  private async removeSilence(opts: RemoveSilenceOptions, ctx: Ctx): Promise<RemoveSilenceResult> {
    const session = this.sessions.get(opts.projectId);
    const before = session.document;
    const beforeDurationMs = getDocumentDurationMs(before);
    const detection = await this.detectOnDocument(before, opts, { progress: (v, m) => ctx.progress(v * 0.6, m), signal: ctx.signal });
    const padding = Math.max(0, opts.paddingMs ?? 150);
    const minKeep = Math.max(100, opts.minSilenceMs ?? DEFAULT_MIN_SILENCE_MS);
    const cutRanges = detection.ranges
      .map((r) => ({ startMs: Math.round(r.startMs + padding), endMs: Math.round(r.endMs - padding) }))
      .filter((r) => r.endMs - r.startMs >= Math.min(minKeep, 200) && r.endMs > r.startMs);
    if (cutRanges.length === 0) {
      return { ...detection, cutRanges: [], removedMs: 0, beforeDurationMs, afterDurationMs: beforeDurationMs, verified: null, remainingSilences: detection.ranges };
    }
    ctx.progress(0.65, 'cut');
    const cmd: Command = { type: 'timeline.cutRanges', ranges: cutRanges };
    session.execute({ type: 'batch', commands: [cmd], label: `remove silence (${cutRanges.length})` }, 'ai');
    const after = session.document;
    const afterDurationMs = getDocumentDurationMs(after);
    const removedMs = cutRanges.reduce((n, r) => n + (r.endMs - r.startMs), 0);
    const expected = beforeDurationMs - removedMs;
    if (Math.abs(afterDurationMs - expected) > 40) {
      this.logger.warn({ module: 'audio', operation: 'removeSilence', beforeDurationMs, afterDurationMs, removedMs }, 'duration after cut differs from expectation');
    }
    let verified: boolean | null = null;
    let remaining: Range[] = [];
    if (opts.verify !== false && afterDurationMs > 0) {
      ctx.progress(0.7, 'verify');
      const check = await this.detectOnDocument(after, { ...opts, startMs: undefined, endMs: undefined }, { progress: (v, m) => ctx.progress(0.7 + v * 0.3, m), signal: ctx.signal });
      // silences shorter than the cut threshold plus both paddings are expected to remain
      remaining = check.ranges.filter((r) => r.endMs - r.startMs > (opts.minSilenceMs ?? DEFAULT_MIN_SILENCE_MS) + 2 * padding + 100);
      verified = remaining.length === 0 && Math.abs(afterDurationMs - expected) <= 40;
    }
    ctx.progress(1, null);
    this.logger.info({ module: 'audio', operation: 'removeSilence', projectId: opts.projectId, cuts: cutRanges.length, removedMs, verified }, 'silence removed');
    return { ...detection, cutRanges, removedMs, beforeDurationMs, afterDurationMs, verified, remainingSilences: remaining };
  }

  private async measureProject(opts: { projectId: string; startMs?: number; endMs?: number }, ctx: Ctx): Promise<LoudnessResult> {
    const doc = this.doc(opts.projectId);
    const total = getDocumentDurationMs(doc);
    if (total <= 0) throw new AppError({ code: 'VALIDATION_FAILED', operation: 'audio.measure', message: 'The timeline is empty' });
    const range = { startMs: Math.max(0, opts.startMs ?? 0), endMs: Math.min(total, opts.endMs ?? total) };
    const wav = path.join(this.scratch(opts.projectId), `measure-${newId()}.wav`);
    try {
      await this.renderAudio(doc, opts.projectId, range, wav, { sampleRate: 48000, channels: 2, signal: ctx.signal, onProgress: (r) => ctx.progress(r * 0.7, 'render audio') });
      ctx.progress(0.75, 'measure');
      const result = await this.measureFile(wav, ctx.signal);
      ctx.progress(1, null);
      return result;
    } finally {
      fs.rmSync(wav, { force: true });
    }
  }

  /** Replaces the clips' audio effects with a preset chain (one undoable step). */
  applyPreset(projectId: string, clipIds: string[], presetId: string): SessionState {
    const preset = AUDIO_PRESETS[presetId as AudioPresetId];
    if (!preset) throw new AppError({ code: 'INVALID_INPUT', operation: 'audio.applyPreset', message: `Unknown audio preset ${presetId}` });
    const session = this.sessions.get(projectId);
    const doc = session.document;
    const commands: Command[] = [];
    for (const clipId of clipIds) {
      const clip = doc.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
      if (!clip) throw new AppError({ code: 'COMMAND_FAILED', operation: 'audio.applyPreset', message: `Clip ${clipId} not found` });
      for (const e of clip.effects) if (isAudioEffect(e)) commands.push({ type: 'effect.remove', clipId, effectId: e.id });
      for (const e of preset.effects) commands.push({ type: 'effect.add', clipId, effect: { id: newId('fx'), type: e.type, enabled: true, params: { ...e.params } } });
    }
    return session.executeBatch(commands, `audio preset ${preset.id}`);
  }

  /** Renders the clip's audio with and without its audio effects and measures both. */
  private async previewEnhance(opts: { projectId: string; clipId: string; startMs?: number; endMs?: number }, ctx: Ctx): Promise<EnhancePreviewResult> {
    const doc = this.doc(opts.projectId);
    const clip = doc.tracks.flatMap((t) => t.clips).find((c) => c.id === opts.clipId);
    if (!clip) throw new AppError({ code: 'COMMAND_FAILED', operation: 'audio.previewEnhance', message: `Clip ${opts.clipId} not found` });
    const start = Math.max(clip.startMs, opts.startMs ?? clip.startMs);
    const end = Math.min(clip.startMs + clip.durationMs, opts.endMs ?? start + 15000);
    if (end <= start) throw new AppError({ code: 'INVALID_INPUT', operation: 'audio.previewEnhance', message: 'Invalid range' });
    const dir = this.scratch(opts.projectId, 'preview');
    const stamp = newId();
    const beforePath = path.join(dir, `${stamp}-audio-before.wav`);
    const afterPath = path.join(dir, `${stamp}-audio-after.wav`);
    await this.renderAudio(doc, opts.projectId, { startMs: start, endMs: end }, beforePath, { sampleRate: 48000, channels: 2, bypass: { audioEffects: true }, signal: ctx.signal, onProgress: (r) => ctx.progress(r * 0.35, 'before') });
    await this.renderAudio(doc, opts.projectId, { startMs: start, endMs: end }, afterPath, { sampleRate: 48000, channels: 2, signal: ctx.signal, onProgress: (r) => ctx.progress(0.35 + r * 0.35, 'after') });
    ctx.progress(0.75, 'measure');
    const [before, after] = await Promise.all([this.measureFile(beforePath, ctx.signal), this.measureFile(afterPath, ctx.signal)]);
    ctx.progress(1, null);
    return { clipId: clip.id, startMs: start, endMs: end, beforePath, afterPath, before, after, effects: clip.effects.filter((e) => e.enabled && isAudioEffect(e)).map((e) => e.type) };
  }
}
