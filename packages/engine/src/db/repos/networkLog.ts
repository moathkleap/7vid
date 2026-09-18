import type { SqlDriver } from '../driver';
import { nowIso } from './common';

export interface NetworkLogEntry {
  id: number;
  ts: string;
  providerId: string | null;
  host: string;
  purpose: string;
  bytesOut: number;
  bytesIn: number;
  status: string;
}

export class NetworkLogRepo {
  constructor(private readonly db: SqlDriver) {}

  add(e: Omit<NetworkLogEntry, 'id' | 'ts'>): void {
    this.db
      .prepare('INSERT INTO network_log (ts, provider_id, host, purpose, bytes_out, bytes_in, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(nowIso(), e.providerId, e.host, e.purpose, e.bytesOut, e.bytesIn, e.status);
  }

  recent(limit = 200): NetworkLogEntry[] {
    return this.db
      .prepare('SELECT * FROM network_log ORDER BY id DESC LIMIT ?')
      .all(limit)
      .map((r) => ({
        id: Number(r.id),
        ts: String(r.ts),
        providerId: r.provider_id == null ? null : String(r.provider_id),
        host: String(r.host),
        purpose: String(r.purpose),
        bytesOut: Number(r.bytes_out),
        bytesIn: Number(r.bytes_in),
        status: String(r.status),
      }));
  }
}
