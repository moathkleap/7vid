import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from '../db/database';
import { AppError } from '../errors';
import type { EventBus } from '../events/EventBus';
import type { Logger } from '../logging/logger';
import type { AppPaths } from '../paths/AppPaths';
import type { TaskManager } from '../tasks/TaskManager';
import { MODEL_REGISTRY, modelSpec, type ModelSpec } from './registry';

export interface ModelStatus {
  spec: ModelSpec;
  status: 'installed' | 'available' | 'downloading' | 'broken' | 'partial';
  installPath: string;
  files: Array<{ path: string; present: boolean; sizeBytes: number | null; expectedBytes: number | null }>;
  checksumOk: boolean | null;
  lastTest: { ok: boolean; ms: number; message: string; at: string } | null;
  installedBytes: number;
}

export type NetworkFetch = (url: string, opts: { purpose: string; providerId: string | null; onProgress?: (bytes: number, total: number | null) => void; signal?: AbortSignal; toFile: string }) => Promise<{ bytes: number }>;

/**
 * Tracks which models are present on disk, resolves their paths for providers, and (via a task)
 * downloads them with checksum verification. Download itself goes through the network gateway.
 */
export class ModelManager {
  private fetcher: NetworkFetch | null = null;
  private tester: ((spec: ModelSpec, dir: string) => Promise<{ ok: boolean; message: string }>) | null = null;

