import type { AppErrorInfo } from '@sevenvid/core';
import type { Row, SqlDriver } from '../driver';
import { nowIso, num, parseJson, str } from './common';

export type ExportStatus = 'queued' | 'running' | 'validating' | 'done' | 'failed' | 'cancelled';

export interface ExportRow {
  id: string;
  projectId: string | null;
  taskId: string | null;
  presetId: string;
  settings: Record<string, unknown>;
  outputPath: string;
  status: ExportStatus;
  validation: Record<string, unknown> | null;
  sizeBytes: number | null;
  durationMs: number | null;
  error: AppErrorInfo | null;
  createdAt: string;
  finishedAt: string | null;
}

function map(row: Row): ExportRow {
  return {
    id: String(row.id),
    projectId: str(row.project_id),
    taskId: str(row.task_id),
    presetId: String(row.preset_id),
    settings: parseJson<Record<string, unknown>>(row.settings_json, {}),
    outputPath: String(row.output_path),
    status: row.status as ExportStatus,
    validation: parseJson<Record<string, unknown> | null>(row.validation_json, null),
    sizeBytes: num(row.size_bytes),
    durationMs: num(row.duration_ms),
    error: parseJson<AppErrorInfo | null>(row.error_json, null),
    createdAt: String(row.created_at),
    finishedAt: str(row.finished_at),
  };
}

export class ExportsRepo {
  constructor(private readonly db: SqlDriver) {}

  insert(e: Pick<ExportRow, 'id' | 'projectId' | 'taskId' | 'presetId' | 'settings' | 'outputPath' | 'status'>): ExportRow {
    this.db
      .prepare('INSERT INTO exports (id, project_id, task_id, preset_id, settings_json, output_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(e.id, e.projectId, e.taskId, e.presetId, JSON.stringify(e.settings), e.outputPath, e.status, nowIso());
    return this.get(e.id)!;
  }

  update(id: string, patch: Partial<Pick<ExportRow, 'status' | 'validation' | 'sizeBytes' | 'durationMs' | 'error' | 'finishedAt' | 'taskId' | 'outputPath'>>): ExportRow | undefined {
    const cur = this.get(id);
    if (!cur) return undefined;
    const n = { ...cur, ...patch };
    this.db
      .prepare('UPDATE exports SET status = ?, validation_json = ?, size_bytes = ?, duration_ms = ?, error_json = ?, finished_at = ?, task_id = ?, output_path = ? WHERE id = ?')
      .run(n.status, n.validation ? JSON.stringify(n.validation) : null, n.sizeBytes, n.durationMs, n.error ? JSON.stringify(n.error) : null, n.finishedAt, n.taskId, n.outputPath, id);
    return this.get(id);
  }

  get(id: string): ExportRow | undefined {
    const row = this.db.prepare('SELECT * FROM exports WHERE id = ?').get(id);
    return row ? map(row) : undefined;
  }

  list(opts: { projectId?: string; limit?: number } = {}): ExportRow[] {
    const rows = opts.projectId
      ? this.db.prepare('SELECT * FROM exports WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(opts.projectId, opts.limit ?? 100)
      : this.db.prepare('SELECT * FROM exports ORDER BY created_at DESC LIMIT ?').all(opts.limit ?? 100);
    return rows.map(map);
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM exports WHERE id = ?').run(id).changes) > 0;
  }
}
