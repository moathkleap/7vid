import type { SearchResult } from '@sevenvid/ipc';
import type { AppDatabase } from '../db/database';
import type { SearchEntityType } from '../db/repos/search';

export class SearchService {
  constructor(private readonly db: AppDatabase) {}

  indexProject(p: { id: string; name: string; kind: string; description?: string; tags?: string[] }): void {
    this.db.search.index({ type: 'project', id: p.id, projectId: p.id, title: p.name, body: [p.kind, p.description ?? '', ...(p.tags ?? [])].join(' ') });
  }

  indexAsset(a: { id: string; projectId: string | null; name: string; tags: string[]; kind: string; transcript?: string }): void {
    this.db.search.index({ type: 'asset', id: a.id, projectId: a.projectId, title: a.name, body: [a.kind, ...a.tags, a.transcript ?? ''].join(' ') });
  }

  index(entry: { type: SearchEntityType; id: string; projectId: string | null; title: string; body: string }): void {
    this.db.search.index(entry);
  }

  remove(type: SearchEntityType, id: string): void {
    this.db.search.remove(type, id);
  }

  query(q: string, opts: { types?: string[]; limit?: number } = {}): SearchResult[] {
    const hits = this.db.search.query(q, { types: opts.types as SearchEntityType[] | undefined, limit: opts.limit });
    return hits.map((h) => {
      let title = h.title;
      let subtitle = '';
      if (h.type === 'project') {
        const p = this.db.projects.get(h.id);
        if (p) {
          title = p.name;
          subtitle = `${p.kind} · ${p.updatedAt}`;
        }
      } else if (h.type === 'asset') {
        const a = this.db.assets.get(h.id);
        if (a) {
          title = a.name;
          subtitle = a.sourcePath;
        }
      }
      return { type: h.type, id: h.id, title, subtitle, projectId: h.projectId, score: h.score };
    });
  }
}
