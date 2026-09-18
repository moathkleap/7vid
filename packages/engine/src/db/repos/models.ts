import type { Row, SqlDriver } from '../driver';
import { nowIso, parseJson, str } from './common';

export interface ModelRow {
  id: string;
  status: 'available' | 'downloading' | 'installed' | 'broken' | 'removed';
  checksumOk: boolean | null;
  installedAt: string | null;
  lastTestedAt: string | null;
  lastTest: { ok: boolean; ms: number; message: string; at: string } | null;
}

function map(row: Row): ModelRow {
  return {
    id: String(row.registry_id),
    status: row.status as ModelRow['status'],
    checksumOk: row.checksum_ok == null ? null : row.checksum_ok === 1,
    installedAt: str(row.installed_at),
    lastTestedAt: str(row.last_tested_at),
    lastTest: parseJson<ModelRow['lastTest']>(row.last_test_json, null),
  };
}

export class ModelsRepo {
  constructor(private readonly db: SqlDriver) {}

  get(registryId: string): ModelRow | undefined {
    const row = this.db.prepare('SELECT * FROM models WHERE registry_id = ?').get(registryId);
    return row ? map(row) : undefined;
  }

  upsert(patch: { id: string; status?: ModelRow['status']; checksumOk?: boolean | null; installedAt?: string | null; lastTest?: ModelRow['lastTest']; lastTestedAt?: string | null }): ModelRow {
    const cur = this.get(patch.id);
    const next: ModelRow = { id: patch.id, status: patch.status ?? cur?.status ?? 'available', checksumOk: patch.checksumOk !== undefined ? patch.checksumOk : (cur?.checksumOk ?? null), installedAt: patch.installedAt !== undefined ? patch.installedAt : (cur?.installedAt ?? null), lastTestedAt: patch.lastTestedAt !== undefined ? patch.lastTestedAt : (cur?.lastTestedAt ?? null), lastTest: patch.lastTest !== undefined ? patch.lastTest : (cur?.lastTest ?? null) };
    this.db
      .prepare(
        `INSERT INTO models (id, registry_id, name, capability, provider_id, version, files_json, status, checksum_ok, installed_at, last_tested_at, last_test_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(registry_id) DO UPDATE SET status = excluded.status, checksum_ok = excluded.checksum_ok, installed_at = excluded.installed_at, last_tested_at = excluded.last_tested_at, last_test_json = excluded.last_test_json`,
      )
      .run(`mdl_${patch.id.replace(/\W+/g, '_')}`, patch.id, patch.id, '', '', '', '[]', next.status, next.checksumOk == null ? null : next.checksumOk ? 1 : 0, next.installedAt, next.lastTestedAt, next.lastTest ? JSON.stringify(next.lastTest) : null);
    return next;
  }
}

export { nowIso as _nowIso };
