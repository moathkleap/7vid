import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fpsToNumber, type Fraction } from '@sevenvid/core';
import { probeMedia } from '../media/probe';

export interface ExportCheck {
  name: 'file' | 'streams' | 'duration' | 'dimensions' | 'fps' | 'decode';
  ok: boolean;
  detail: string;
}

export interface ExportValidation {
  ok: boolean;
  checks: ExportCheck[];
  durationMs: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  videoCodec: string | null;
  audioCodec: string | null;
}

function decodeCheck(ffmpeg: string, file: string, signal?: AbortSignal): Promise<{ ok: boolean; errors: string }> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (c: string) => (err += c.length < 8000 ? c : c.slice(0, 8000)));
    const onAbort = () => proc.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    proc.on('error', (e) => resolve({ ok: false, errors: e.message }));
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      resolve({ ok: code === 0 && err.trim() === '', errors: err.trim() });
    });
  });
}

/** Verifies that an exported (or rendered) file is real, complete and decodable. */
export async function validateRenderedFile(
  ffmpeg: string,
  ffprobe: string,
  file: string,
  expect: { durationMs: number; width?: number | null; height?: number | null; fps?: Fraction | null; audio?: boolean },
  opts: { signal?: AbortSignal; decode?: boolean } = {},
): Promise<ExportValidation> {
  const checks: ExportCheck[] = [];
  const exists = fs.existsSync(file);
  const sizeBytes = exists ? fs.statSync(file).size : 0;
  checks.push({ name: 'file', ok: exists && sizeBytes > 0, detail: exists ? `${sizeBytes} bytes` : 'file missing' });
  if (!exists || sizeBytes === 0) return { ok: false, checks, durationMs: null, width: null, height: null, sizeBytes, videoCodec: null, audioCodec: null };
  let info;
  try {
    info = await probeMedia(ffprobe, file);
  } catch (err) {
    checks.push({ name: 'streams', ok: false, detail: err instanceof Error ? err.message : String(err) });
    return { ok: false, checks, durationMs: null, width: null, height: null, sizeBytes, videoCodec: null, audioCodec: null };
  }
  const hasVideo = Boolean(info.video);
  const hasAudio = Boolean(info.audio);
  checks.push({ name: 'streams', ok: hasVideo && (expect.audio === false || hasAudio), detail: `video=${info.video?.codec ?? 'none'} audio=${info.audio?.codec ?? 'none'}` });
  const tolerance = Math.max(200, expect.durationMs * 0.015);
  const durOk = info.durationMs != null && Math.abs(info.durationMs - expect.durationMs) <= tolerance;
  checks.push({ name: 'duration', ok: durOk, detail: `${info.durationMs ?? 'unknown'} ms (expected ${expect.durationMs} ± ${Math.round(tolerance)} ms)` });
  if (expect.width && expect.height) {
    const dimOk = info.video?.width === expect.width && info.video?.height === expect.height;
    checks.push({ name: 'dimensions', ok: dimOk, detail: `${info.video?.width}×${info.video?.height} (expected ${expect.width}×${expect.height})` });
  }
  if (expect.fps && info.video) {
    const fpsOk = Math.abs(fpsToNumber(info.video.fps) - fpsToNumber(expect.fps)) < 0.05;
    checks.push({ name: 'fps', ok: fpsOk, detail: `${fpsToNumber(info.video.fps).toFixed(3)} (expected ${fpsToNumber(expect.fps).toFixed(3)})` });
  }
  if (opts.decode !== false) {
    const d = await decodeCheck(ffmpeg, file, opts.signal);
    checks.push({ name: 'decode', ok: d.ok, detail: d.ok ? 'full decode without errors' : d.errors.split('\n').slice(0, 3).join(' | ') });
  }
  return { ok: checks.every((c) => c.ok), checks, durationMs: info.durationMs, width: info.video?.width ?? null, height: info.video?.height ?? null, sizeBytes, videoCodec: info.video?.codec ?? null, audioCodec: info.audio?.codec ?? null };
}
