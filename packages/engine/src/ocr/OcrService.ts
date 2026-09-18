import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { boxIou, createMaskTrack, newId, sourceBoxToSequence, timelineToSourceMs, type Command, type MaskTrack, type NormBox, type ProjectDocument } from '@sevenvid/core';
import type { OcrLine, OcrResult, OcrTrack, SessionState, TaskInfo } from '@sevenvid/ipc';
import type { CapabilityRegistry, CapabilityReport } from '../capabilities/CapabilityRegistry';
import { AppError } from '../errors';
import type { FfmpegLocation } from '../ffmpeg/locator';
import type { Logger } from '../logging/logger';
import type { ModelManager } from '../models/ModelManager';
import type { AppPaths } from '../paths/AppPaths';
import type { ProjectService } from '../project/ProjectService';
import type { SessionManager } from '../project/SessionManager';
import type { SearchService } from '../search/SearchService';
import type { TaskManager } from '../tasks/TaskManager';
import type { VisionService } from '../vision/VisionService';

type Ctx = { progress: (v: number, m?: string | null) => void; signal: AbortSignal };
type Lang = 'ar' | 'en';

const TESS_LANG: Record<Lang, { code: string; modelId: string }> = { ar: { code: 'ara', modelId: 'tesseract/ara-fast' }, en: { code: 'eng', modelId: 'tesseract/eng-fast' } };
const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;

interface TessWorker {
  recognize(image: string, options?: Record<string, unknown>, output?: Record<string, boolean>): Promise<{ data: { text: string; blocks?: Array<{ paragraphs: Array<{ lines: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> }> }> | null } }>;
  terminate(): Promise<unknown>;
}

export interface RecognizedLine extends OcrLine {
  /** Pixel box in the analyzed image. */
  px: { x0: number; y0: number; x1: number; y1: number };
}

/** On-device OCR (tesseract.js with locally installed language data): text detection, extraction and text masks. */
export class OcrService {
  private workers = new Map<string, Promise<TessWorker>>();

  constructor(
    private readonly paths: AppPaths,
    private readonly ffmpeg: FfmpegLocation,
    private readonly tasks: TaskManager,
    private readonly projects: ProjectService,
    private readonly sessions: SessionManager,
    private readonly models: ModelManager,
    private readonly vision: VisionService,
    private readonly capabilities: CapabilityRegistry,
    private readonly search: SearchService,
    private readonly logger: Logger,
  ) {
    tasks.registerKind<{ projectId: string; clipId: string; languages?: Lang[]; sampleFps?: number }, OcrResult>({ kind: 'ocr.detect', lane: 'default', title: () => 'Detect text', run: (ctx) => this.detect(ctx.params, ctx) });
    capabilities.register('ocr', (): Partial<CapabilityReport> => {
      const installed = (['en', 'ar'] as Lang[]).filter((l) => this.models.isInstalled(TESS_LANG[l].modelId));
      if (installed.length === 0) return { status: 'needs-model', reasonKey: 'capabilities.modelMissing', reasonParams: { models: 'tesseract/eng-fast, tesseract/ara-fast' }, action: { type: 'open-models', target: 'tesseract/eng-fast' } };
      return { status: 'available', providerId: 'tesseract', external: false, reasonParams: { languages: installed.join(', ') } };
    });
  }

  installedLanguages(): Lang[] {
    return (['ar', 'en'] as Lang[]).filter((l) => this.models.isInstalled(TESS_LANG[l].modelId));
  }

  /** tesseract.js expects every `<lang>.traineddata` in one directory; installed models are linked into the cache. */
  private tessdataDir(langs: Lang[]): string {
    const dir = path.join(this.paths.cache, 'tessdata');
    fs.mkdirSync(dir, { recursive: true });
    for (const l of langs) {
      const src = this.models.pathFor(TESS_LANG[l].modelId);
      if (!src) throw new AppError({ code: 'MODEL_NOT_INSTALLED', operation: 'ocr', message: `OCR language data for "${l}" is not installed`, details: { modelId: TESS_LANG[l].modelId } });
      const dst = path.join(dir, `${TESS_LANG[l].code}.traineddata`);
      if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
    }
    return dir;
  }

