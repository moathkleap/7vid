import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import type { AppDatabase } from '../db/database';
import { AppError } from '../errors';
import type { Logger } from '../logging/logger';
import type { SettingsService } from '../settings/SettingsService';

export interface FetchOptions {
  /** Why this request happens (shown in the network log), e.g. `model:silero/vad-v5`. */
  purpose: string;
  providerId: string | null;
  toFile: string;
  onProgress?: (bytes: number, total: number | null) => void;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * The only path to the network. Every request is checked against the privacy settings, logged with host,
 * purpose and byte counts, and never made unless the user enabled the relevant feature.
 */
export class NetworkGateway {
  constructor(
    private readonly db: AppDatabase,
    private readonly settings: SettingsService,
    private readonly logger: Logger,
  ) {}

  /** Returns null when allowed, or the blocking reason. */
  policyFor(purpose: string): string | null {
    const p = this.settings.get().privacy;
    if (purpose.startsWith('model:')) return p.allowModelDownloads ? null : 'model downloads are disabled in Privacy settings';
    if (purpose.startsWith('provider:')) return p.allowExternalProviders ? null : 'external providers are disabled in Privacy settings';
    return 'unknown purpose';
  }

  private log(entry: { providerId: string | null; host: string; purpose: string; bytesOut: number; bytesIn: number; status: string }): void {
    if (!this.settings.get().privacy.networkLogging) return;
    try {
      this.db.networkLog.add(entry);
    } catch (err) {
      this.logger.warn({ module: 'network', err }, 'network log write failed');
    }
  }

  /** Streams a URL to a file with resume support (HTTP Range) and redirect handling. */
  fetchToFile = async (url: string, opts: FetchOptions): Promise<{ bytes: number }> => {
    const blocked = this.policyFor(opts.purpose);
    const host = safeHost(url);
    if (blocked) {
      this.log({ providerId: opts.providerId, host, purpose: opts.purpose, bytesOut: 0, bytesIn: 0, status: 'blocked' });
      throw new AppError({ code: 'NETWORK_BLOCKED', operation: 'network.fetch', message: `Request to ${host} blocked: ${blocked}`, details: { url, purpose: opts.purpose } });
    }
    fs.mkdirSync(path.dirname(opts.toFile), { recursive: true });
    const existing = fs.existsSync(opts.toFile) ? fs.statSync(opts.toFile).size : 0;
    this.logger.info({ module: 'network', operation: 'fetch', host, purpose: opts.purpose, resumeFrom: existing }, 'network request');
    try {
      const result = await download(url, opts, existing, 0);
      this.log({ providerId: opts.providerId, host, purpose: opts.purpose, bytesOut: 0, bytesIn: result.bytes, status: 'ok' });
      return result;
    } catch (err) {
      const appErr = AppError.from(err, { code: 'NETWORK_FAILED', operation: 'network.fetch', details: { url, purpose: opts.purpose } });
      this.log({ providerId: opts.providerId, host, purpose: opts.purpose, bytesOut: 0, bytesIn: 0, status: appErr.info.code === 'TASK_CANCELLED' ? 'cancelled' : 'failed' });
      throw appErr;
    }
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}

function download(url: string, opts: FetchOptions, resumeFrom: number, redirects: number): Promise<{ bytes: number }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new AppError({ code: 'INVALID_INPUT', operation: 'network.fetch', message: `Invalid URL ${url}` }));
      return;
    }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'))) {
      reject(new AppError({ code: 'NETWORK_BLOCKED', operation: 'network.fetch', message: `Only HTTPS downloads are allowed (${parsed.protocol})` }));
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = { 'user-agent': 'sevenvid/0.1', ...(opts.headers ?? {}) };
    if (resumeFrom > 0) headers.range = `bytes=${resumeFrom}-`;
    const req = lib.request(parsed, { method: 'GET', headers, timeout: opts.timeoutMs ?? 60_000 }, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        if (redirects >= 5) return reject(new AppError({ code: 'NETWORK_FAILED', operation: 'network.fetch', message: 'too many redirects' }));
        return resolve(download(new URL(res.headers.location, parsed).toString(), opts, resumeFrom, redirects + 1));
      }
      if (status === 416) {
        res.resume();
        return resolve({ bytes: resumeFrom });
      }
      if (status !== 200 && status !== 206) {
        res.resume();
        return reject(new AppError({ code: 'NETWORK_FAILED', operation: 'network.fetch', message: `HTTP ${status} from ${parsed.host}`, details: { status, url } }));
      }
      const append = status === 206 && resumeFrom > 0;
      const total = res.headers['content-length'] ? Number(res.headers['content-length']) + (append ? resumeFrom : 0) : null;
      let bytes = append ? resumeFrom : 0;
      const out = fs.createWriteStream(opts.toFile, { flags: append ? 'a' : 'w' });
      const onAbort = () => {
        req.destroy(new AppError({ code: 'TASK_CANCELLED', operation: 'network.fetch', message: 'download cancelled' }));
        out.destroy();
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        opts.onProgress?.(bytes, total);
      });
      res.on('error', (err) => {
        out.destroy();
        reject(err);
      });
      out.on('error', reject);
      res.pipe(out);
      out.on('finish', () => {
        opts.signal?.removeEventListener('abort', onAbort);
        if (total != null && bytes !== total) return reject(new AppError({ code: 'NETWORK_FAILED', operation: 'network.fetch', message: `incomplete download (${bytes} of ${total} bytes)`, details: { url } }));
        resolve({ bytes });
      });
    });
    req.on('timeout', () => req.destroy(new AppError({ code: 'NETWORK_FAILED', operation: 'network.fetch', message: `timeout contacting ${parsed.host}` })));
    req.on('error', (err) => reject(err));
    req.end();
  });
}
