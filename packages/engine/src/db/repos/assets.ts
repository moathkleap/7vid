import type { AppErrorInfo, Fraction } from '@sevenvid/core';
import type { Row, SqlDriver } from '../driver';
import { fromBool, nowIso, num, parseJson, str, toBool } from './common';

export type AssetKind = 'video' | 'image' | 'audio' | 'music' | 'voice' | 'character' | 'generated' | 'template' | 'font';
export type ProxyStatus = 'none' | 'pending' | 'running' | 'ready' | 'failed' | 'not-needed';
export type AnalysisStatus = 'pending' | 'running' | 'ready' | 'failed';

export interface AssetRow {
  id: string;
  projectId: string | null;
  kind: AssetKind;
  name: string;
  sourcePath: string;
  fingerprint: string | null;
  mime: string | null;
  container: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: Fraction | null;
  videoCodec: string | null;
  audioCodec: string | null;
  channels: number | null;
  sampleRate: number | null;
  bitrate: number | null;
  sizeBytes: number | null;
  streams: unknown[];
  thumbnailPath: string | null;
  spritePath: string | null;
  waveformPath: string | null;
  proxyPath: string | null;
  proxyStatus: ProxyStatus;
  analysisStatus: AnalysisStatus;
  analysisError: AppErrorInfo | null;
  tags: string[];
  favorite: boolean;
  missing: boolean;
  origin: string;
  createdAt: string;
  updatedAt: string;
}

