import type { SqlDriver } from '../driver';
import { nowIso, parseJson } from './common';

export class SettingsRepo {
  constructor(private readonly db: SqlDriver) {}

  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get<{ value_json: string }>(key);
    return row ? parseJson<T | undefined>(row.value_json, undefined) : undefined;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at')
      .run(key, JSON.stringify(value), nowIso());
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }
}
