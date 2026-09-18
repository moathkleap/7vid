import type { ProjectKind, SequenceSettings } from '@sevenvid/core';
import type { ProjectSummary } from '@sevenvid/ipc';
import type { Row, SqlDriver } from '../driver';
import { nowIso, parseJson, str } from './common';

export interface ProjectRow {
  id: string;
  name: string;
  kind: ProjectKind;
  settings: SequenceSettings;
  dataDir: string;
  currentVersionId: string | null;
  thumbnailPath: string | null;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  deletedAt: string | null;
}

function map(row: Row): ProjectRow {
  const settings = parseJson<SequenceSettings>(row.settings_json, { width: 1920, height: 1080, fps: { num: 30, den: 1 }, sampleRate: 48000, channels: 2, aspectPreset: '16:9', platformPreset: 'youtube' });
  return {
    id: String(row.id),
    name: String(row.name),
    kind: row.kind as ProjectKind,
    settings,
    dataDir: String(row.data_dir),
    currentVersionId: str(row.current_version_id),
    thumbnailPath: str(row.thumbnail_path),
    durationMs: Number(row.duration_ms ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastOpenedAt: str(row.last_opened_at),
    deletedAt: str(row.deleted_at),
  };
}

export function toSummary(p: ProjectRow): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    lastOpenedAt: p.lastOpenedAt,
    thumbnailPath: p.thumbnailPath,
    durationMs: p.durationMs,
    width: p.settings.width,
    height: p.settings.height,
    dataDir: p.dataDir,
    deletedAt: p.deletedAt,
  };
}

export class ProjectsRepo {
  constructor(private readonly db: SqlDriver) {}

  insert(p: Omit<ProjectRow, 'updatedAt' | 'createdAt' | 'lastOpenedAt' | 'deletedAt'> & { createdAt?: string }): ProjectRow {
    const now = p.createdAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO projects (id, name, kind, settings_json, data_dir, current_version_id, thumbnail_path, duration_ms, created_at, updated_at, last_opened_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(p.id, p.name, p.kind, JSON.stringify(p.settings), p.dataDir, p.currentVersionId, p.thumbnailPath, p.durationMs, now, now);
    return this.get(p.id)!;
  }

  get(id: string): ProjectRow | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row ? map(row) : undefined;
  }

  list(opts: { includeDeleted?: boolean; limit?: number } = {}): ProjectRow[] {
    const rows = opts.includeDeleted
      ? this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC LIMIT ?').all(opts.limit ?? 1000)
      : this.db.prepare('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?').all(opts.limit ?? 1000);
    return rows.map(map);
  }

  recent(limit = 8): ProjectRow[] {
    return this.db
      .prepare('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY COALESCE(last_opened_at, updated_at) DESC LIMIT ?')
      .all(limit)
      .map(map);
  }

  update(id: string, patch: Partial<Pick<ProjectRow, 'name' | 'settings' | 'currentVersionId' | 'thumbnailPath' | 'durationMs' | 'lastOpenedAt' | 'deletedAt' | 'kind'>>): ProjectRow | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: nowIso() };
    this.db
      .prepare(
        `UPDATE projects SET name = ?, kind = ?, settings_json = ?, current_version_id = ?, thumbnail_path = ?, duration_ms = ?, updated_at = ?, last_opened_at = ?, deleted_at = ? WHERE id = ?`,
      )
      .run(next.name, next.kind, JSON.stringify(next.settings), next.currentVersionId, next.thumbnailPath, next.durationMs, next.updatedAt, next.lastOpenedAt, next.deletedAt, id);
    return this.get(id);
  }

  touchOpened(id: string): void {
    this.db.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run(nowIso(), id);
  }

  deletePermanently(id: string): boolean {
    const r = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return Number(r.changes) > 0;
  }
}
