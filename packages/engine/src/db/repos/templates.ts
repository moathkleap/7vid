import type { Row, SqlDriver } from '../driver';
import { fromBool, nowIso, parseJson, str, toBool } from './common';

export interface TemplateRow {
  id: string;
  name: string;
  category: string;
  builtin: boolean;
  template: Record<string, unknown>;
  thumbnailPath: string | null;
  createdAt: string;
  updatedAt: string;
}

function map(row: Row): TemplateRow {
  return {
    id: String(row.id),
    name: String(row.name),
    category: String(row.category),
    builtin: toBool(row.builtin),
    template: parseJson<Record<string, unknown>>(row.template_json, {}),
    thumbnailPath: str(row.thumbnail_path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class TemplatesRepo {
  constructor(private readonly db: SqlDriver) {}

  upsert(t: Omit<TemplateRow, 'createdAt' | 'updatedAt'>): TemplateRow {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO templates (id, name, category, builtin, template_json, thumbnail_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, builtin = excluded.builtin, template_json = excluded.template_json, thumbnail_path = excluded.thumbnail_path, updated_at = excluded.updated_at`,
      )
      .run(t.id, t.name, t.category, fromBool(t.builtin), JSON.stringify(t.template), t.thumbnailPath, now, now);
    return this.get(t.id)!;
  }

  get(id: string): TemplateRow | undefined {
    const row = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    return row ? map(row) : undefined;
  }

  list(): TemplateRow[] {
    return this.db.prepare('SELECT * FROM templates ORDER BY builtin DESC, category, name').all().map(map);
  }

  delete(id: string): boolean {
    const r = this.db.prepare('DELETE FROM templates WHERE id = ? AND builtin = 0').run(id);
    return Number(r.changes) > 0;
  }
}