function map(row: Row): AssetRow {
  const fpsNum = num(row.fps_num);
  const fpsDen = num(row.fps_den);
  return {
    id: String(row.id),
    projectId: str(row.project_id),
    kind: row.kind as AssetKind,
    name: String(row.name),
    sourcePath: String(row.source_path),
    fingerprint: str(row.fingerprint),
    mime: str(row.mime),
    container: str(row.container),
    durationMs: num(row.duration_ms),
    width: num(row.width),
    height: num(row.height),
    fps: fpsNum && fpsDen ? { num: fpsNum, den: fpsDen } : null,
    videoCodec: str(row.video_codec),
    audioCodec: str(row.audio_codec),
    channels: num(row.channels),
    sampleRate: num(row.sample_rate),
    bitrate: num(row.bitrate),
    sizeBytes: num(row.size_bytes),
    streams: parseJson<unknown[]>(row.streams_json, []),
    thumbnailPath: str(row.thumbnail_path),
    spritePath: str(row.sprite_path),
    waveformPath: str(row.waveform_path),
    proxyPath: str(row.proxy_path),
    proxyStatus: (row.proxy_status as ProxyStatus) ?? 'none',
    analysisStatus: (row.analysis_status as AnalysisStatus) ?? 'pending',
    analysisError: parseJson<AppErrorInfo | null>(row.analysis_error_json, null),
    tags: parseJson<string[]>(row.tags_json, []),
    favorite: toBool(row.favorite),
    missing: toBool(row.missing),
    origin: String(row.origin ?? 'import'),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export type AssetInsert = Pick<AssetRow, 'id' | 'projectId' | 'kind' | 'name' | 'sourcePath'> & Partial<Omit<AssetRow, 'id' | 'projectId' | 'kind' | 'name' | 'sourcePath' | 'createdAt' | 'updatedAt'>>;

export class AssetsRepo {
  constructor(private readonly db: SqlDriver) {}

  insert(a: AssetInsert): AssetRow {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO assets (id, project_id, kind, name, source_path, fingerprint, mime, container, duration_ms, width, height, fps_num, fps_den, video_codec, audio_codec, channels, sample_rate, bitrate, size_bytes, streams_json, thumbnail_path, sprite_path, waveform_path, proxy_path, proxy_status, analysis_status, analysis_error_json, tags_json, favorite, missing, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.id, a.projectId, a.kind, a.name, a.sourcePath, a.fingerprint ?? null, a.mime ?? null, a.container ?? null, a.durationMs ?? null, a.width ?? null, a.height ?? null,
        a.fps?.num ?? null, a.fps?.den ?? null, a.videoCodec ?? null, a.audioCodec ?? null, a.channels ?? null, a.sampleRate ?? null, a.bitrate ?? null, a.sizeBytes ?? null,
        JSON.stringify(a.streams ?? []), a.thumbnailPath ?? null, a.spritePath ?? null, a.waveformPath ?? null, a.proxyPath ?? null, a.proxyStatus ?? 'none', a.analysisStatus ?? 'pending',
        a.analysisError ? JSON.stringify(a.analysisError) : null, JSON.stringify(a.tags ?? []), fromBool(a.favorite ?? false), fromBool(a.missing ?? false), a.origin ?? 'import', now, now,
      );
    return this.get(a.id)!;
  }

  get(id: string): AssetRow | undefined {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
    return row ? map(row) : undefined;
  }

  findByPath(projectId: string | null, sourcePath: string): AssetRow | undefined {
    const row = projectId
      ? this.db.prepare('SELECT * FROM assets WHERE project_id = ? AND source_path = ?').get(projectId, sourcePath)
      : this.db.prepare('SELECT * FROM assets WHERE project_id IS NULL AND source_path = ?').get(sourcePath);
    return row ? map(row) : undefined;
  }

  list(opts: { projectId?: string | null; includeLibrary?: boolean; kind?: AssetKind | AssetKind[]; favorite?: boolean; limit?: number } = {}): AssetRow[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.projectId !== undefined) {
      if (opts.projectId === null) where.push('project_id IS NULL');
      else if (opts.includeLibrary) {
        where.push('(project_id = ? OR project_id IS NULL)');
        params.push(opts.projectId);
      } else {
        where.push('project_id = ?');
        params.push(opts.projectId);
      }
    }
    if (opts.kind) {
      const kinds = Array.isArray(opts.kind) ? opts.kind : [opts.kind];
      where.push(`kind IN (${kinds.map(() => '?').join(',')})`);
      params.push(...kinds);
    }
    if (opts.favorite) where.push('favorite = 1');
    const sql = `SELECT * FROM assets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
    params.push(opts.limit ?? 1000);
    return this.db.prepare(sql).all(...params).map(map);
  }

  update(id: string, patch: Partial<Omit<AssetRow, 'id' | 'createdAt'>>): AssetRow | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const n = { ...current, ...patch, updatedAt: nowIso() };
    this.db
      .prepare(
        `UPDATE assets SET project_id = ?, kind = ?, name = ?, source_path = ?, fingerprint = ?, mime = ?, container = ?, duration_ms = ?, width = ?, height = ?, fps_num = ?, fps_den = ?, video_codec = ?, audio_codec = ?, channels = ?, sample_rate = ?, bitrate = ?, size_bytes = ?, streams_json = ?, thumbnail_path = ?, sprite_path = ?, waveform_path = ?, proxy_path = ?, proxy_status = ?, analysis_status = ?, analysis_error_json = ?, tags_json = ?, favorite = ?, missing = ?, origin = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        n.projectId, n.kind, n.name, n.sourcePath, n.fingerprint, n.mime, n.container, n.durationMs, n.width, n.height, n.fps?.num ?? null, n.fps?.den ?? null, n.videoCodec, n.audioCodec, n.channels, n.sampleRate, n.bitrate, n.sizeBytes,
        JSON.stringify(n.streams ?? []), n.thumbnailPath, n.spritePath, n.waveformPath, n.proxyPath, n.proxyStatus, n.analysisStatus, n.analysisError ? JSON.stringify(n.analysisError) : null, JSON.stringify(n.tags ?? []), fromBool(n.favorite), fromBool(n.missing), n.origin, n.updatedAt, id,
      );
    return this.get(id);
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM assets WHERE id = ?').run(id).changes) > 0;
  }
}
