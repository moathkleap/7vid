import type { AppErrorInfo } from '@sevenvid/core';
import type { TaskInfo, TaskStatus } from '@sevenvid/ipc';
import type { Row, SqlDriver } from '../driver';
import { fromBool, nowIso, num, parseJson, str, toBool } from './common';

function map(row: Row): TaskInfo {
  return {
    id: String(row.id),
    kind: String(row.kind),
    title: String(row.title),
    projectId: str(row.project_id),
    parentTaskId: str(row.parent_task_id),
    status: row.status as TaskStatus,
    priority: Number(row.priority),
    progress: Number(row.progress),
    progressMessage: str(row.progress_message),
    etaMs: num(row.eta_ms),
    params: parseJson<Record<string, unknown>>(row.params_json, {}),
    result: parseJson<unknown>(row.result_json, null),
    error: parseJson<AppErrorInfo | null>(row.error_json, null),
    attempts: Number(row.attempts),
    cancellable: toBool(row.cancellable),
    pausable: toBool(row.pausable),
    createdAt: String(row.created_at),
    startedAt: str(row.started_at),
    finishedAt: str(row.finished_at),
  };
}

export class TasksRepo {
  constructor(private readonly db: SqlDriver) {}

  upsert(t: TaskInfo): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, kind, title, project_id, parent_task_id, status, priority, progress, progress_message, eta_ms, params_json, result_json, error_json, attempts, cancellable, pausable, created_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, priority = excluded.priority, progress = excluded.progress, progress_message = excluded.progress_message, eta_ms = excluded.eta_ms,
           result_json = excluded.result_json, error_json = excluded.error_json, attempts = excluded.attempts, cancellable = excluded.cancellable, pausable = excluded.pausable, started_at = excluded.started_at, finished_at = excluded.finished_at, title = excluded.title`,
      )
      .run(
        t.id, t.kind, t.title, t.projectId, t.parentTaskId, t.status, t.priority, t.progress, t.progressMessage, t.etaMs,
        JSON.stringify(t.params), t.result == null ? null : JSON.stringify(t.result), t.error ? JSON.stringify(t.error) : null,
        t.attempts, fromBool(t.cancellable), fromBool(t.pausable), t.createdAt, t.startedAt, t.finishedAt,
      );
  }

  get(id: string): TaskInfo | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return row ? map(row) : undefined;
  }

  list(opts: { projectId?: string | null; includeFinished?: boolean; limit?: number } = {}): TaskInfo[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.projectId) {
      where.push('project_id = ?');
      params.push(opts.projectId);
    }
    if (!opts.includeFinished) where.push("status IN ('queued','running','paused')");
    const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
    params.push(opts.limit ?? 200);
    return this.db.prepare(sql).all(...params).map(map);
  }

  /** Marks tasks left running/queued by a previous process as interrupted. Returns the affected ids. */
  markInterrupted(): string[] {
    const rows = this.db.prepare("SELECT id FROM tasks WHERE status IN ('queued','running','paused')").all<{ id: string }>();
    if (rows.length === 0) return [];
    const err: AppErrorInfo = {
      errorId: 'err_interrupted',
      code: 'TASK_INTERRUPTED',
      module: 'tasks',
      operation: 'startup',
      message: 'The application was closed while this task was running',
      userMessageKey: 'errors.taskInterrupted',
      userMessageParams: {},
      retryable: true,
      recovery: [{ kind: 'retry', labelKey: 'errors.recovery.retry', target: null }],
      logRef: null,
      cause: null,
      details: {},
      at: nowIso(),
    };
    this.db.prepare("UPDATE tasks SET status = 'interrupted', finished_at = ?, error_json = ? WHERE status IN ('queued','running','paused')").run(nowIso(), JSON.stringify(err));
    return rows.map((r) => r.id);
  }

  clearFinished(): number {
    const r = this.db.prepare("DELETE FROM tasks WHERE status IN ('done','failed','cancelled','interrupted')").run();
    return Number(r.changes);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }
}
