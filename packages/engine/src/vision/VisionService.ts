import fs from 'node:fs';
import path from 'node:path';
import { boxIou, createMaskTrack, expandBox, maskBoxAt, newId, simplifyKeyframes, sequenceBoxToSource, sourceBoxToSequence, sourceToTimelineMs, timelineToSourceMs, type AssetRef, type Clip, type Command, type MaskKeyframe, type MaskTrack, type NormBox, type ProjectDocument } from '@sevenvid/core';
import type { BlurFacesResult, DetectFacesResult, DetectObjectsResult, FaceTrackInfo, MaskVerificationResult, TaskInfo, TrackTargetResult } from '@sevenvid/ipc';
import { AppError } from '../errors';
import type { FfmpegLocation } from '../ffmpeg/locator';
import type { Logger } from '../logging/logger';
import type { ProjectService } from '../project/ProjectService';
import type { SessionManager } from '../project/SessionManager';
import type { PreviewRenderService } from '../render/PreviewRenderService';
import type { TaskManager } from '../tasks/TaskManager';
import type { WorkerService } from '../worker/WorkerService';
import { blockMeanError, frameSharpness, grayFrame } from './frameStats';
import { maskWindowAt, pixelateBlockPx } from '../render/masks';

type Ctx = { progress: (v: number, m?: string | null) => void; signal: AbortSignal };
type FaceSelector = 'all' | 'largest' | 'leftmost' | 'rightmost' | 'center' | number;

export interface ClipContext {
  doc: ProjectDocument;
  clip: Clip;
  asset: AssetRef;
  /** File analyzed (proxy when present: same aspect ratio, faster). */
  file: string;
  sourceW: number;
  sourceH: number;
  seqW: number;
  seqH: number;
  sourceStartMs: number;
  sourceEndMs: number;
}

interface LinkedTrack {
  index: number;
  label: string;
  frames: Array<{ tMs: number; box: NormBox; srcBox: NormBox; score: number }>;
  closedAt: number;
}

export interface BlurFacesOptions {
  projectId: string;
  clipId: string;
  kind?: MaskTrack['kind'];
  shape?: MaskTrack['shape'];
  strength?: number;
  selector?: FaceSelector;
  sampleFps?: number;
  /** Follow each face frame by frame with the tracker (default) or interpolate between detections only. */
  track?: boolean;
}

export interface TrackTargetOptions {
  projectId: string;
  clipId: string;
  box: NormBox;
  startMs?: number;
  endMs?: number;
  kind?: MaskTrack['kind'];
  shape?: MaskTrack['shape'];
  strength?: number;
  detector?: 'face' | null;
  label?: string;
}

const MASK_VERIFY_RATIO = 0.4;

/** Face/object detection, tracked privacy masks and measured verification that a mask really blurs the output. */
export class VisionService {
  constructor(
    private readonly ffmpeg: FfmpegLocation,
    private readonly tasks: TaskManager,
    private readonly projects: ProjectService,
    private readonly sessions: SessionManager,
    private readonly worker: WorkerService,
    private readonly previews: PreviewRenderService,
    private readonly logger: Logger,
  ) {
    tasks.registerKind<{ projectId: string; clipId: string; sampleFps?: number }, DetectFacesResult>({ kind: 'vision.detectFaces', lane: 'default', title: () => 'Detect faces', run: (ctx) => this.detectFaces(ctx.params, ctx) });
    tasks.registerKind<{ projectId: string; clipId: string; sampleFps?: number; categories?: string[] }, DetectObjectsResult>({ kind: 'vision.detectObjects', lane: 'default', title: () => 'Detect objects', run: (ctx) => this.detectObjects(ctx.params, ctx) });
    tasks.registerKind<BlurFacesOptions, BlurFacesResult>({ kind: 'vision.blurFaces', lane: 'default', title: () => 'Blur faces', run: (ctx) => this.blurFaces(ctx.params, ctx) });
    tasks.registerKind<TrackTargetOptions, TrackTargetResult>({ kind: 'vision.trackTarget', lane: 'default', title: () => 'Track target', run: (ctx) => this.trackTarget(ctx.params, ctx) });
    tasks.registerKind<{ projectId: string; maskId: string }, MaskVerificationResult>({ kind: 'vision.verifyMask', lane: 'render', title: () => 'Verify mask', run: (ctx) => this.verifyMask(ctx.params, ctx) });
  }