  private async worker(langs: Lang[]): Promise<TessWorker> {
    const key = langs.join('+');
    let w = this.workers.get(key);
    if (!w) {
      w = (async () => {
        const langPath = this.tessdataDir(langs);
        const tess = (await import('tesseract.js')) as unknown as { createWorker: (langs: string[], oem: number, opts: Record<string, unknown>) => Promise<TessWorker> };
        const t0 = Date.now();
        const worker = await tess.createWorker(langs.map((l) => TESS_LANG[l].code), 1, { langPath, gzip: false, cachePath: langPath, cacheMethod: 'none', logger: () => undefined, errorHandler: (err: unknown) => this.logger.warn({ module: 'ocr', err }, 'tesseract worker error') });
        this.logger.info({ module: 'ocr', operation: 'worker', langs: key, durationMs: Date.now() - t0 }, 'ocr worker ready');
        return worker;
      })();
      this.workers.set(key, w);
      w.catch(() => this.workers.delete(key));
    }
    return w;
  }

  async dispose(): Promise<void> {
    for (const [, w] of this.workers) {
      try {
        await (await w).terminate();
      } catch {
        /* ignore */
      }
    }
    this.workers.clear();
  }

  private classify(text: string): OcrLine['language'] {
    const ar = ARABIC.test(text);
    const la = LATIN.test(text);
    return ar && la ? 'mixed' : ar ? 'ar' : la ? 'en' : 'unknown';
  }

