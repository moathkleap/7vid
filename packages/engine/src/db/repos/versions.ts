import type { ProjectVersion } from '@sevenvid/ipc';
import type { Row, SqlDriver } from '../driver';
import { nowIso, str } from './common';

function map(row: Row): ProjectVersion {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    seq: Number(row.seq),
    label: str(row.label),
    reason: row.reason as ProjectVersion['reason'],
    hash: String(row.hash),
    sizeBytes: Number(row.size_bytes),
    createdAt: String(row.created_at),
  };
}

export class VersionsRepo {
  constructor(private readonly db: SqlDriver) {}

  insert(v: { id: string; projectId: string; label: string | null; reason: ProjectVersion['reason']; documentJson: string; hash: string }): ProjectVersion {
    const seqRow = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM project_versions WHERE project_id = ?').get<{ seq: number }>(v.projectId);
    const seq = Number(seqRow?.seq ?? 1);
    this.db
      .prepare('INSERT INTO project_versions (id, project_id, seq, label, reason, document_json, hash, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(v.id, v.projectId, seq, v.label, v.reason, v.documentJson, v.hash, Buffer.byteLength(v.documentJson), nowIso());
    return this.get(v.id)!;
  }

  get(id: string): ProjectVersion | undefined {
    const row = this.db.prepare('SELECT id, project_id, seq, label, reason, hash, size_bytes, created_at FROM project_versions WHERE id = ?').get(id);
    return row ? map(row) : undefined;
  }

  getDocumentJson(id: string): string | undefined {
    const row = this.db.prepare('SELECT document_json FROM project_versions WHERE id = ?').get<{ document_json: string }>(id);
    return row?.document_json;
  }

  latest(projectId: string): ProjectVersion | undefined {
    const row = this.db.prepare('SELECT id, project_id, seq, label, reason, hash, size_bytes, created_at FROM project_versions WHERE project_id = ? ORDER BY seq DESC LIMIT 1').get(projectId);
    return row ? map(row) : undefined;
  }

  list(projectId: string, limit = 200): ProjectVersion[] {
    return this.db
      .prepare('SELECT id, project_id, seq, label, reason, hash, size_bytes, created_at FROM project_versions WHERE project_id = ? ORDER BY seq DESC LIMIT ?')
      .all(projectId, limit)
      .map(map);
  }

  /** Keeps the newest `keepAutosaves` autosave versions (labeled/manual versions are never pruned). */
  prune(projectId: string, keepAutosaves = 100): number {
    const rows = this.db
      .prepare("SELECT id FROM project_versions WHERE project_id = ? AND reason = 'autosave' ORDER BY seq DESC")
      .all<{ id: string }>(projectId);
    const stale = rows.slice(keepAutosaves);
    if (stale.length === 0) return 0;
    const del = this.db.prepare('DELETE FROM project_versions WHERE id = ?');
    this.db.transaction(() => {
      for (const r of stale) del.run(r.id);
    });
    return stale.length;
  }
}
