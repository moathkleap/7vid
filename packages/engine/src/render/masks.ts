import fs from 'node:fs';
import path from 'node:path';
import type { MaskKeyframe, MaskTrack } from '@sevenvid/core';
import { escapeFilterPath } from './filterUtils';

export interface MaskStageInput {
  masks: MaskTrack[];
  /** Sequence (composite) size in pixels. */
  width: number;
  height: number;
  /** Timeline range being rendered; command times are made relative to `startMs`. */
  range: { startMs: number; endMs: number };
  /** Directory for the generated sendcmd file. */
  scratchDir: string;
  /** Filter graph label of the composited video (without brackets). */
  inputLabel: string;
  /** Unique prefix so several stages can coexist in one graph. */
  prefix?: string;
}

export interface MaskStageOutput {
  lines: string[];
  outputLabel: string;
  files: string[];
  applied: number;
}

const sec = (ms: number) => (ms / 1000).toFixed(3);
const even = (v: number) => Math.max(8, 2 * Math.round(v / 2));

export interface PlacedKeyframe {
  tMs: number;
  x: number;
  y: number;
}

/** Pixel window (position + fixed size) the render stage uses for a mask at `tMs`, mirroring the sendcmd interpolation. */
export function maskWindowAt(mask: MaskTrack, tMs: number, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  const placed = placeMask(mask, width, height, { startMs: tMs, endMs: tMs + 1 });
  if (!placed) return null;
  const kfs = placed.keyframes;
  let a = kfs[0]!;
  let b = kfs[kfs.length - 1]!;
  for (let k = 0; k + 1 < kfs.length; k++) {
    if (kfs[k]!.tMs <= tMs && tMs <= kfs[k + 1]!.tMs) {
      a = kfs[k]!;
      b = kfs[k + 1]!;
      break;
    }
  }
  const f = tMs <= a.tMs ? 0 : tMs >= b.tMs ? 1 : (tMs - a.tMs) / Math.max(1, b.tMs - a.tMs);
  return { x: Math.round(a.x + (b.x - a.x) * f), y: Math.round(a.y + (b.y - a.y) * f), w: placed.w, h: placed.h };
}

/** Block size in pixels used by pixelate masks at a given sequence height. */
export function pixelateBlockPx(strength: number, height: number): number {
  return Math.max(2, Math.round(strength * (height / 1080)));
}

/** Fixed crop window per mask (max keyframe size + margin) and the per-keyframe window origins. */
export function placeMask(mask: MaskTrack, width: number, height: number, range: { startMs: number; endMs: number }): { w: number; h: number; keyframes: PlacedKeyframe[] } | null {
  const inRange = mask.keyframes.filter((k) => k.tMs >= range.startMs - 2000 && k.tMs <= range.endMs + 2000);
  let kfs: MaskKeyframe[] = inRange.length ? inRange : mask.keyframes;
  if (kfs.length === 0) return null;
  kfs = [...kfs].sort((a, b) => a.tMs - b.tMs);
  if (kfs.length > 2400) {
    const step = Math.ceil(kfs.length / 2400);
    kfs = kfs.filter((_, i) => i % step === 0 || i === kfs.length - 1);
  }
  const margin = 1.1;
  let w = 0;
  let h = 0;
  for (const k of kfs) {
    w = Math.max(w, k.w * width * margin);
    h = Math.max(h, k.h * height * margin);
  }
  w = Math.min(width, even(w));
  h = Math.min(height, even(h));
  const keyframes = kfs.map((k) => {
    const cx = (k.x + k.w / 2) * width;
    const cy = (k.y + k.h / 2) * height;
    return { tMs: k.tMs, x: Math.round(Math.max(0, Math.min(width - w, cx - w / 2))), y: Math.round(Math.max(0, Math.min(height - h, cy - h / 2))) };
  });
  return { w, h, keyframes };
}

function effectFilters(mask: MaskTrack, w: number, h: number, height: number): string[] {
  const scale = height / 1080;
  const f: string[] = [];
  switch (mask.kind) {
    case 'pixelate': {
      const block = pixelateBlockPx(mask.strength, height);
      // exact block-aligned pixelation: downscale, upscale by the same integer factor, crop back to the window
      f.push(`scale=ceil(iw/${block}):ceil(ih/${block}):flags=area`, `scale=iw*${block}:ih*${block}:flags=neighbor`, `crop=${w}:${h}:0:0`);
      break;
    }
    case 'box': {
      const color = /^#?[0-9a-f]{6}$/i.test(mask.color) ? mask.color.replace('#', '0x') : 'black';
      f.push(`drawbox=x=0:y=0:w=iw:h=ih:color=${color}:t=fill`);
      break;
    }
    case 'blur':
    case 'custom':
    default: {
      const r = Math.max(2, Math.round(mask.strength * scale));
      f.push(`boxblur=lr='min(${r},floor((min(w,h)-1)/2))':lp=2:cr='min(${Math.max(1, Math.round(r / 2))},floor((min(cw,ch)-1)/2))':cp=2`);
      break;
    }
  }
  if (mask.shape === 'ellipse') {
    const feather = Math.max(0.02, Math.min(0.5, mask.feather > 0 ? Math.max(mask.feather * 10, 0.08) : 0.08));
    f.push('format=yuva420p', `geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='255*clip((1-sqrt(pow((X-W/2)/(W/2),2)+pow((Y-H/2)/(H/2),2)))/${feather.toFixed(3)},0,1)'`);
  }
  return f;
}

