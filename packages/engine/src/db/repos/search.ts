import type { SearchResult } from '@sevenvid/ipc';
import type { SqlDriver } from '../driver';

export type SearchEntityType = SearchResult['type'];

/** Normalizes Arabic text for indexing/search: strips tashkeel and unifies alef/yaa/taa-marbuta forms. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[آأإ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
}

export class SearchRepo {
  constructor(private readonly db: SqlDriver) {}

  index(entry: { type: SearchEntityType; id: string; projectId: string | null; title: string; body: string }): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM global_fts WHERE entity_type = ? AND entity_id = ?').run(entry.type, entry.id);
      this.db
        .prepare('INSERT INTO global_fts (entity_type, entity_id, project_id, title, body) VALUES (?, ?, ?, ?, ?)')
        .run(entry.type, entry.id, entry.projectId, normalizeSearchText(entry.title), normalizeSearchText(entry.body));
    });
  }

  remove(type: SearchEntityType, id: string): void {
    this.db.prepare('DELETE FROM global_fts WHERE entity_type = ? AND entity_id = ?').run(type, id);
  }

  query(q: string, opts: { types?: SearchEntityType[]; limit?: number } = {}): Array<{ type: SearchEntityType; id: string; projectId: string | null; title: string; score: number }> {
    const terms = normalizeSearchText(q)
      .split(/\s+/)
      .map((t) => t.replace(/["'*()]/g, ''))
      .filter(Boolean);
    if (terms.length === 0) return [];
    const match = terms.map((t) => `"${t}"*`).join(' ');
    const typeFilter = opts.types && opts.types.length > 0 ? `AND entity_type IN (${opts.types.map(() => '?').join(',')})` : '';
    const rows = this.db
      .prepare(`SELECT entity_type, entity_id, project_id, title, bm25(global_fts) AS score FROM global_fts WHERE global_fts MATCH ? ${typeFilter} ORDER BY score LIMIT ?`)
      .all(match, ...(opts.types ?? []), opts.limit ?? 50);
    return rows.map((r) => ({
      type: r.entity_type as SearchEntityType,
      id: String(r.entity_id),
      projectId: r.project_id == null ? null : String(r.project_id),
      title: String(r.title),
      score: -Number(r.score),
    }));
  }
}