  // ---- public entry points (queue tasks) ----

  startDetectFaces(p: { projectId: string; clipId: string; sampleFps?: number }): TaskInfo {
    this.clipContext(p.projectId, p.clipId);
    return this.tasks.enqueue({ kind: 'vision.detectFaces', params: p, projectId: p.projectId, priority: 4 });
  }

  startDetectObjects(p: { projectId: string; clipId: string; sampleFps?: number; categories?: string[] }): TaskInfo {
    this.clipContext(p.projectId, p.clipId);
    return this.tasks.enqueue({ kind: 'vision.detectObjects', params: p, projectId: p.projectId, priority: 4 });
  }

  startBlurFaces(p: BlurFacesOptions): TaskInfo {
    this.sessions.get(p.projectId);
    this.clipContext(p.projectId, p.clipId);
    return this.tasks.enqueue({ kind: 'vision.blurFaces', params: p, projectId: p.projectId, priority: 3 });
  }

  startTrackTarget(p: TrackTargetOptions): TaskInfo {
    this.sessions.get(p.projectId);
    this.clipContext(p.projectId, p.clipId);
    return this.tasks.enqueue({ kind: 'vision.trackTarget', params: p, projectId: p.projectId, priority: 3 });
  }

  startVerifyMask(p: { projectId: string; maskId: string }): TaskInfo {
    const doc = this.doc(p.projectId);
    if (!doc.masks.some((m) => m.id === p.maskId)) throw new AppError({ code: 'COMMAND_FAILED', operation: 'vision.verifyMask', message: `Mask ${p.maskId} not found` });
    return this.tasks.enqueue({ kind: 'vision.verifyMask', params: p, projectId: p.projectId, priority: 3 });
  }