  constructor(
    private readonly db: AppDatabase,
    private readonly paths: AppPaths,
    private readonly tasks: TaskManager,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {
    tasks.registerKind<{ modelId: string }, ModelStatus>({
      kind: 'models.download',
      lane: 'io',
      title: (p) => `Download ${modelSpec(p.modelId)?.name ?? p.modelId}`,
      run: (ctx) => this.download(ctx.params.modelId, (r, m) => ctx.progress(r, m), ctx.signal),
    });
  }

  setFetcher(f: NetworkFetch): void {
    this.fetcher = f;
  }

  setTester(t: (spec: ModelSpec, dir: string) => Promise<{ ok: boolean; message: string }>): void {
    this.tester = t;
  }

  dirFor(id: string): string {
    return path.join(this.paths.models, ...id.split('/'));
  }

  /** Absolute path of a model file, or null when the model is not installed. */
  pathFor(id: string, file?: string): string | null {
    const spec = modelSpec(id);
    if (!spec) return null;
    const dir = this.dirFor(id);
    const target = file ?? spec.files[0]!.path;
    const p = path.join(dir, target);
    return fs.existsSync(p) && fs.statSync(p).size > 0 ? p : null;
  }

  isInstalled(id: string): boolean {
    const spec = modelSpec(id);
    if (!spec) return false;
    return spec.files.every((f) => this.pathFor(id, f.path) !== null);
  }

  status(id: string): ModelStatus {
    const spec = modelSpec(id);
    if (!spec) throw new AppError({ code: 'INVALID_INPUT', operation: 'models.status', message: `Unknown model ${id}` });
    const dir = this.dirFor(id);
    const files = spec.files.map((f) => {
      const p = path.join(dir, f.path);
      const present = fs.existsSync(p) && fs.statSync(p).size > 0;
      return { path: f.path, present, sizeBytes: present ? fs.statSync(p).size : null, expectedBytes: f.sizeBytes };
    });
    const row = this.db.models.get(id);
    const downloading = this.tasks.list().some((t) => t.kind === 'models.download' && t.params.modelId === id);
    const installedBytes = files.reduce((n, f) => n + (f.sizeBytes ?? 0), 0);
    let status: ModelStatus['status'] = files.every((f) => f.present) ? 'installed' : files.some((f) => f.present) ? 'partial' : 'available';
    if (downloading) status = 'downloading';
    if (row?.status === 'broken') status = 'broken';
    return { spec, status, installPath: dir, files, checksumOk: row?.checksumOk ?? null, lastTest: row?.lastTest ?? null, installedBytes };
  }

  list(): ModelStatus[] {
    return MODEL_REGISTRY.map((m) => this.status(m.id));
  }

  startDownload(id: string) {
    if (!modelSpec(id)) throw new AppError({ code: 'INVALID_INPUT', operation: 'models.download', message: `Unknown model ${id}` });
    if (!this.fetcher) throw new AppError({ code: 'NETWORK_BLOCKED', operation: 'models.download', message: 'Model downloads are not enabled' });
    return this.tasks.enqueue({ kind: 'models.download', params: { modelId: id }, priority: 2 });
  }

  remove(id: string): boolean {
    const dir = this.dirFor(id);
    if (!dir.startsWith(this.paths.models)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    this.db.models.upsert({ id, status: 'removed', checksumOk: null, installedAt: null });
    this.bus.emit('models.changed', { modelId: id });
    return true;
  }

  private async download(id: string, progress: (ratio: number, message?: string) => void, signal?: AbortSignal): Promise<ModelStatus> {
    const spec = modelSpec(id)!;
    if (!this.fetcher) throw new AppError({ code: 'NETWORK_BLOCKED', operation: 'models.download', message: 'Model downloads are not enabled' });
    const dir = this.dirFor(id);
    fs.mkdirSync(dir, { recursive: true });
    const total = spec.files.reduce((n, f) => n + (f.sizeBytes ?? 0), 0) || null;
    let done = 0;
    let allOk = true;
    for (const f of spec.files) {
      if (f.url.startsWith('https://huggingface.co/') && !/\/resolve\//.test(f.url)) {
        throw new AppError({ code: 'NOT_IMPLEMENTED', operation: 'models.download', message: `${spec.name} is a multi-file repository; install it with the Hugging Face CLI into ${dir} (see docs/AI_MODELS.md)`, details: { url: f.url, dir } });
      }
      const target = path.join(dir, f.path);
      if (fs.existsSync(target) && f.sizeBytes && fs.statSync(target).size === f.sizeBytes) {
        done += f.sizeBytes;
        continue;
      }
      const tmp = `${target}.part`;
      progress(total ? done / total : 0, f.path);
      await this.fetcher(f.url, { purpose: `model:${id}`, providerId: 'model-download', toFile: tmp, signal, onProgress: (bytes) => progress(total ? Math.min(0.99, (done + bytes) / total) : 0, f.path) });
      if (f.sha256) {
        const hash = await sha256File(tmp);
        if (hash !== f.sha256) {
          fs.rmSync(tmp, { force: true });
          this.db.models.upsert({ id, status: 'broken', checksumOk: false, installedAt: null });
          throw new AppError({ code: 'MODEL_CHECKSUM_MISMATCH', operation: 'models.download', message: `Checksum mismatch for ${f.path}`, details: { expected: f.sha256, actual: hash } });
        }
      } else allOk = allOk && true;
      fs.renameSync(tmp, target);
      done += fs.statSync(target).size;
    }
    this.db.models.upsert({ id, status: 'installed', checksumOk: spec.files.every((f) => f.sha256) ? true : null, installedAt: new Date().toISOString() });
    this.bus.emit('models.changed', { modelId: id });
    this.logger.info({ operation: 'models.download', modelId: id, bytes: done }, 'model installed');
    progress(1, null as never);
    return this.status(id);
  }

  /** Runs the provider's real smoke test for the model and records the result. */
  async test(id: string): Promise<{ ok: boolean; ms: number; message: string }> {
    const spec = modelSpec(id);
    if (!spec) throw new AppError({ code: 'INVALID_INPUT', operation: 'models.test', message: `Unknown model ${id}` });
    if (!this.isInstalled(id)) throw new AppError({ code: 'MODEL_NOT_INSTALLED', operation: 'models.test', message: `${spec.name} is not installed`, details: { modelId: id } });
    if (!this.tester) throw new AppError({ code: 'NOT_IMPLEMENTED', operation: 'models.test', message: 'No tester registered' });
    const t0 = Date.now();
    let result: { ok: boolean; message: string };
    try {
      result = await this.tester(spec, this.dirFor(id));
    } catch (err) {
      result = { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    const ms = Date.now() - t0;
    const record = { ...result, ms, at: new Date().toISOString() };
    this.db.models.upsert({ id, lastTest: record, lastTestedAt: record.at });
    this.bus.emit('models.changed', { modelId: id });
    return record;
  }
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}
