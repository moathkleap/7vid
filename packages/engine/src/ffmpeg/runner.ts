import { spawn, type ChildProcess } from 'node:child_process';
import { AppError } from '../errors';
import type { Logger } from '../logging/logger';

export interface FfmpegProgress {
  /** Output timestamp reached, in ms. */
  outTimeMs: number;
  fps: number | null;
  speed: number | null;
  totalSizeBytes: number | null;
  frame: number | null;
  /** 0..1 when the expected duration is known. */
  ratio: number | null;
}

export interface RunFfmpegOptions {
  ffmpeg: string;
  args: string[];
  logger?: Logger;
  signal?: AbortSignal;
  /** Expected output duration used to compute progress ratio. */
  expectDurationMs?: number | null;
  onProgress?: (p: FfmpegProgress) => void;
  /** Receives a pause/resume pair backed by SIGSTOP/SIGCONT (POSIX only). */
  onProcess?: (proc: ChildProcess, controls: { pause: () => boolean; resume: () => boolean }) => void;
  timeoutMs?: number;
  cwd?: string;
  operation?: string;
}

export interface FfmpegResult {
  code: number;
  stderr: string;
  durationMs: number;
  lastProgress: FfmpegProgress | null;
}

/**
 * Spawns FFmpeg with machine-readable progress (`-progress pipe:1`), cancellation, optional pause/resume and
 * a bounded stderr tail for error reporting. Never resolves with success unless FFmpeg exits with code 0.
 */
export function runFfmpeg(opts: RunFfmpegOptions): Promise<FfmpegResult> {
  const t0 = Date.now();
  const args = ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error', '-progress', 'pipe:1', '-y', ...opts.args];
  opts.logger?.debug({ operation: opts.operation ?? 'ffmpeg', args: args.join(' ').slice(0, 2000) }, 'ffmpeg start');
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(opts.signal.reason ?? new AppError({ code: 'TASK_CANCELLED', operation: opts.operation ?? 'ffmpeg', message: 'cancelled' }));
      return;
    }
    let proc: ChildProcess;
    try {
      proc = spawn(opts.ffmpeg, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      reject(AppError.from(err, { code: 'FFMPEG_NOT_FOUND', operation: opts.operation ?? 'ffmpeg' }));
      return;
    }
    const stderrChunks: string[] = [];
    let stderrBytes = 0;
    let lastProgress: FfmpegProgress | null = null;
    let stdoutBuf = '';
    let paused = false;
    let settled = false;
    let aborted = false;
    let timer: NodeJS.Timeout | null = null;

    const controls = {
      pause: () => {
        if (process.platform === 'win32' || paused) return false;
        paused = proc.kill('SIGSTOP');
        return paused;
      },
      resume: () => {
        if (process.platform === 'win32' || !paused) return false;
        const ok = proc.kill('SIGCONT');
        if (ok) paused = false;
        return ok;
      },
    };
    opts.onProcess?.(proc, controls);

    const onAbort = () => {
      aborted = true;
      if (paused) proc.kill('SIGCONT');
      proc.kill('SIGKILL');
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        stderrChunks.push('\n[7vid] ffmpeg timed out');
        proc.kill('SIGKILL');
      }, opts.timeoutMs);
    }

    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      stdoutBuf += chunk;
      let idx: number;
      let block: Record<string, string> = {};
      while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq);
        const value = line.slice(eq + 1);
        block[key] = value;
        if (key === 'progress') {
          const outTimeUs = Number(block.out_time_us ?? block.out_time_ms ?? 0);
          const outTimeMs = Number.isFinite(outTimeUs) ? Math.max(0, Math.round(outTimeUs / 1000)) : 0;
          const fps = block.fps != null ? Number(block.fps) : null;
          const speed = block.speed != null ? Number(String(block.speed).replace('x', '')) : null;
          const size = block.total_size != null ? Number(block.total_size) : null;
          const frame = block.frame != null ? Number(block.frame) : null;
          const ratio = opts.expectDurationMs ? Math.min(1, outTimeMs / opts.expectDurationMs) : null;
          lastProgress = { outTimeMs, fps: Number.isFinite(fps as number) ? fps : null, speed: Number.isFinite(speed as number) ? speed : null, totalSizeBytes: Number.isFinite(size as number) ? size : null, frame: Number.isFinite(frame as number) ? frame : null, ratio };
          if (value !== 'end') opts.onProgress?.(lastProgress);
          block = {};
        }
      }
    });
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (chunk: string) => {
      stderrBytes += chunk.length;
      stderrChunks.push(chunk);
      while (stderrBytes > 64_000 && stderrChunks.length > 1) stderrBytes -= stderrChunks.shift()!.length;
    });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(AppError.from(err, { code: 'FFMPEG_NOT_FOUND', operation: opts.operation ?? 'ffmpeg', details: { ffmpeg: opts.ffmpeg } }));
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      const stderr = stderrChunks.join('').trim();
      const durationMs = Date.now() - t0;
      if (aborted || opts.signal?.aborted) {
        reject(opts.signal?.reason ?? new AppError({ code: 'TASK_CANCELLED', operation: opts.operation ?? 'ffmpeg', message: 'cancelled' }));
        return;
      }
      if (code === 0) {
        opts.logger?.debug({ operation: opts.operation ?? 'ffmpeg', durationMs, status: 'done' }, 'ffmpeg done');
        resolve({ code: 0, stderr, durationMs, lastProgress });
        return;
      }
      const tail = stderr.split('\n').filter(Boolean).slice(-6).join('\n');
      reject(new AppError({ code: 'FFMPEG_FAILED', operation: opts.operation ?? 'ffmpeg', message: `ffmpeg exited with code ${code}: ${tail || 'no error output'}`, details: { code, stderrTail: tail, args: args.slice(0, 60) } }));
    });
  });
}

/** Runs ffprobe and returns parsed JSON output. */
export function runFfprobe(ffprobe: string, args: string[], opts: { signal?: AbortSignal; timeoutMs?: number; operation?: string } = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let proc: ChildProcess;
    try {
      proc = spawn(ffprobe, ['-hide_banner', '-loglevel', 'error', '-print_format', 'json', ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      reject(AppError.from(err, { code: 'FFMPEG_NOT_FOUND', operation: opts.operation ?? 'ffprobe' }));
      return;
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), opts.timeoutMs ?? 30_000);
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (c: string) => (out += c));
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (c: string) => (err += c));
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(AppError.from(e, { code: 'FFMPEG_NOT_FOUND', operation: opts.operation ?? 'ffprobe' }));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new AppError({ code: 'MEDIA_ANALYSIS_FAILED', operation: opts.operation ?? 'ffprobe', message: `ffprobe exited with code ${code}: ${err.trim().split('\n').slice(-3).join(' ')}`, details: { code, stderr: err.slice(-2000) } }));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(AppError.from(e, { code: 'MEDIA_ANALYSIS_FAILED', operation: opts.operation ?? 'ffprobe', message: 'ffprobe output was not valid JSON' }));
      }
    });
  });
}
