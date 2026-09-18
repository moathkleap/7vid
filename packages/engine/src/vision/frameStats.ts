import { execFile } from 'node:child_process';
import { AppError } from '../errors';

export interface FrameStats {
  /** Variance of the Laplacian (higher = sharper / more detail). */
  sharpness: number;
  mean: number;
  width: number;
  height: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function grayFrame(ffmpeg: string, file: string, tMs: number, box: Box | null, signal?: AbortSignal): Promise<{ data: Buffer; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const vf: string[] = [];
    if (box) vf.push(`crop=iw*${box.w.toFixed(5)}:ih*${box.h.toFixed(5)}:iw*${box.x.toFixed(5)}:ih*${box.y.toFixed(5)}`);
    vf.push('format=gray', 'showinfo');
    // showinfo reports the exact frame size on stderr (info level) while the raw gray frame goes to stdout
    const args = ['-hide_banner', '-loglevel', 'info', '-nostdin', '-ss', (tMs / 1000).toFixed(3), '-i', file, '-frames:v', '1', '-vf', vf.join(','), '-f', 'rawvideo', '-pix_fmt', 'gray', '-'];
    execFile(ffmpeg, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, signal }, (err, stdout, stderr) => {
      if (err) return reject(AppError.from(err, { code: 'FFMPEG_FAILED', operation: 'frameStats', details: { stderr: String(stderr).slice(-500) } }));
      const data = stdout as unknown as Buffer;
      if (!data.length) return reject(new AppError({ code: 'FFMPEG_FAILED', operation: 'frameStats', message: `no frame decoded at ${tMs} ms from ${file}` }));
      const m = /showinfo[^\n]*?\ss:(\d+)x(\d+)/.exec(String(stderr));
      if (!m) return reject(new AppError({ code: 'FFMPEG_FAILED', operation: 'frameStats', message: 'could not determine frame size', details: { stderr: String(stderr).slice(-500) } }));
      const width = Number(m[1]);
      const height = Number(m[2]);
      if (width * height !== data.length) return reject(new AppError({ code: 'FFMPEG_FAILED', operation: 'frameStats', message: `frame size mismatch (${width}x${height} vs ${data.length} bytes)` }));
      resolve({ data, width, height });
    });
  });
}

/** Laplacian variance of a gray image (Node implementation; no Python needed for verification). */
export function laplacianVariance(data: Buffer, width: number, height: number): { variance: number; mean: number } {
  if (width < 3 || height < 3) return { variance: 0, mean: data.length ? data.reduce((a, b) => a + b, 0) / data.length : 0 };
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  let pixSum = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = 4 * data[i]! - data[i - 1]! - data[i + 1]! - data[i - width]! - data[i + width]!;
      sum += v;
      sumSq += v * v;
      n++;
      pixSum += data[i]!;
    }
  }
  const meanL = sum / n;
  return { variance: sumSq / n - meanL * meanL, mean: pixSum / n };
}

/** Sharpness inside a normalized box of the frame at `tMs` (or the whole frame when box is null). */
export async function frameSharpness(ffmpeg: string, file: string, tMs: number, box: Box | null, signal?: AbortSignal): Promise<FrameStats> {
  const f = await grayFrame(ffmpeg, file, tMs, box, signal);
  const { variance, mean } = laplacianVariance(f.data, f.width, f.height);
  return { sharpness: variance, mean, width: f.width, height: f.height };
}

/**
 * Mean absolute error between a region and its block-average reconstruction (0 for a perfectly pixelated
 * region). The best of the nine ±1 px alignments is used so rounding in the render stage does not matter.
 */
export function blockMeanError(data: Buffer, width: number, height: number, region: { x: number; y: number; w: number; h: number }, block: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      let err = 0;
      let n = 0;
      for (let by = region.y + dy; by + block <= region.y + region.h; by += block) {
        for (let bx = region.x + dx; bx + block <= region.x + region.w; bx += block) {
          let sum = 0;
          for (let y = by; y < by + block; y++) for (let x = bx; x < bx + block; x++) sum += data[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!;
          const mean = sum / (block * block);
          for (let y = by; y < by + block; y++) for (let x = bx; x < bx + block; x++) err += Math.abs(data[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]! - mean);
          n += block * block;
        }
      }
      if (n > 0) best = Math.min(best, err / n);
    }
  }
  return Number.isFinite(best) ? best : 0;
}
