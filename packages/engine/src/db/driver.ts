import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type SqlParam = SQLInputValue;
export type Row = Record<string, unknown>;

export interface SqlStatement {
  run(...params: SqlParam[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get<T extends Row = Row>(...params: SqlParam[]): T | undefined;
  all<T extends Row = Row>(...params: SqlParam[]): T[];
}

/** Minimal synchronous SQL driver interface so the storage backend can be swapped in one file. */
export interface SqlDriver {
  readonly path: string;
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  transaction<T>(fn: () => T): T;
  close(): void;
}

class NodeSqliteStatement implements SqlStatement {
  constructor(private readonly stmt: ReturnType<DatabaseSync['prepare']>) {}
  run(...params: SqlParam[]) {
    return this.stmt.run(...params);
  }
  get<T extends Row = Row>(...params: SqlParam[]): T | undefined {
    return this.stmt.get(...params) as T | undefined;
  }
  all<T extends Row = Row>(...params: SqlParam[]): T[] {
    return this.stmt.all(...params) as T[];
  }
}

export class NodeSqliteDriver implements SqlDriver {
  private readonly db: DatabaseSync;
  private readonly cache = new Map<string, NodeSqliteStatement>();
  private depth = 0;

  constructor(readonly path: string) {
    this.db = new DatabaseSync(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SqlStatement {
    let s = this.cache.get(sql);
    if (!s) {
      s = new NodeSqliteStatement(this.db.prepare(sql));
      if (this.cache.size < 500) this.cache.set(sql, s);
    }
    return s;
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      this.depth--;
    }
  }

  close(): void {
    this.cache.clear();
    this.db.close();
  }
}

export function openSqlite(path: string): SqlDriver {
  const driver = new NodeSqliteDriver(path);
  if (path !== ':memory:') {
    driver.exec('PRAGMA journal_mode = WAL');
    driver.exec('PRAGMA synchronous = NORMAL');
  }
  driver.exec('PRAGMA foreign_keys = ON');
  driver.exec('PRAGMA busy_timeout = 5000');
  driver.exec('PRAGMA temp_store = MEMORY');
  return driver;
}
