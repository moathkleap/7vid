import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { AppError } from '../errors';
import type { ErrorCode } from '../errors/codes';
import type { Logger } from '../logging/logger';

export interface WorkerHello {
  version: string;
  python: string;
  executable: string;
  platform: string;
  device: string;
  devices: Record<string, unknown>;
  capabilities: Record<string, { available: boolean; reason: string | null; requires?: string[]; engines?: Record<string, { available: boolean; reason?: string; quality?: string }>; [k: string]: unknown }>;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  onProgress?: (ratio: number, message: string | null) => void;
  method: string;
}

const CODE_MAP: Record<string, ErrorCode> = {
  MODEL_NOT_INSTALLED: 'MODEL_NOT_INSTALLED',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  MEDIA_UNSUPPORTED: 'MEDIA_UNSUPPORTED',
  FFMPEG_FAILED: 'FFMPEG_FAILED',
  FFMPEG_NOT_FOUND: 'FFMPEG_NOT_FOUND',
  PROVIDER_FAILED: 'PROVIDER_FAILED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  INVALID_INPUT: 'INVALID_INPUT',
  CANCELLED: 'TASK_CANCELLED',
  METHOD_NOT_FOUND: 'NOT_IMPLEMENTED',
  WORKER_FAILED: 'WORKER_FAILED',
};

/** JSON-RPC client for the Python worker process with progress, cancellation and crash recovery. */
export class WorkerClient {
  private proc: ChildProcess | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private hello: WorkerHello | null = null;
  private starting: Promise<WorkerHello> | null = null;
  private crashes = 0;

  constructor(
    private readonly python: string,
    private readonly cwd: string,
    private readonly env: Record<string, string>,
    private readonly logger: Logger,
  ) {}

  get info(): WorkerHello | null {
    return this.hello;
  }

  get running(): boolean {
    return Boolean(this.proc && this.proc.exitCode === null);
  }

  async start(): Promise<WorkerHello> {
    if (this.running && this.hello) return this.hello;
    if (this.starting) return this.starting;
    this.starting = this.spawnAndHello().finally(() => (this.starting = null));
    return this.starting;
  }

  private spawnAndHello(): Promise<WorkerHello> {
    return new Promise((resolve, reject) => {
      let proc: ChildProcess;
      try {
        proc = spawn(this.python, ['-m', 'sevenvid_worker', '--stdio'], { cwd: this.cwd, env: { ...process.env, ...this.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      } catch (err) {
        reject(AppError.from(err, { code: 'WORKER_UNAVAILABLE', operation: 'worker.start' }));
        return;
      }
      this.proc = proc;
      let settled = false;
      const rl = readline.createInterface({ input: proc.stdout! });
      rl.on('line', (line) => this.onLine(line));
      proc.stderr?.setEncoding('utf8');
      proc.stderr?.on('data', (chunk: string) => {
        for (const l of chunk.split('\n')) if (l.trim()) this.logger.debug({ module: 'worker', stderr: l.slice(0, 500) }, 'worker stderr');
      });
      proc.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(AppError.from(err, { code: 'WORKER_UNAVAILABLE', operation: 'worker.start', details: { python: this.python } }));
        }
      });
      proc.on('exit', (code, signal) => {
        this.logger.warn({ module: 'worker', code, signal, pending: this.pending.size }, 'worker exited');
        const err = new AppError({ code: 'WORKER_CRASHED', operation: 'worker', message: `AI worker exited (code ${code}, signal ${signal})` });
        for (const [, p] of this.pending) p.reject(err);
        this.pending.clear();
        this.proc = null;
        this.hello = null;
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      const t0 = Date.now();
      const waitReady = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill('SIGKILL');
          reject(new AppError({ code: 'WORKER_UNAVAILABLE', operation: 'worker.start', message: 'AI worker did not respond within 60 s' }));
        }
      }, 60_000);
      this.request<WorkerHello>('hello', {})
        .then((h) => {
          clearTimeout(waitReady);
          this.hello = h;
          this.crashes = 0;
          this.logger.info({ module: 'worker', durationMs: Date.now() - t0, device: h.device, python: h.python }, 'worker ready');
          if (!settled) {
            settled = true;
            resolve(h);
          }
        })
        .catch((err) => {
          clearTimeout(waitReady);
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
    });
  }

  private onLine(line: string): void {
    let msg: { id?: number; result?: unknown; error?: { code: number; message: string; data?: { type?: string; [k: string]: unknown } }; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(line);
    } catch {
      this.logger.debug({ module: 'worker', line: line.slice(0, 200) }, 'worker non-json output');
      return;
    }
    if (msg.method === 'progress' && msg.params) {
      const p = this.pending.get(Number(msg.params.id));
      p?.onProgress?.(Number(msg.params.ratio), (msg.params.message as string | null) ?? null);
      return;
    }
    if (msg.method === 'log' && msg.params) {
      this.logger.info({ module: 'worker', ...msg.params }, String(msg.params.message ?? ''));
      return;
    }
    if (msg.method === 'ready') return;
    if (msg.id == null) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      const type = msg.error.data?.type ?? 'WORKER_FAILED';
      p.reject(new AppError({ code: CODE_MAP[type] ?? 'WORKER_FAILED', operation: `worker.${p.method}`, message: msg.error.message, details: { ...msg.error.data, method: p.method } }));
    } else p.resolve(msg.result);
  }

  /** Sends a request; supports progress callbacks and AbortSignal cancellation (cooperative in the worker). */
  async request<T>(method: string, params: Record<string, unknown>, opts: { signal?: AbortSignal; onProgress?: (ratio: number, message: string | null) => void; timeoutMs?: number } = {}): Promise<T> {
    if (method !== 'hello') await this.start();
    if (!this.proc?.stdin) throw new AppError({ code: 'WORKER_UNAVAILABLE', operation: `worker.${method}`, message: 'worker not running' });
    const id = ++this.seq;
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress: opts.onProgress, method });
    });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    let timer: NodeJS.Timeout | null = null;
    const onAbort = () => {
      this.proc?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'cancel', params: { id } }) + '\n');
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    if (opts.timeoutMs) timer = setTimeout(() => { this.pending.get(id)?.reject(new AppError({ code: 'WORKER_FAILED', operation: `worker.${method}`, message: `timed out after ${opts.timeoutMs} ms` })); this.pending.delete(id); onAbort(); }, opts.timeoutMs);
    try {
      return await p;
    } finally {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    try {
      proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'shutdown' }) + '\n');
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 3000);
      proc.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
    this.proc = null;
    this.hello = null;
  }

  /** Restarts after a crash with a small backoff; gives up after repeated failures within the session. */
  async restart(): Promise<WorkerHello> {
    this.crashes++;
    if (this.crashes > 3) throw new AppError({ code: 'WORKER_CRASHED', operation: 'worker.restart', message: 'AI worker crashed repeatedly; see diagnostics' });
    await this.stop();
    await new Promise((r) => setTimeout(r, 500 * this.crashes));
    return this.start();
  }
}
