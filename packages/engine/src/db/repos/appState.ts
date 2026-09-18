import type { SqlDriver } from '../driver';
import { nowIso } from './common';

export class AppStateRepo {
  constructor(private readonly db: SqlDriver) {}

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM app_state WHERE key = ?').get<{ value: string }>(key);
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(key, value, nowIso());
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM app_state WHERE key = ?').run(key);
  }
}