/**
 * Builds the filter-graph stage that applies every enabled mask on the composited video. Box positions are
 * animated with `sendcmd` (linear interpolation between keyframes); each mask uses a fixed-size crop window so
 * the overlay never has to reconfigure, and is enabled only inside its time range.
 */
export function compileMaskStage(input: MaskStageInput): MaskStageOutput {
  const { width, height, range } = input;
  const prefix = input.prefix ?? 'm';
  const durationMs = range.endMs - range.startMs;
  const active = input.masks.filter((m) => m.enabled && m.endMs > range.startMs && m.startMs < range.endMs && m.keyframes.length > 0);
  if (active.length === 0) return { lines: [], outputLabel: input.inputLabel, files: [], applied: 0 };
  const commands: string[] = [];
  const lines: string[] = [];
  const placed: Array<{ mask: MaskTrack; w: number; h: number; keyframes: PlacedKeyframe[]; name: string; startMs: number; endMs: number }> = [];
  active.forEach((mask, i) => {
    const p = placeMask(mask, width, height, range);
    if (!p) return;
    const name = `${prefix}${i + 1}`;
    const startMs = Math.max(0, mask.startMs - range.startMs);
    const endMs = Math.min(durationMs, mask.endMs - range.startMs);
    if (endMs <= startMs) return;
    placed.push({ mask, ...p, name, startMs, endMs });
    const kfs = p.keyframes;
    const limit = durationMs + 1000;
    const cmd = (tA: number, tB: number, a: PlacedKeyframe, b: PlacedKeyframe) => {
      // clamp the interval to the rendered range; interpolate the box at the clamped boundaries so motion stays exact
      const cA = Math.max(0, tA);
      const cB = Math.min(limit, tB);
      if (cB - cA < 1) return;
      const at = (t: number) => {
        const f = tB - tA <= 0 ? 0 : Math.max(0, Math.min(1, (t - tA) / (tB - tA)));
        return { x: Math.round(a.x + (b.x - a.x) * f), y: Math.round(a.y + (b.y - a.y) * f) };
      };
      const pa = at(cA);
      const pb = at(cB);
      const lerp = (u: number, v: number) => (u === v ? String(u) : `lerp(${u},${v},TI)`);
      commands.push(`${sec(cA)}-${sec(cB)} [enter+expr] crop@${name} x '${lerp(pa.x, pb.x)}', [enter+expr] crop@${name} y '${lerp(pa.y, pb.y)}', [enter+expr] overlay@${name} x '${lerp(pa.x, pb.x)}', [enter+expr] overlay@${name} y '${lerp(pa.y, pb.y)}';`);
    };
    const first = kfs[0]!;
    const last = kfs[kfs.length - 1]!;
    const firstT = first.tMs - range.startMs;
    const lastT = last.tMs - range.startMs;
    // hold the first box before the first keyframe and the last box after the last keyframe
    if (firstT > 0) cmd(Math.min(startMs, firstT) - 1000, firstT, first, first);
    for (let k = 0; k + 1 < kfs.length; k++) cmd(kfs[k]!.tMs - range.startMs, kfs[k + 1]!.tMs - range.startMs, kfs[k]!, kfs[k + 1]!);
    cmd(lastT, Math.max(lastT + 1, limit), last, last);
  });
  if (placed.length === 0) return { lines: [], outputLabel: input.inputLabel, files: [], applied: 0 };
  fs.mkdirSync(input.scratchDir, { recursive: true });
  const cmdFile = path.join(input.scratchDir, `masks-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.cmd`);
  fs.writeFileSync(cmdFile, commands.join('\n') + '\n', 'utf8');
  const splitOuts = [`[${prefix}b0]`, ...placed.map((p) => `[${prefix}s_${p.name}]`)].join('');
  lines.push(`[${input.inputLabel}]sendcmd=f='${escapeFilterPath(cmdFile)}',split=${placed.length + 1}${splitOuts}`);
  let base = `${prefix}b0`;
  placed.forEach((p, i) => {
    const k0 = p.keyframes[0]!;
    const chain = [`crop@${p.name}=w=${p.w}:h=${p.h}:x=${k0.x}:y=${k0.y}:exact=1`, ...effectFilters(p.mask, p.w, p.h, height)];
    lines.push(`[${prefix}s_${p.name}]${chain.join(',')}[${prefix}f_${p.name}]`);
    const next = `${prefix}b${i + 1}`;
    lines.push(`[${base}][${prefix}f_${p.name}]overlay@${p.name}=x=${k0.x}:y=${k0.y}:eval=frame:eof_action=pass:enable='between(t,${sec(p.startMs)},${sec(p.endMs)})'[${next}]`);
    base = next;
  });
  return { lines, outputLabel: base, files: [cmdFile], applied: placed.length };
}
