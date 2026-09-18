import fs from 'node:fs';
import path from 'node:path';
import { createAssetRef, createClip, newId, type AssetRef, type ProjectDocument } from '@sevenvid/core';
import type { AssetInfo, SessionState, TaskInfo } from '@sevenvid/ipc';
import type { AppDatabase } from '../db/database';
import type { AssetRow } from '../db/repos/assets';
import { AppError } from '../errors';
import type { EventBus } from '../events/EventBus';
import type { FfmpegLocation } from '../ffmpeg/locator';
import { mediaKindFromPath } from '../fs/FsService';
import type { Logger } from '../logging/logger';
import type { AppPaths } from '../paths/AppPaths';
import type { SessionManager } from '../project/SessionManager';
import type { SearchService } from '../search/SearchService';
import type { SettingsService } from '../settings/SettingsService';
import type { TaskManager } from '../tasks/TaskManager';
import { fileFingerprint, probeMedia, type MediaInfo } from './probe';
import { DEFAULT_PLAYBACK_CAPABILITIES, decideProxy, generateProxy, type PlaybackCapabilities } from './proxy';
import { generatePoster, generateSprite, type SpriteMeta } from './thumbnails';
import { generateWaveform, type WaveformData } from './waveform';

export interface ImportResult {
  assets: AssetInfo[];
  skipped: Array<{ path: string; reason: 'not-found' | 'unsupported' | 'duplicate' }>;
}

