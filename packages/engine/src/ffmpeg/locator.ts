import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AppPaths } from '../paths/AppPaths';

export interface FfmpegLocation {
  ffmpeg: string | null;
  ffprobe: string | null;
  version: string | null;
  source: 'env' | 'bundled' | 'path' | null;
  encoders: string[];
  hwEncoders: string[];
  filters: string[];
}

export const HW_ENCODER_NAMES = [
  'h264_nvenc', 'hevc_nvenc', 'av1_nvenc',
  'h264_qsv', 'hevc_qsv', 'av1_qsv',
  'h264_amf', 'hevc_amf', 'av1_amf',
  'h264_videotoolbox', 'hevc_videotoolbox',
  'h264_vaapi', 'hevc_vaapi', 'av1_vaapi',
];

function exe(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function findOnPath(name: string): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
    return out && fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

function readVersion(ffmpeg: string): string | null {
  try {
    const out = execFileSync(ffmpeg, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    const m = /ffmpeg version (\S+)/.exec(out);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

function listEncoders(ffmpeg: string): string[] {
  try {
    const out = execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    return out
      .split('\n')
      .map((l) => /^\s*[VAS][.A-Z]{5}\s+(\S+)/.exec(l)?.[1])
      .filter((x): x is string => Boolean(x));
  } catch {
    return [];
  }
}

function listFilters(ffmpeg: string): string[] {
  try {
    const out = execFileSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    return out
      .split('\n')
      .map((l) => /^\s*[T.][S.][C.]\s+(\S+)/.exec(l)?.[1])
      .filter((x): x is string => Boolean(x));
  } catch {
    return [];
  }
}

/** Finds FFmpeg/FFprobe: explicit env override → bundled resources → system PATH. */
export function locateFfmpeg(paths: AppPaths): FfmpegLocation {
  const candidates: Array<{ ffmpeg: string | null; ffprobe: string | null; source: FfmpegLocation['source'] }> = [];
  const envF = process.env.SEVENVID_FFMPEG_PATH;
  const envP = process.env.SEVENVID_FFPROBE_PATH;
  if (envF) candidates.push({ ffmpeg: envF, ffprobe: envP ?? path.join(path.dirname(envF), exe('ffprobe')), source: 'env' });
  const bundledDir = path.join(paths.resources, 'bin', `${process.platform}-${process.arch}`);
  candidates.push({ ffmpeg: path.join(bundledDir, exe('ffmpeg')), ffprobe: path.join(bundledDir, exe('ffprobe')), source: 'bundled' });
  candidates.push({ ffmpeg: findOnPath(exe('ffmpeg')), ffprobe: findOnPath(exe('ffprobe')), source: 'path' });
  for (const c of candidates) {
    if (c.ffmpeg && fs.existsSync(c.ffmpeg)) {
      const version = readVersion(c.ffmpeg);
      if (!version) continue;
      const encoders = listEncoders(c.ffmpeg);
      return {
        ffmpeg: c.ffmpeg,
        ffprobe: c.ffprobe && fs.existsSync(c.ffprobe) ? c.ffprobe : null,
        version,
        source: c.source,
        encoders,
        hwEncoders: HW_ENCODER_NAMES.filter((e) => encoders.includes(e)),
        filters: listFilters(c.ffmpeg),
      };
    }
  }
  return { ffmpeg: null, ffprobe: null, version: null, source: null, encoders: [], hwEncoders: [], filters: [] };
}

/** Runs a one-second synthetic encode to verify a hardware encoder really works on this machine. */
export function testEncoder(ffmpeg: string, encoder: string): { ok: boolean; error: string | null; ms: number } {
  const t0 = Date.now();
  const extra = encoder.endsWith('_vaapi') ? ['-vaapi_device', '/dev/dri/renderD128', '-vf', 'format=nv12,hwupload'] : [];
  const r = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '1', ...extra, '-c:v', encoder, '-f', 'null', '-'], { encoding: 'utf8', timeout: 20000 });
  const ms = Date.now() - t0;
  if (r.status === 0) return { ok: true, error: null, ms };
  return { ok: false, error: (r.stderr || r.error?.message || `exit ${r.status}`).trim().split('\n').slice(-1)[0] ?? 'failed', ms };
}