  analysisPath(projectId: string, clipId: string, kind: 'faces' | 'objects' | 'ocr'): string {
    const dir = path.join(this.projects.get(projectId).dataDir, 'analysis');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${clipId}-${kind}.json`);
  }

  readAnalysis<T>(projectId: string, clipId: string, kind: 'faces' | 'objects' | 'ocr'): T | null {
    const p = this.analysisPath(projectId, clipId, kind);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  writeAnalysis(projectId: string, clipId: string, kind: 'faces' | 'objects' | 'ocr', data: unknown): void {
    fs.writeFileSync(this.analysisPath(projectId, clipId, kind), JSON.stringify(data), 'utf8');
  }

  // ---- helpers ----

  private doc(projectId: string): ProjectDocument {
    return this.sessions.isOpen(projectId) ? this.sessions.get(projectId).document : this.projects.loadLatestDocument(projectId);
  }

  clipContext(projectId: string, clipId: string): ClipContext {
    const doc = this.doc(projectId);
    const clip = doc.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    if (!clip) throw new AppError({ code: 'COMMAND_FAILED', operation: 'vision', message: `Clip ${clipId} not found`, details: { clipId } });
    const asset = doc.assets[clip.assetId];
    if (!asset) throw new AppError({ code: 'ASSET_NOT_FOUND', operation: 'vision', message: `Asset ${clip.assetId} not found` });
    if (!asset.hasVideo) throw new AppError({ code: 'INVALID_INPUT', operation: 'vision', message: `"${clip.name}" has no video to analyze` });
    if (asset.missing || !fs.existsSync(asset.sourcePath)) throw new AppError({ code: 'FILE_NOT_FOUND', operation: 'vision', message: `Media file for ${asset.name} is missing`, details: { path: asset.sourcePath } });
    const file = asset.proxyPath && fs.existsSync(asset.proxyPath) ? asset.proxyPath : asset.sourcePath;
    const sourceStartMs = clip.freeze ? clip.freeze.atSourceMs : clip.sourceInMs;
    const sourceEndMs = clip.freeze ? clip.freeze.atSourceMs + 200 : clip.sourceOutMs;
    return { doc, clip, asset, file, sourceW: asset.width ?? doc.settings.width, sourceH: asset.height ?? doc.settings.height, seqW: doc.settings.width, seqH: doc.settings.height, sourceStartMs, sourceEndMs };
  }

  private toSeq(c: ClipContext, box: NormBox): NormBox {
    return sourceBoxToSequence(c.clip, c.sourceW, c.sourceH, c.seqW, c.seqH, box);
  }

  private toSrc(c: ClipContext, box: NormBox): NormBox {
    return sequenceBoxToSource(c.clip, c.sourceW, c.sourceH, c.seqW, c.seqH, box);
  }

  /** Greedy IoU linking of per-frame detections into tracks (tracking by detection). */
  private link(frames: Array<{ tMs: number; boxes: Array<{ box: NormBox; srcBox: NormBox; score: number; label?: string }> }>, sampleIntervalMs: number, labelOf: (i: number, label?: string) => string): LinkedTrack[] {
    const tracks: LinkedTrack[] = [];
    const maxGap = sampleIntervalMs * 3 + 1;
    for (const frame of frames) {
      const open = tracks.filter((t) => frame.tMs - t.closedAt <= maxGap);
      const used = new Set<number>();
      const candidates: Array<{ iou: number; track: LinkedTrack; i: number }> = [];
      frame.boxes.forEach((b, i) => {
        for (const t of open) {
          const last = t.frames[t.frames.length - 1]!;
          if (b.label !== undefined && !t.label.startsWith(b.label)) continue;
          const iou = boxIou(last.box, b.box);
          if (iou >= 0.25) candidates.push({ iou, track: t, i });
        }
      });
      candidates.sort((a, b) => b.iou - a.iou);
      const matched = new Set<LinkedTrack>();
      for (const c of candidates) {
        if (used.has(c.i) || matched.has(c.track)) continue;
        const b = frame.boxes[c.i]!;
        c.track.frames.push({ tMs: frame.tMs, box: b.box, srcBox: b.srcBox, score: b.score });
        c.track.closedAt = frame.tMs;
        used.add(c.i);
        matched.add(c.track);
      }
      frame.boxes.forEach((b, i) => {
        if (used.has(i)) return;
        tracks.push({ index: tracks.length, label: labelOf(tracks.length, b.label), frames: [{ tMs: frame.tMs, box: b.box, srcBox: b.srcBox, score: b.score }], closedAt: frame.tMs });
      });
    }
    return tracks;
  }

  private trackInfo(t: LinkedTrack, sampleIntervalMs: number): FaceTrackInfo {
    const n = t.frames.length;
    const meanArea = t.frames.reduce((s, f) => s + f.box.w * f.box.h, 0) / n;
    const meanCenterX = t.frames.reduce((s, f) => s + f.box.x + f.box.w / 2, 0) / n;
    const meanScore = t.frames.reduce((s, f) => s + f.score, 0) / n;
    const first = t.frames[0]!;
    return { index: t.index, detections: n, startMs: first.tMs, endMs: t.frames[n - 1]!.tMs + sampleIntervalMs, meanArea, meanCenterX, meanScore, box: first.box };
  }

  // ---- detection ----

  private async detectFaces(p: { projectId: string; clipId: string; sampleFps?: number }, ctx: Ctx): Promise<DetectFacesResult> {
    const c = this.clipContext(p.projectId, p.clipId);
    const sampleFps = Math.max(0.5, Math.min(30, p.sampleFps ?? 6));
    ctx.progress(0.02, 'faces');
    const res = await this.worker.detectFaces(c.file, { sampleFps, startMs: c.sourceStartMs, endMs: c.sourceEndMs, signal: ctx.signal, onProgress: (r, m) => ctx.progress(0.02 + r * 0.9, m) });
    const frames = res.frames.map((f) => ({ tMs: Math.round(sourceToTimelineMs(c.clip, f.t_ms)), boxes: f.faces.map((face) => ({ box: this.toSeq(c, face), srcBox: { x: face.x, y: face.y, w: face.w, h: face.h }, score: face.score })) })).sort((a, b) => a.tMs - b.tMs);
    const interval = 1000 / sampleFps;
    const tracks = this.link(frames, interval, (i) => `Face ${i + 1}`);
    const result: DetectFacesResult = {
      clipId: c.clip.id,
      sampleFps,
      framesAnalyzed: frames.length,
      totalDetections: res.total_faces,
      tracks: tracks.map((t) => this.trackInfo(t, interval)),
      frames: frames.map((f) => ({ tMs: f.tMs, boxes: f.boxes.map((b) => ({ ...b.box, score: b.score, track: tracks.find((t) => t.frames.some((x) => x.tMs === f.tMs && x.box === b.box))?.index ?? -1 })) })),
      analyzedFile: c.file === c.asset.sourcePath ? 'source' : 'proxy',
      durationMs: c.clip.durationMs,
    };
    this.writeAnalysis(p.projectId, c.clip.id, 'faces', { ...result, linked: tracks.map((t) => ({ index: t.index, frames: t.frames })) });
    ctx.progress(1, null);
    this.logger.info({ module: 'vision', operation: 'detectFaces', clipId: c.clip.id, faces: res.total_faces, tracks: tracks.length, frames: frames.length }, 'faces detected');
    return result;
  }

  private async detectObjects(p: { projectId: string; clipId: string; sampleFps?: number; categories?: string[] }, ctx: Ctx): Promise<DetectObjectsResult> {
    const c = this.clipContext(p.projectId, p.clipId);
    const sampleFps = Math.max(0.5, Math.min(15, p.sampleFps ?? 2));
    const res = await this.worker.detectObjects(c.file, { sampleFps, startMs: c.sourceStartMs, endMs: c.sourceEndMs, categories: p.categories, signal: ctx.signal, onProgress: (r, m) => ctx.progress(r * 0.9, m) });
    const frames = res.frames.map((f) => ({ tMs: Math.round(sourceToTimelineMs(c.clip, f.t_ms)), boxes: f.objects.map((o) => ({ box: this.toSeq(c, o), srcBox: { x: o.x, y: o.y, w: o.w, h: o.h }, score: o.score, label: o.label })) })).sort((a, b) => a.tMs - b.tMs);
    const interval = 1000 / sampleFps;
    const tracks = this.link(frames, interval, (i, label) => `${label ?? 'object'} ${i + 1}`);
    const labels = new Map<string, { count: number; maxScore: number }>();
    for (const f of frames) for (const b of f.boxes) {
      const cur = labels.get(b.label) ?? { count: 0, maxScore: 0 };
      labels.set(b.label, { count: cur.count + 1, maxScore: Math.max(cur.maxScore, b.score) });
    }
    const result: DetectObjectsResult = {
      clipId: c.clip.id,
      sampleFps,
      framesAnalyzed: frames.length,
      labels: [...labels.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.count - a.count),
      frames: frames.map((f) => ({ tMs: f.tMs, boxes: f.boxes.map((b) => ({ ...b.box, score: b.score, label: b.label })) })),
      tracks: tracks.map((t) => ({ index: t.index, label: t.label.replace(/ \d+$/, ''), startMs: t.frames[0]!.tMs, endMs: t.frames[t.frames.length - 1]!.tMs + interval, detections: t.frames.length, box: t.frames[0]!.box })),
    };
    this.writeAnalysis(p.projectId, c.clip.id, 'objects', { ...result, linked: tracks.map((t) => ({ index: t.index, frames: t.frames })) });
    ctx.progress(1, null);
    return result;
  }

  // ---- masks ----

  private selectTracks(tracks: LinkedTrack[], interval: number, selector: FaceSelector): LinkedTrack[] {
    if (tracks.length === 0) return [];
    if (typeof selector === 'number') return tracks.filter((t) => t.index === selector);
    const infos = tracks.map((t) => this.trackInfo(t, interval));
    const pick = (fn: (a: FaceTrackInfo, b: FaceTrackInfo) => number) => {
      const best = [...infos].sort(fn)[0]!;
      return tracks.filter((t) => t.index === best.index);
    };
    switch (selector) {
      case 'largest':
        return pick((a, b) => b.meanArea - a.meanArea);
      case 'leftmost':
        return pick((a, b) => a.meanCenterX - b.meanCenterX);
      case 'rightmost':
        return pick((a, b) => b.meanCenterX - a.meanCenterX);
      case 'center':
        return pick((a, b) => Math.abs(a.meanCenterX - 0.5) - Math.abs(b.meanCenterX - 0.5));
      case 'all':
      default:
        return tracks;
    }
  }

  /** Runs the tracker on the source file for a timeline range and returns keyframes in sequence coordinates. */
  private async trackOnSource(c: ClipContext, srcBox: NormBox, startMs: number, endMs: number, detector: 'face' | null, ctx: Ctx, progress: [number, number]): Promise<{ keyframes: MaskKeyframe[]; status: 'ok' | 'partial' | 'lost'; lostRanges: Array<{ startMs: number; endMs: number }>; coveredEndMs: number }> {
    const sStart = timelineToSourceMs(c.clip, startMs);
    const sEnd = timelineToSourceMs(c.clip, Math.max(startMs + 1, endMs - 1));
    const a = Math.min(sStart, sEnd);
    const b = Math.max(sStart, sEnd);
    if (c.clip.reverse) this.logger.info({ module: 'vision', clipId: c.clip.id }, 'tracking a reversed clip: tracking runs forward in source time');
    const res = await this.worker.track(c.file, { startMs: a, endMs: b, box: srcBox, detector, signal: ctx.signal, onProgress: (r) => ctx.progress(progress[0] + r * (progress[1] - progress[0]), 'tracking') });
    const raw: MaskKeyframe[] = res.keyframes.map((k) => {
      const box = this.toSeq(c, { x: k.x, y: k.y, w: k.w, h: k.h });
      return { tMs: Math.round(sourceToTimelineMs(c.clip, k.t_ms)), ...box, confidence: k.confidence };
    });
    const keyframes = simplifyKeyframes(raw);
    const lostRanges = res.lost_ranges.map((r) => ({ startMs: Math.round(sourceToTimelineMs(c.clip, r.start_ms)), endMs: Math.round(sourceToTimelineMs(c.clip, r.end_ms)) })).map((r) => ({ startMs: Math.min(r.startMs, r.endMs), endMs: Math.max(r.startMs, r.endMs) }));
    return { keyframes, status: res.status, lostRanges, coveredEndMs: Math.round(sourceToTimelineMs(c.clip, res.covered_end_ms)) };
  }

  private async blurFaces(p: BlurFacesOptions, ctx: Ctx): Promise<BlurFacesResult> {
    const session = this.sessions.get(p.projectId);
    const c = this.clipContext(p.projectId, p.clipId);
    const sampleFps = Math.max(1, Math.min(30, p.sampleFps ?? 6));
    const interval = 1000 / sampleFps;
    ctx.progress(0.02, 'faces');
    const res = await this.worker.detectFaces(c.file, { sampleFps, startMs: c.sourceStartMs, endMs: c.sourceEndMs, signal: ctx.signal, onProgress: (r, m) => ctx.progress(0.02 + r * 0.3, m) });
    const frames = res.frames.map((f) => ({ tMs: Math.round(sourceToTimelineMs(c.clip, f.t_ms)), boxes: f.faces.map((face) => ({ box: this.toSeq(c, face), srcBox: { x: face.x, y: face.y, w: face.w, h: face.h }, score: face.score })) })).sort((a, b) => a.tMs - b.tMs);
    const tracks = this.link(frames, interval, (i) => `Face ${i + 1}`);
    if (res.total_faces === 0 || tracks.length === 0) {
      throw new AppError({ code: 'NO_FACES_FOUND', operation: 'vision.blurFaces', message: `No faces were detected in "${c.clip.name}" (${frames.length} frames analyzed at ${sampleFps} fps)`, details: { clipId: c.clip.id, framesAnalyzed: frames.length } });
    }
    const selected = this.selectTracks(tracks, interval, p.selector ?? 'all');
    const skipped: BlurFacesResult['skipped'] = tracks.filter((t) => !selected.includes(t)).map((t) => ({ trackIndex: t.index, reason: 'not-selected' as const }));
    const useTracker = p.track !== false && c.asset.kind !== 'image' && !c.clip.freeze;
    const commands: Command[] = [];
    const created: BlurFacesResult['masks'] = [];
    const clipEnd = c.clip.startMs + c.clip.durationMs;
    let i = 0;
    for (const t of selected) {
      const first = t.frames[0]!;
      const last = t.frames[t.frames.length - 1]!;
      const startMs = Math.max(c.clip.startMs, first.tMs);
      const endMs = Math.min(clipEnd, last.tMs + interval);
      if (endMs - startMs < interval / 2) {
        skipped.push({ trackIndex: t.index, reason: 'too-short' });
        continue;
      }
      let keyframes: MaskKeyframe[];
      let status: MaskTrack['status'] = 'ok';
      let lostRanges: Array<{ startMs: number; endMs: number }> = [];
      let maskEnd = endMs;
      if (useTracker) {
        const tr = await this.trackOnSource(c, first.srcBox, first.tMs, endMs, 'face', ctx, [0.35 + (0.6 * i) / selected.length, 0.35 + (0.6 * (i + 1)) / selected.length]);
        keyframes = tr.keyframes;
        status = tr.status;
        lostRanges = tr.lostRanges;
        if (tr.status === 'lost') maskEnd = Math.min(endMs, Math.max(startMs + 1, tr.coveredEndMs));
      } else {
        keyframes = simplifyKeyframes(t.frames.map((f) => ({ tMs: f.tMs, ...f.box, confidence: f.score })));
      }
      // faces benefit from a margin so hair/chin stay covered; the compiler adds its own 10 % window margin
      keyframes = keyframes.map((k) => ({ ...k, ...expandBox(k, 0.15) }));
      const mask = createMaskTrack({ clipId: c.clip.id, kind: p.kind ?? 'blur', shape: p.shape ?? 'ellipse', strength: p.strength, source: 'auto-face', label: t.label, startMs, endMs: maskEnd });
      mask.keyframes = keyframes;
      mask.status = status;
      mask.lostRanges = lostRanges;
      commands.push({ type: 'mask.add', mask });
      const lostMs = lostRanges.reduce((n, r) => n + Math.max(0, Math.min(r.endMs, maskEnd) - Math.max(r.startMs, startMs)), 0);
      created.push({ maskId: mask.id, trackIndex: t.index, startMs, endMs: maskEnd, keyframes: keyframes.length, coverage: Math.max(0, 1 - lostMs / Math.max(1, maskEnd - startMs)), status: status === 'ok' ? 'ok' : 'partial' });
      i++;
    }
    if (commands.length === 0) throw new AppError({ code: 'NO_FACES_FOUND', operation: 'vision.blurFaces', message: 'Faces were detected but none matched the selection', details: { tracks: tracks.length, selector: p.selector ?? 'all' } });
    session.executeBatch(commands, `blur ${commands.length} face(s)`, 'ai');
    this.writeAnalysis(p.projectId, c.clip.id, 'faces', { clipId: c.clip.id, sampleFps, framesAnalyzed: frames.length, totalDetections: res.total_faces, tracks: tracks.map((t) => this.trackInfo(t, interval)), frames: [], analyzedFile: c.file === c.asset.sourcePath ? 'source' : 'proxy', durationMs: c.clip.durationMs, linked: tracks.map((t) => ({ index: t.index, frames: t.frames })) });
    ctx.progress(1, null);
    this.logger.info({ module: 'vision', operation: 'blurFaces', clipId: c.clip.id, masks: created.length, tracker: useTracker }, 'face masks created');
    return { clipId: c.clip.id, masks: created, facesDetected: res.total_faces, framesAnalyzed: frames.length, sampleFps, skipped };
  }

  private async trackTarget(p: TrackTargetOptions, ctx: Ctx): Promise<TrackTargetResult> {
    const session = this.sessions.get(p.projectId);
    const c = this.clipContext(p.projectId, p.clipId);
    const clipEnd = c.clip.startMs + c.clip.durationMs;
    const startMs = Math.max(c.clip.startMs, Math.min(clipEnd - 1, p.startMs ?? c.clip.startMs));
    const requestedEnd = Math.min(clipEnd, p.endMs ?? clipEnd);
    if (requestedEnd <= startMs) throw new AppError({ code: 'INVALID_INPUT', operation: 'vision.trackTarget', message: 'Invalid range' });
    if (p.box.w <= 0.005 || p.box.h <= 0.005) throw new AppError({ code: 'INVALID_INPUT', operation: 'vision.trackTarget', message: 'The selected region is too small' });
    const srcBox = this.toSrc(c, p.box);
    let keyframes: MaskKeyframe[];
    let status: MaskTrack['status'] = 'ok';
    let lostRanges: Array<{ startMs: number; endMs: number }> = [];
    let maskEnd = requestedEnd;
    if (c.asset.kind === 'image' || c.clip.freeze) {
      keyframes = [{ tMs: startMs, ...p.box, confidence: 1 }];
    } else {
      const tr = await this.trackOnSource(c, srcBox, startMs, requestedEnd, p.detector ?? null, ctx, [0.05, 0.95]);
      keyframes = tr.keyframes;
      status = tr.status;
      lostRanges = tr.lostRanges;
      if (tr.status === 'lost') maskEnd = Math.min(requestedEnd, Math.max(startMs + 1, tr.coveredEndMs));
    }
    const mask = createMaskTrack({ clipId: c.clip.id, kind: p.kind ?? 'blur', shape: p.shape ?? 'rect', strength: p.strength, source: p.detector === 'face' ? 'auto-face' : 'manual', label: p.label ?? `Region ${session.document.masks.length + 1}`, startMs, endMs: maskEnd });
    mask.keyframes = keyframes;
    mask.status = status;
    mask.lostRanges = lostRanges;
    session.execute({ type: 'mask.add', mask }, 'ai');
    ctx.progress(1, null);
    if (status === 'lost') this.logger.warn({ module: 'vision', operation: 'trackTarget', clipId: c.clip.id, coveredEndMs: maskEnd, requestedEnd }, 'tracking lost the target before the requested end');
    return { clipId: c.clip.id, maskId: mask.id, status, keyframes: keyframes.length, coveredStartMs: startMs, coveredEndMs: maskEnd, requestedEndMs: requestedEnd, lostRanges };
  }

  /** Renders sample frames with and without the mask and measures sharpness inside its box. */
  private async verifyMask(p: { projectId: string; maskId: string }, ctx: Ctx): Promise<MaskVerificationResult> {
    if (!this.ffmpeg.ffmpeg) throw new AppError({ code: 'FFMPEG_NOT_FOUND', operation: 'vision.verifyMask', message: 'FFmpeg is required' });
    const doc = this.doc(p.projectId);
    const mask = doc.masks.find((m) => m.id === p.maskId);
    if (!mask) throw new AppError({ code: 'COMMAND_FAILED', operation: 'vision.verifyMask', message: `Mask ${p.maskId} not found` });
    const span = mask.endMs - mask.startMs;
    const fractions = span > 2000 ? [0.15, 0.5, 0.85] : span > 400 ? [0.3, 0.7] : [0.5];
    const times = fractions.map((f) => Math.round(mask.startMs + span * f));
    const samples: MaskVerificationResult['samples'] = [];
    const scratch = path.join(this.projects.get(p.projectId).dataDir, 'cache', 'verify');
    fs.mkdirSync(scratch, { recursive: true });
    const pixelate = mask.kind === 'pixelate';
    for (let i = 0; i < times.length; i++) {
      const t = times[i]!;
      const box = maskBoxAt({ ...mask, enabled: true }, t);
      if (!box) continue;
      ctx.progress(i / times.length, `frame ${i + 1}/${times.length}`);
      const before = await this.previews.renderFrame(doc, p.projectId, t, { bypass: { masks: true }, out: path.join(scratch, `${mask.id}-${t}-before.png`), signal: ctx.signal });
      const after = await this.previews.renderFrame(doc, p.projectId, t, { out: path.join(scratch, `${mask.id}-${t}-after.png`), signal: ctx.signal });
      try {
        if (pixelate) {
          // pixelation keeps hard block edges (high Laplacian variance), so verify that the region equals its block-average reconstruction
          const win = maskWindowAt(mask, t, doc.settings.width, doc.settings.height);
          if (!win) continue;
          const block = pixelateBlockPx(mask.strength, doc.settings.height);
          const region = { x: win.x + Math.round(win.w * 0.15), y: win.y + Math.round(win.h * 0.15), w: Math.round(win.w * 0.7), h: Math.round(win.h * 0.7) };
          const fb = await grayFrame(this.ffmpeg.ffmpeg, before, 0, null, ctx.signal);
          const fa = await grayFrame(this.ffmpeg.ffmpeg, after, 0, null, ctx.signal);
          const eb = blockMeanError(fb.data, fb.width, fb.height, region, block);
          const ea = blockMeanError(fa.data, fa.width, fa.height, region, block);
          const ratio = eb > 1e-6 ? ea / eb : ea <= 1e-6 ? 0 : 1;
          samples.push({ tMs: t, before: round3(eb), after: round3(ea), ratio: round3(ratio), ok: ea < 1.5 && (eb < 1.5 || ratio < MASK_VERIFY_RATIO) });
        } else {
          const inner = { x: box.x + box.w * 0.1, y: box.y + box.h * 0.1, w: box.w * 0.8, h: box.h * 0.8 };
          const b = await frameSharpness(this.ffmpeg.ffmpeg, before, 0, inner, ctx.signal);
          const a = await frameSharpness(this.ffmpeg.ffmpeg, after, 0, inner, ctx.signal);
          const ratio = b.sharpness > 1e-6 ? a.sharpness / b.sharpness : a.sharpness <= 1e-6 ? 0 : 1;
          samples.push({ tMs: t, before: round3(b.sharpness), after: round3(a.sharpness), ratio: round3(ratio), ok: ratio < MASK_VERIFY_RATIO || (b.sharpness < 1 && a.sharpness <= b.sharpness) });
        }
      } finally {
        fs.rmSync(before, { force: true });
        fs.rmSync(after, { force: true });
      }
    }
    const ok = samples.length > 0 && samples.every((s) => s.ok);
    const meanBefore = samples.reduce((n, s) => n + s.before, 0) / Math.max(1, samples.length);
    const meanAfter = samples.reduce((n, s) => n + s.after, 0) / Math.max(1, samples.length);
    if (this.sessions.isOpen(p.projectId)) {
      this.sessions.get(p.projectId).execute({ type: 'mask.update', maskId: mask.id, patch: { verification: { ok, at: new Date().toISOString(), before: round3(meanBefore), after: round3(meanAfter), samples: samples.length } } }, 'ai');
    }
    ctx.progress(1, null);
    this.logger.info({ module: 'vision', operation: 'verifyMask', maskId: mask.id, ok, samples }, ok ? 'mask verified' : 'mask verification failed');
    return { maskId: mask.id, ok, samples, threshold: MASK_VERIFY_RATIO, method: pixelate ? 'block-mean-error' : 'laplacian-variance' };
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export { newId as _newId };
