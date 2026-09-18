import type { Row, SqlDriver } from '../driver';
import { nowIso, parseJson, str } from './common';

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  words?: Array<{ startMs: number; endMs: number; word: string; probability: number }>;
}

export interface TranscriptRow {
  id: string;
  assetId: string | null;
  projectId: string | null;
  language: string;
  providerId: string;
  modelId: string | null;
  segments: TranscriptSegment[];
  text: string;
  createdAt: string;
}

function map(row: Row): TranscriptRow {
  return {
    id: String(row.id),
    assetId: str(row.asset_id),
    projectId: str(row.project_id),
    language: String(row.language),
    providerId: String(row.provider_id),
    modelId: str(row.model_id),
    segments: parseJson<TranscriptSegment[]>(row.segments_json, []),
    text: String(row.text),
    createdAt: String(row.created_at),
  };
}

export class TranscriptsRepo {
  constructor(private readonly db: SqlDriver) {}

  insert(t: Omit<TranscriptRow, 'createdAt'>): TranscriptRow {
    const createdAt = nowIso();
    this.db
      .prepare('INSERT INTO transcripts (id, asset_id, project_id, language, provider_id, model_id, segments_json, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(t.id, t.assetId, t.projectId, t.language, t.providerId, t.modelId, JSON.stringify(t.segments), t.text, createdAt);
    return { ...t, createdAt };
  }

  listForProject(projectId: string): TranscriptRow[] {
    return this.db.prepare('SELECT * FROM transcripts WHERE project_id = ? ORDER BY created_at DESC').all(projectId).map(map);
  }

  get(id: string): TranscriptRow | undefined {
    const row = this.db.prepare('SELECT * FROM transcripts WHERE id = ?').get(id);
    return row ? map(row) : undefined;
  }
}