export function rowToInfo(row: AssetRow, cacheDir: string): AssetInfo {
  let spriteMeta: SpriteMeta | null = null;
  if (row.spritePath) {
    try {
      spriteMeta = JSON.parse(fs.readFileSync(row.spritePath.replace(/\.png$/, '.json'), 'utf8')) as SpriteMeta;
    } catch {
      spriteMeta = null;
    }
  }
  void cacheDir;
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    name: row.name,
    sourcePath: row.sourcePath,
    mime: row.mime,
    container: row.container,
    durationMs: row.durationMs,
    width: row.width,
    height: row.height,
    fps: row.fps,
    videoCodec: row.videoCodec,
    audioCodec: row.audioCodec,
    channels: row.channels,
    sampleRate: row.sampleRate,
    bitrate: row.bitrate,
    sizeBytes: row.sizeBytes,
    thumbnailPath: row.thumbnailPath,
    spritePath: row.spritePath,
    spriteMeta: spriteMeta ? { count: spriteMeta.count, cols: spriteMeta.cols, rows: spriteMeta.rows, tileWidth: spriteMeta.tileWidth, tileHeight: spriteMeta.tileHeight, intervalMs: spriteMeta.intervalMs } : null,
    waveformPath: row.waveformPath,
    proxyPath: row.proxyPath,
    proxyStatus: row.proxyStatus,
    analysisStatus: row.analysisStatus,
    analysisError: row.analysisError,
    tags: row.tags,
    favorite: row.favorite,
    missing: row.missing,
    origin: row.origin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class MediaService {
  private caps: PlaybackCapabilities = DEFAULT_PLAYBACK_CAPABILITIES;

  constructor(
    private readonly db: AppDatabase,
    private readonly paths: AppPaths,
    private readonly ffmpeg: FfmpegLocation,
    private readonly tasks: TaskManager,
    private readonly sessions: SessionManager,
    private readonly settings: SettingsService,
    private readonly search: SearchService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {
    tasks.registerKind<{ assetId: string }, AssetInfo>({
      kind: 'media.analyze',
      lane: 'io',
      title: (p) => `Analyze ${db.assets.get(p.assetId)?.name ?? p.assetId}`,
      run: (ctx) => this.runAnalyze(ctx.params.assetId, ctx),
    });
    tasks.registerKind<{ assetId: string }, string>({
      kind: 'media.proxy',
      lane: 'default',
      pausable: true,
      title: (p) => `Proxy ${db.assets.get(p.assetId)?.name ?? p.assetId}`,
      run: (ctx) => this.runProxy(ctx.params.assetId, ctx),
    });
  }

  setPlaybackCapabilities(caps: PlaybackCapabilities): void {
    this.caps = caps;
    this.logger.info({ operation: 'playbackCapabilities', caps }, 'renderer playback capabilities updated');
  }

  get playbackCapabilities(): PlaybackCapabilities {
    return this.caps;
  }

  private requireFfmpeg(): { ffmpeg: string; ffprobe: string } {
    if (!this.ffmpeg.ffmpeg || !this.ffmpeg.ffprobe) {
      throw new AppError({ code: 'FFMPEG_NOT_FOUND', operation: 'media', message: 'FFmpeg/FFprobe are required for media analysis' });
    }
    return { ffmpeg: this.ffmpeg.ffmpeg, ffprobe: this.ffmpeg.ffprobe };
  }

  cacheDirFor(assetId: string): string {
    return path.join(this.paths.cache, 'media', assetId);
  }

  info(row: AssetRow): AssetInfo {
    return rowToInfo(row, this.paths.cache);
  }

  /** Registers files as assets (never copies or modifies them) and queues analysis. */
  import(paths: string[], projectId: string | null): ImportResult {
    this.requireFfmpeg();
    const result: ImportResult = { assets: [], skipped: [] };
    for (const raw of paths) {
      const file = path.resolve(raw);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        result.skipped.push({ path: file, reason: 'not-found' });
        continue;
      }
      const kind = mediaKindFromPath(file);
      if (!kind) {
        result.skipped.push({ path: file, reason: 'unsupported' });
        continue;
      }
      const existing = this.db.assets.findByPath(projectId, file);
      if (existing) {
        result.skipped.push({ path: file, reason: 'duplicate' });
        result.assets.push(this.info(existing));
        continue;
      }
      const row = this.db.assets.insert({ id: newId('ast'), projectId, kind, name: path.basename(file), sourcePath: file, fingerprint: fileFingerprint(file), sizeBytes: fs.statSync(file).size, analysisStatus: 'pending', proxyStatus: 'none' });
      this.search.indexAsset({ id: row.id, projectId, name: row.name, tags: [], kind });
      this.tasks.enqueue({ kind: 'media.analyze', params: { assetId: row.id }, projectId, priority: 5 });
      this.bus.emit('assets.changed', { projectId, assetId: row.id, reason: 'imported' });
      result.assets.push(this.info(row));
      this.logger.info({ operation: 'import', assetId: row.id, file }, 'media imported');
    }
    return result;
  }

  list(opts: { projectId?: string | null; includeLibrary?: boolean; kind?: AssetRow['kind'] | AssetRow['kind'][]; favorite?: boolean; query?: string } = {}): AssetInfo[] {
    let rows = this.db.assets.list({ projectId: opts.projectId, includeLibrary: opts.includeLibrary, kind: opts.kind, favorite: opts.favorite });
    if (opts.query?.trim()) {
      const q = opts.query.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q)));
    }
    return rows.map((r) => this.info(this.refreshMissing(r)));
  }

  get(assetId: string): AssetInfo | null {
    const row = this.db.assets.get(assetId);
    return row ? this.info(this.refreshMissing(row)) : null;
  }

  requireRow(assetId: string): AssetRow {
    const row = this.db.assets.get(assetId);
    if (!row) throw new AppError({ code: 'ASSET_NOT_FOUND', operation: 'media', message: `Asset ${assetId} not found`, details: { assetId } });
    return row;
  }

  update(assetId: string, patch: { name?: string; tags?: string[]; favorite?: boolean }): AssetInfo {
    const row = this.requireRow(assetId);
    const next = this.db.assets.update(assetId, { name: patch.name?.trim() || row.name, tags: patch.tags ?? row.tags, favorite: patch.favorite ?? row.favorite })!;
    this.search.indexAsset({ id: next.id, projectId: next.projectId, name: next.name, tags: next.tags, kind: next.kind });
    this.bus.emit('assets.changed', { projectId: next.projectId, assetId, reason: 'updated' });
    return this.info(next);
  }

  remove(assetId: string, deleteCache = true): boolean {
    const row = this.requireRow(assetId);
    if (row.projectId && this.sessions.isOpen(row.projectId)) {
      const session = this.sessions.get(row.projectId);
      if (session.document.assets[assetId]) session.execute({ type: 'asset.remove', assetId }, 'external');
    }
    const ok = this.db.assets.delete(assetId);
    this.search.remove('asset', assetId);
    if (deleteCache) fs.rmSync(this.cacheDirFor(assetId), { recursive: true, force: true });
    this.bus.emit('assets.changed', { projectId: row.projectId, assetId, reason: 'removed' });
    return ok;
  }

  relink(assetId: string, newPath: string): TaskInfo {
    const row = this.requireRow(assetId);
    const file = path.resolve(newPath);
    if (!fs.existsSync(file)) throw new AppError({ code: 'FILE_NOT_FOUND', operation: 'media.relink', message: `File not found: ${file}` });
    if (!mediaKindFromPath(file)) throw new AppError({ code: 'MEDIA_UNSUPPORTED', operation: 'media.relink', message: `Unsupported media file: ${file}` });
    this.db.assets.update(assetId, { sourcePath: file, name: path.basename(file), fingerprint: fileFingerprint(file), missing: false, analysisStatus: 'pending', proxyStatus: 'none', proxyPath: null });
    this.syncDocumentRefs(assetId);
    this.bus.emit('assets.changed', { projectId: row.projectId, assetId, reason: 'relinked' });
    return this.tasks.enqueue({ kind: 'media.analyze', params: { assetId }, projectId: row.projectId, priority: 5 });
  }

  reanalyze(assetId: string): TaskInfo {
    const row = this.requireRow(assetId);
    this.db.assets.update(assetId, { analysisStatus: 'pending', analysisError: null });
    return this.tasks.enqueue({ kind: 'media.analyze', params: { assetId }, projectId: row.projectId, priority: 5 });
  }

  waveform(assetId: string): WaveformData | null {
    const row = this.requireRow(assetId);
    if (!row.waveformPath || !fs.existsSync(row.waveformPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(row.waveformPath, 'utf8')) as WaveformData;
    } catch {
      return null;
    }
  }

  /** Whether the renderer may load this file (assets, their derived cache files, or app-owned dirs). */
  isPathAllowed(file: string): boolean {
    const p = path.resolve(file);
    if (p.startsWith(this.paths.cache) || p.startsWith(this.paths.projects) || p.startsWith(this.paths.exports) || p.startsWith(this.paths.resources)) return true;
    const rows = this.db.assets.list({ limit: 5000 });
    return rows.some((r) => r.sourcePath === p || r.proxyPath === p || r.thumbnailPath === p || r.spritePath === p);
  }

  /** Builds the AssetRef used inside project documents. */
  toAssetRef(row: AssetRow): AssetRef {
    const hasVideo = row.kind === 'video' || row.kind === 'image' || Boolean(row.videoCodec);
    const hasAudio = row.kind === 'audio' || row.kind === 'music' || row.kind === 'voice' || Boolean(row.audioCodec);
    return createAssetRef({
      id: row.id,
      kind: row.kind === 'image' ? 'image' : row.kind === 'video' || row.kind === 'generated' ? (row.videoCodec ? 'video' : 'audio') : row.kind === 'audio' || row.kind === 'music' || row.kind === 'voice' ? 'audio' : 'video',
      name: row.name,
      sourcePath: row.sourcePath,
      proxyPath: row.proxyStatus === 'ready' ? row.proxyPath : null,
      durationMs: row.durationMs,
      width: row.width,
      height: row.height,
      fps: row.fps,
      hasVideo,
      hasAudio,
      missing: row.missing,
    });
  }

  /** Adds an asset to a project's timeline (registers the AssetRef when needed). */
  addToTimeline(projectId: string, assetId: string, opts: { trackId?: string | null; atMs?: number | null; mode?: 'overwrite' | 'insert'; durationMs?: number | null } = {}): SessionState {
    const row = this.refreshMissing(this.requireRow(assetId));
    if (row.analysisStatus !== 'ready') throw new AppError({ code: 'MEDIA_ANALYSIS_FAILED', operation: 'media.addToTimeline', message: `"${row.name}" has not been analyzed yet (${row.analysisStatus})`, details: { assetId, status: row.analysisStatus } });
    if (row.missing) throw new AppError({ code: 'FILE_NOT_FOUND', operation: 'media.addToTimeline', message: `Media file for "${row.name}" is missing`, details: { assetId, path: row.sourcePath } });
    const session = this.sessions.get(projectId);
    const doc: ProjectDocument = session.document;
    const ref = this.toAssetRef(row);
    const wantKind = ref.kind === 'audio' ? 'audio' : 'video';
    const track = opts.trackId ? doc.tracks.find((t) => t.id === opts.trackId) : doc.tracks.find((t) => t.kind === wantKind && !t.locked);
    if (!track) throw new AppError({ code: 'COMMAND_FAILED', operation: 'media.addToTimeline', message: 'No suitable track found', details: { trackId: opts.trackId } });
    const trackEnd = track.clips.reduce((m, c) => Math.max(m, c.startMs + c.durationMs), 0);
    const startMs = opts.atMs ?? trackEnd;
    const clip = createClip({ trackId: track.id, asset: ref, startMs, imageDurationMs: opts.durationMs ?? 5000 });
    const commands = [] as Parameters<typeof session.execute>[0][];
    if (!doc.assets[ref.id]) commands.push({ type: 'asset.add', asset: ref });
    else commands.push({ type: 'asset.update', assetId: ref.id, patch: { durationMs: ref.durationMs, width: ref.width, height: ref.height, fps: ref.fps, proxyPath: ref.proxyPath, missing: false, sourcePath: ref.sourcePath } });
    commands.push({ type: 'clip.insert', clip, mode: opts.mode ?? 'overwrite' });
    if (row.projectId === null) this.db.assets.update(assetId, { projectId });
    return session.executeBatch(commands, `add ${row.name}`);
  }

  private refreshMissing(row: AssetRow): AssetRow {
    const missing = !fs.existsSync(row.sourcePath);
    if (missing !== row.missing) {
      const next = this.db.assets.update(row.id, { missing })!;
      this.syncDocumentRefs(row.id);
      return next;
    }
    return row;
  }

  /** Pushes the latest asset metadata into any open project document that references it. */
  private syncDocumentRefs(assetId: string): void {
    const row = this.db.assets.get(assetId);
    if (!row) return;
    const ref = this.toAssetRef(row);
    for (const p of this.db.projects.list()) {
      if (!this.sessions.isOpen(p.id)) continue;
      const session = this.sessions.get(p.id);
      if (!session.document.assets[assetId]) continue;
      session.execute({ type: 'asset.update', assetId, patch: { name: ref.name, sourcePath: ref.sourcePath, proxyPath: ref.proxyPath, durationMs: ref.durationMs, width: ref.width, height: ref.height, fps: ref.fps, hasVideo: ref.hasVideo, hasAudio: ref.hasAudio, missing: ref.missing } }, 'external');
    }
  }

  private async runAnalyze(assetId: string, ctx: { progress: (v: number, m?: string | null) => void; signal: AbortSignal; runChild: <P, R>(o: { kind: string; params: P; title?: string; priority?: number }) => Promise<R> }): Promise<AssetInfo> {
    const { ffmpeg, ffprobe } = this.requireFfmpeg();
    const row = this.requireRow(assetId);
    this.db.assets.update(assetId, { analysisStatus: 'running', analysisError: null });
    try {
      ctx.progress(0.05, 'probe');
      const info: MediaInfo = await probeMedia(ffprobe, row.sourcePath);
      const cache = this.cacheDirFor(assetId);
      fs.mkdirSync(cache, { recursive: true });
      let thumbnailPath: string | null = null;
      let spritePath: string | null = null;
      let waveformPath: string | null = null;
      if (info.kind !== 'audio') {
        ctx.progress(0.25, 'thumbnail');
        thumbnailPath = await generatePoster(ffmpeg, info, path.join(cache, 'poster.jpg'), { signal: ctx.signal });
      }
      if (info.kind === 'video') {
        ctx.progress(0.45, 'sprite');
        const sprite = await generateSprite(ffmpeg, info, path.join(cache, 'sprite.png'), { signal: ctx.signal });
        spritePath = sprite?.path ?? null;
      }
      if (info.audio) {
        ctx.progress(0.7, 'waveform');
        const wf = await generateWaveform(ffmpeg, info, path.join(cache, 'waveform.json'), { signal: ctx.signal });
        waveformPath = wf ? path.join(cache, 'waveform.json') : null;
      }
      const proxyDecision = decideProxy(info, { maxHeight: this.settings.get().storage.proxyHeight, caps: this.caps });
      const kind: AssetRow['kind'] = info.kind;
      const updated = this.db.assets.update(assetId, {
        kind,
        container: info.container,
        durationMs: info.durationMs,
        width: info.video?.width ?? null,
        height: info.video?.height ?? null,
        fps: info.video && !info.video.isImage ? info.video.fps : null,
        videoCodec: info.kind === 'audio' ? null : (info.video?.codec ?? null),
        audioCodec: info.audio?.codec ?? null,
        channels: info.audio?.channels ?? null,
        sampleRate: info.audio?.sampleRate ?? null,
        bitrate: info.bitrate,
        sizeBytes: info.sizeBytes,
        streams: [...info.videoStreams.map((v) => ({ type: 'video', ...v })), ...info.audioStreams.map((a) => ({ type: 'audio', ...a }))],
        thumbnailPath,
        spritePath,
        waveformPath,
        analysisStatus: 'ready',
        proxyStatus: proxyDecision.needed ? 'pending' : 'not-needed',
        missing: false,
      })!;
      this.syncDocumentRefs(assetId);
      this.bus.emit('assets.changed', { projectId: updated.projectId, assetId, reason: 'analyzed' });
      ctx.progress(0.9, proxyDecision.needed ? `proxy: ${proxyDecision.reason}` : 'done');
      if (proxyDecision.needed && this.settings.get().storage.autoGenerateProxies) {
        this.tasks.enqueue({ kind: 'media.proxy', params: { assetId }, projectId: updated.projectId, priority: 2 });
      }
      ctx.progress(1, null);
      return this.info(this.db.assets.get(assetId)!);
    } catch (err) {
      const appErr = AppError.from(err, { code: 'MEDIA_ANALYSIS_FAILED', operation: 'media.analyze', details: { assetId, path: row.sourcePath } });
      this.db.assets.update(assetId, { analysisStatus: 'failed', analysisError: appErr.info });
      this.bus.emit('assets.changed', { projectId: row.projectId, assetId, reason: 'analyzed' });
      throw appErr;
    }
  }

  private async runProxy(assetId: string, ctx: { progress: (v: number, m?: string | null, eta?: number | null) => void; signal: AbortSignal; setPauseHandlers: (h: { pause: () => void; resume: () => void } | null) => void }): Promise<string> {
    const { ffmpeg, ffprobe } = this.requireFfmpeg();
    const row = this.requireRow(assetId);
    this.db.assets.update(assetId, { proxyStatus: 'running' });
    try {
      const info = await probeMedia(ffprobe, row.sourcePath);
      const decision = decideProxy(info, { maxHeight: this.settings.get().storage.proxyHeight, caps: this.caps });
      const out = path.join(this.cacheDirFor(assetId), `proxy.${decision.format}`);
      await generateProxy(ffmpeg, info, out, {
        height: this.settings.get().storage.proxyHeight,
        format: decision.format,
        signal: ctx.signal,
        threads: this.settings.get().performance.ffmpegThreads,
        onProgress: (p) => ctx.progress(p.ratio ?? 0, p.speed ? `${p.speed.toFixed(1)}x` : null),
        onProcess: (_proc, controls) => ctx.setPauseHandlers({ pause: () => void controls.pause(), resume: () => void controls.resume() }),
      });
      const check = await probeMedia(ffprobe, out);
      if (!check.durationMs || (info.durationMs && Math.abs(check.durationMs - info.durationMs) > Math.max(500, info.durationMs * 0.02))) {
        throw new AppError({ code: 'EXPORT_VALIDATION_FAILED', operation: 'media.proxy', message: `Proxy duration ${check.durationMs} ms does not match source ${info.durationMs} ms`, details: { assetId } });
      }
      const updated = this.db.assets.update(assetId, { proxyPath: out, proxyStatus: 'ready' })!;
      this.syncDocumentRefs(assetId);
      this.bus.emit('assets.changed', { projectId: updated.projectId, assetId, reason: 'proxy' });
      return out;
    } catch (err) {
      const appErr = AppError.from(err, { code: 'FFMPEG_FAILED', operation: 'media.proxy', details: { assetId } });
      this.db.assets.update(assetId, { proxyStatus: 'failed' });
      this.bus.emit('assets.changed', { projectId: row.projectId, assetId, reason: 'proxy' });
      throw appErr;
    }
  }
}
