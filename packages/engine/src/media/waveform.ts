import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors';
import type { MediaInfo } from './probe';

export interface WaveformData {
  version: 1;
  samplesPerSecond: number;
  durationMs: number;
  /** Normalized peak amplitude (0..1) per bucket. */
  peaks: number[];
}

/** Decodes audio to 8 kHz mono PCM and computes peak amplitude per time bucket. */
export function generateWaveform(ffmpeg: string, info: MediaInfo, outJson: string, opts: { samplesPerSecond?: number; signal?: AbortSignal } = {}): Promise<WaveformData | null> {
  if (!info.audio || !info.durationMs) return Promise.resolve(null);
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  const rate = 8000;
  const sps = opts.samplesPerSecond ?? 40;
  const bucket = Math.max(1, Math.round(rate / sps));
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', info.path, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const peaks: number[] = [];
    let carry: Buffer = Buffer.alloc(0);
    let max = 0;
    let n = 0;
    let stderr = '';
    const onAbort = () => proc.kill('SIGKILL');
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    proc.stdout.on('data', (chunk: Buffer) => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const v = Math.abs(buf.readInt16LE(i));
        if (v > max) max = v;
        if (++n === bucket) {
          peaks.push(max / 32768);
          max = 0;
          n = 0;
        }
      }
      carry = buf.subarray(usable);
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (c: string) => (stderr += c));
    proc.on('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(AppError.from(err, { code: 'FFMPEG_NOT_FOUND', operation: 'media.waveform' }));
    });
    proc.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) {
        reject(opts.signal.reason ?? new AppError({ code: 'TASK_CANCELLED', operation: 'media.waveform', message: 'cancelled' }));
        return;
      }
      if (code !== 0) {
        reject(new AppError({ code: 'FFMPEG_FAILED', operation: 'media.waveform', message: `waveform decode failed (${code}): ${stderr.trim().split('\n').slice(-2).join(' ')}` }));
        return;
      }
      if (n > 0) peaks.push(max / 32768);
      const data: WaveformData = { version: 1, samplesPerSecond: sps, durationMs: info.durationMs!, peaks: peaks.map((p) => Math.round(p * 1000) / 1000) };
      fs.writeFileSync(outJson, JSON.stringify(data));
      resolve(data);
    });
  });
}