  /**
   * Recognizes text lines in an image file; boxes are normalized to the image.
   * The image is analyzed as grayscale and upscaled up to 2× (at most 2560 px wide): Tesseract's Arabic model in
   * particular reads small on-screen text far more reliably from larger glyphs (measured on the OCR fixture: 43% → 91%).
   */
  async recognizeFile(file: string, langs: Lang[], minConfidence = 35): Promise<{ lines: RecognizedLine[]; text: string; width: number; height: number }> {
    const w = await this.worker(langs);
    const { width, height } = await this.imageSize(file);
    const prepared = await this.prepareImage(file);
    try {
      const size = await this.imageSize(prepared);
      const sx = size.width / width;
      const sy = size.height / height;
      const res = await w.recognize(prepared, {}, { blocks: true, text: true });
      const lines: RecognizedLine[] = [];
      for (const block of res.data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            const text = line.text.replace(/\s+/g, ' ').trim();
            if (text.length < 2 || line.confidence < minConfidence) continue;
            const bw = Math.max(0, line.bbox.x1 - line.bbox.x0);
            const bh = Math.max(0, line.bbox.y1 - line.bbox.y0);
            if (bw < 4 || bh < 4) continue;
            const px = { x0: line.bbox.x0 / sx, y0: line.bbox.y0 / sy, x1: line.bbox.x1 / sx, y1: line.bbox.y1 / sy };
            lines.push({ text, confidence: Math.round(line.confidence), box: { x: line.bbox.x0 / size.width, y: line.bbox.y0 / size.height, w: bw / size.width, h: bh / size.height }, language: this.classify(text), px });
          }
        }
      }
      return { lines, text: lines.map((l) => l.text).join('\n'), width, height };
    } finally {
      fs.rmSync(prepared, { force: true });
    }
  }

  /** Writes the grayscale, size-normalized working copy that Tesseract analyzes (the source file is never modified). */
  private prepareImage(file: string): Promise<string> {
    const ffmpeg = this.ffmpeg.ffmpeg;
    if (!ffmpeg) throw new AppError({ code: 'FFMPEG_NOT_FOUND', operation: 'ocr', message: 'FFmpeg is required' });
    const dir = path.join(this.paths.cache, 'ocr-tmp');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${newId('ocr')}.png`);
    return new Promise((resolve, reject) => {
      execFile(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', file, '-frames:v', '1', '-vf', "format=gray,scale='if(gt(iw,2560),iw,min(iw*2,2560))':-2:flags=lanczos", '-update', '1', out], (err) => (err ? reject(AppError.from(err, { code: 'FFMPEG_FAILED', operation: 'ocr.prepare' })) : resolve(out)));
    });
  }

  private imageSize(file: string): Promise<{ width: number; height: number }> {
    const ffprobe = this.ffmpeg.ffprobe;
    if (!ffprobe) throw new AppError({ code: 'FFMPEG_NOT_FOUND', operation: 'ocr', message: 'FFprobe is required' });
    return new Promise((resolve, reject) => {
      execFile(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], (err, stdout) => {
        if (err) return reject(AppError.from(err, { code: 'FFMPEG_FAILED', operation: 'ocr.probe' }));
        const [w, h] = String(stdout).trim().split(',').map(Number);
        if (!w || !h) return reject(new AppError({ code: 'MEDIA_UNSUPPORTED', operation: 'ocr.probe', message: `could not read image size of ${file}` }));
        resolve({ width: w, height: h });
      });
    });
  }

  private extractFrame(file: string, sourceMs: number, out: string, signal?: AbortSignal): Promise<void> {
    const ffmpeg = this.ffmpeg.ffmpeg;
    if (!ffmpeg) throw new AppError({ code: 'FFMPEG_NOT_FOUND', operation: 'ocr', message: 'FFmpeg is required' });
    return new Promise((resolve, reject) => {
      execFile(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', (sourceMs / 1000).toFixed(3), '-i', file, '-frames:v', '1', '-vf', "scale='min(1920,iw)':-2", '-update', '1', out], { signal }, (err) => (err ? reject(AppError.from(err, { code: 'FFMPEG_FAILED', operation: 'ocr.frame' })) : resolve()));
    });
  }

  startDetect(p: { projectId: string; clipId: string; languages?: Lang[]; sampleFps?: number }): TaskInfo {
    this.vision.clipContext(p.projectId, p.clipId);
    const langs = p.languages?.length ? p.languages : this.installedLanguages();
    if (langs.length === 0) throw new AppError({ code: 'MODEL_NOT_INSTALLED', operation: 'ocr.detect', message: 'No OCR language data is installed', details: { models: ['tesseract/eng-fast', 'tesseract/ara-fast'] } });
    for (const l of langs) if (!this.models.isInstalled(TESS_LANG[l].modelId)) throw new AppError({ code: 'MODEL_NOT_INSTALLED', operation: 'ocr.detect', message: `OCR language data for "${l}" is not installed`, details: { modelId: TESS_LANG[l].modelId } });
    return this.tasks.enqueue({ kind: 'ocr.detect', params: { ...p, languages: langs }, projectId: p.projectId, priority: 4 });
  }

  private async detect(p: { projectId: string; clipId: string; languages?: Lang[]; sampleFps?: number }, ctx: Ctx): Promise<OcrResult> {
    const c = this.vision.clipContext(p.projectId, p.clipId);
    const langs = p.languages?.length ? p.languages : this.installedLanguages();
    const sampleFps = Math.max(0.2, Math.min(5, p.sampleFps ?? 1));
    const interval = 1000 / sampleFps;
    const clipEnd = c.clip.startMs + c.clip.durationMs;
    let times: number[] = [];
    if (c.asset.kind === 'image' || c.clip.freeze) times = [c.clip.startMs];
    else {
      for (let t = c.clip.startMs + Math.min(interval / 2, 200); t < clipEnd; t += interval) times.push(Math.round(t));
      if (times.length > 90) {
        const step = Math.ceil(times.length / 90);
        times = times.filter((_, i) => i % step === 0);
      }
      if (times.length === 0) times = [c.clip.startMs];
    }
    const scratch = path.join(this.projects.get(p.projectId).dataDir, 'cache', 'ocr');
    fs.mkdirSync(scratch, { recursive: true });
    const frames: OcrResult['frames'] = [];
    const file = c.asset.sourcePath; // OCR needs the full-resolution source, not the proxy
    for (let i = 0; i < times.length; i++) {
      const tMs = times[i]!;
      ctx.progress(i / times.length, `frame ${i + 1}/${times.length}`);
      if (ctx.signal.aborted) throw new AppError({ code: 'TASK_CANCELLED', operation: 'ocr.detect', message: 'cancelled' });
      const png = path.join(scratch, `${c.clip.id}-${tMs}.png`);
      try {
        await this.extractFrame(file, timelineToSourceMs(c.clip, tMs), png, ctx.signal);
        const rec = await this.recognizeFile(png, langs);
        frames.push({ tMs, lines: rec.lines.map((l) => ({ text: l.text, confidence: l.confidence, language: l.language, box: sourceBoxToSequence(c.clip, c.sourceW, c.sourceH, c.seqW, c.seqH, l.box) })) });
      } finally {
        fs.rmSync(png, { force: true });
      }
    }
    const tracks = this.linkLines(frames, interval, clipEnd);
    const text = tracks.map((t) => t.text).join('\n');
    const result: OcrResult = { clipId: c.clip.id, languages: langs, sampleFps, framesAnalyzed: frames.length, frames, tracks, text };
    this.vision.writeAnalysis(p.projectId, c.clip.id, 'ocr', result);
    if (text.trim()) this.search.index({ type: 'asset', id: c.asset.id, projectId: c.asset.id.startsWith('ast') ? p.projectId : null, title: c.asset.name, body: `text ocr ${text}` });
    ctx.progress(1, null);
    this.logger.info({ module: 'ocr', operation: 'detect', clipId: c.clip.id, frames: frames.length, tracks: tracks.length, langs }, 'text detected');
    return result;
  }

  private normalize(text: string): string {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  }

  /** Links the same text line across sampled frames (same normalized text or overlapping box). */
  private linkLines(frames: OcrResult['frames'], intervalMs: number, clipEndMs: number): OcrTrack[] {
    interface Open extends OcrTrack {
      norm: string;
      lastMs: number;
      boxes: NormBox[];
    }
    const open: Open[] = [];
    const done: Open[] = [];
    for (const frame of frames) {
      for (let i = open.length - 1; i >= 0; i--) {
        if (frame.tMs - open[i]!.lastMs > intervalMs * 2.5) done.push(open.splice(i, 1)[0]!);
      }
      for (const line of frame.lines) {
        const norm = this.normalize(line.text);
        const match = open.find((t) => (t.norm === norm && norm.length > 0) || (boxIou(t.box, line.box) > 0.5 && similar(t.norm, norm)));
        if (match) {
          match.frames++;
          match.lastMs = frame.tMs;
          match.endMs = Math.min(clipEndMs, frame.tMs + intervalMs);
          match.boxes.push(line.box);
          match.box = union(match.boxes);
          match.confidence = Math.round((match.confidence * (match.frames - 1) + line.confidence) / match.frames);
          if (line.confidence > match.confidence) match.text = line.text;
        } else {
          open.push({ index: 0, text: line.text, language: line.language, startMs: frame.tMs, endMs: Math.min(clipEndMs, frame.tMs + intervalMs), box: line.box, confidence: line.confidence, frames: 1, norm, lastMs: frame.tMs, boxes: [line.box] });
        }
      }
    }
    const all = [...done, ...open].sort((a, b) => a.startMs - b.startMs || a.box.y - b.box.y);
    return all.map((t, index) => ({ index, text: t.text, language: t.language, startMs: t.startMs, endMs: t.endMs, box: t.box, confidence: t.confidence, frames: t.frames }));
  }

  /** Creates static masks over detected text tracks (all tracks or the given indexes). */
  createMasks(projectId: string, clipId: string, kind: MaskTrack['kind'] = 'blur', trackIndexes?: number[]): SessionState {
    const session = this.sessions.get(projectId);
    const result = this.vision.readAnalysis<OcrResult>(projectId, clipId, 'ocr');
    if (!result) throw new AppError({ code: 'INVALID_INPUT', operation: 'ocr.createMasks', message: 'Run text detection on this clip first' });
    const doc: ProjectDocument = session.document;
    const clip = doc.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    if (!clip) throw new AppError({ code: 'COMMAND_FAILED', operation: 'ocr.createMasks', message: `Clip ${clipId} not found` });
    const chosen = result.tracks.filter((t) => !trackIndexes || trackIndexes.includes(t.index));
    if (chosen.length === 0) throw new AppError({ code: 'INVALID_INPUT', operation: 'ocr.createMasks', message: 'No text regions selected' });
    const commands: Command[] = chosen.map((t) => {
      const pad = { x: Math.max(0, t.box.x - t.box.w * 0.08), y: Math.max(0, t.box.y - t.box.h * 0.25) };
      const box: NormBox = { x: pad.x, y: pad.y, w: Math.min(1 - pad.x, t.box.w * 1.16), h: Math.min(1 - pad.y, t.box.h * 1.5) };
      const mask = createMaskTrack({ clipId, kind, shape: 'rect', source: 'auto-text', label: t.text.length > 24 ? `${t.text.slice(0, 24)}…` : t.text, startMs: Math.max(clip.startMs, t.startMs), endMs: Math.min(clip.startMs + clip.durationMs, Math.max(t.endMs, t.startMs + 1)), strength: kind === 'pixelate' ? 12 : 30 });
      mask.keyframes = [{ tMs: mask.startMs, ...box, confidence: t.confidence / 100 }];
      return { type: 'mask.add', mask };
    });
    return session.executeBatch(commands, `mask ${commands.length} text region(s)`, 'ai');
  }
}

function union(boxes: NormBox[]): NormBox {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function similar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  if (long.includes(short) && short.length >= 3) return true;
  let same = 0;
  for (let i = 0; i < short.length; i++) if (short[i] === long[i]) same++;
  return same / long.length > 0.7;
}

export { newId as _newId };
