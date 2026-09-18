import type { Clip, MaskKeyframe, MaskTrack } from './types';

/** Normalized rectangle (0..1) with origin at the top-left. */
export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

interface Frame {
  w: number;
  h: number;
}

function rotatedDims(w: number, h: number, rotDeg: number): Frame {
  const rot = ((Math.round(rotDeg) % 360) + 360) % 360;
  if (rot === 90 || rot === 270) return { w: h, h: w };
  if (rot === 0 || rot === 180) return { w, h };
  const a = (rot * Math.PI) / 180;
  return { w: Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), h: Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)) };
}

function rotatePoint(p: Point, from: Frame, rotDeg: number, inverse: boolean): Point {
  const rot = ((Math.round(rotDeg) % 360) + 360) % 360;
  if (rot === 0) return p;
  const to = rotatedDims(from.w, from.h, rot);
  if (!inverse) {
    if (rot === 90) return { x: from.h - p.y, y: p.x };
    if (rot === 180) return { x: from.w - p.x, y: from.h - p.y };
    if (rot === 270) return { x: p.y, y: from.w - p.x };
    const a = (rot * Math.PI) / 180;
    const cx = p.x - from.w / 2;
    const cy = p.y - from.h / 2;
    return { x: cx * Math.cos(a) - cy * Math.sin(a) + to.w / 2, y: cx * Math.sin(a) + cy * Math.cos(a) + to.h / 2 };
  }
  // inverse: p is in the rotated frame `to`; return the source-frame point
  if (rot === 90) return { x: p.y, y: from.h - p.x };
  if (rot === 180) return { x: from.w - p.x, y: from.h - p.y };
  if (rot === 270) return { x: from.w - p.y, y: p.x };
  const a = (-rot * Math.PI) / 180;
  const cx = p.x - to.w / 2;
  const cy = p.y - to.h / 2;
  return { x: cx * Math.cos(a) - cy * Math.sin(a) + from.w / 2, y: cx * Math.sin(a) + cy * Math.cos(a) + from.h / 2 };
}

/** Placement of the (cropped, rotated, flipped) clip frame inside the sequence, in sequence pixels. */
export function clipPlacement(clip: Clip, sourceW: number, sourceH: number, seqW: number, seqH: number): { cropped: Frame; rotated: Frame; scale: number; originX: number; originY: number } {
  const t = clip.transform;
  const cropped = { w: Math.max(1, sourceW * (1 - t.cropLeft - t.cropRight)), h: Math.max(1, sourceH * (1 - t.cropTop - t.cropBottom)) };
  const rotated = rotatedDims(cropped.w, cropped.h, t.rotate);
  const blurFill = t.fit === 'blur-fill';
  const s = blurFill ? 1 : Math.max(0.01, t.scale);
  const boxW = seqW * s;
  const boxH = seqH * s;
  let scale: number;
  let drawnW: number;
  let drawnH: number;
  if (t.fit === 'stretch') {
    // non-uniform: approximate with independent factors via width; height handled below
    scale = boxW / rotated.w;
    drawnW = boxW;
    drawnH = boxH;
  } else if (t.fit === 'cover') {
    scale = Math.max(boxW / rotated.w, boxH / rotated.h);
    drawnW = rotated.w * scale;
    drawnH = rotated.h * scale;
  } else {
    scale = Math.min(boxW / rotated.w, boxH / rotated.h);
    drawnW = rotated.w * scale;
    drawnH = rotated.h * scale;
  }
  const offX = blurFill ? 0 : t.offsetX * seqW;
  const offY = blurFill ? 0 : t.offsetY * seqH;
  return { cropped, rotated, scale, originX: (seqW - drawnW) / 2 + offX, originY: (seqH - drawnH) / 2 + offY };
}

function mapSourcePointToSequence(clip: Clip, sourceW: number, sourceH: number, seqW: number, seqH: number, p: Point): Point {
  const t = clip.transform;
  const pl = clipPlacement(clip, sourceW, sourceH, seqW, seqH);
  let x = p.x - t.cropLeft * sourceW;
  let y = p.y - t.cropTop * sourceH;
  ({ x, y } = rotatePoint({ x, y }, pl.cropped, t.rotate, false));
  if (t.flipH) x = pl.rotated.w - x;
  if (t.flipV) y = pl.rotated.h - y;
  if (t.fit === 'stretch') {
    const boxW = seqW * Math.max(0.01, t.scale);
    const boxH = seqH * Math.max(0.01, t.scale);
    return { x: pl.originX + (x / pl.rotated.w) * boxW, y: pl.originY + (y / pl.rotated.h) * boxH };
  }
  return { x: pl.originX + x * pl.scale, y: pl.originY + y * pl.scale };
}

function mapSequencePointToSource(clip: Clip, sourceW: number, sourceH: number, seqW: number, seqH: number, p: Point): Point {
  const t = clip.transform;
  const pl = clipPlacement(clip, sourceW, sourceH, seqW, seqH);
  let x: number;
  let y: number;
  if (t.fit === 'stretch') {
    const boxW = seqW * Math.max(0.01, t.scale);
    const boxH = seqH * Math.max(0.01, t.scale);
    x = ((p.x - pl.originX) / boxW) * pl.rotated.w;
    y = ((p.y - pl.originY) / boxH) * pl.rotated.h;
  } else {
    x = (p.x - pl.originX) / pl.scale;
    y = (p.y - pl.originY) / pl.scale;
  }
  if (t.flipH) x = pl.rotated.w - x;
  if (t.flipV) y = pl.rotated.h - y;
  ({ x, y } = rotatePoint({ x, y }, pl.cropped, t.rotate, true));
  return { x: x + t.cropLeft * sourceW, y: y + t.cropTop * sourceH };
}

function boxFromPoints(points: Point[], w: number, h: number): NormBox {
  const xs = points.map((p) => p.x / w);
  const ys = points.map((p) => p.y / h);
  const x0 = Math.max(0, Math.min(...xs));
  const y0 = Math.max(0, Math.min(...ys));
  const x1 = Math.min(1, Math.max(...xs));
  const y1 = Math.min(1, Math.max(...ys));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/**
 * Maps a box given in normalized source-frame coordinates (as detectors report it) to normalized
 * sequence-frame coordinates, honoring the clip's crop, rotation, flips, fit, scale and offset.
 * Masks are stored in sequence coordinates so they stay valid when the clip transform changes later only
 * if they are re-mapped; callers re-run detection after transform changes.
 */
export function sourceBoxToSequence(clip: Clip, sourceW: number, sourceH: number, seqW: number, seqH: number, box: NormBox): NormBox {
  const corners = [
    { x: box.x * sourceW, y: box.y * sourceH },
    { x: (box.x + box.w) * sourceW, y: box.y * sourceH },
    { x: box.x * sourceW, y: (box.y + box.h) * sourceH },
    { x: (box.x + box.w) * sourceW, y: (box.y + box.h) * sourceH },
  ].map((p) => mapSourcePointToSequence(clip, sourceW, sourceH, seqW, seqH, p));
  return boxFromPoints(corners, seqW, seqH);
}

/** Inverse of {@link sourceBoxToSequence}: a box drawn on the preview → normalized source coordinates. */
export function sequenceBoxToSource(clip: Clip, sourceW: number, sourceH: number, seqW: number, seqH: number, box: NormBox): NormBox {
  const corners = [
    { x: box.x * seqW, y: box.y * seqH },
    { x: (box.x + box.w) * seqW, y: box.y * seqH },
    { x: box.x * seqW, y: (box.y + box.h) * seqH },
    { x: (box.x + box.w) * seqW, y: (box.y + box.h) * seqH },
  ].map((p) => mapSequencePointToSource(clip, sourceW, sourceH, seqW, seqH, p));
  return boxFromPoints(corners, sourceW, sourceH);
}

/** Linear interpolation of mask keyframes at a timeline position (holds the first/last value outside). */
export function interpolateKeyframes(keyframes: MaskKeyframe[], tMs: number): MaskKeyframe | null {
  if (keyframes.length === 0) return null;
  const first = keyframes[0]!;
  const last = keyframes[keyframes.length - 1]!;
  if (tMs <= first.tMs) return first;
  if (tMs >= last.tMs) return last;
  let lo = 0;
  let hi = keyframes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid]!.tMs <= tMs) lo = mid;
    else hi = mid;
  }
  const a = keyframes[lo]!;
  const b = keyframes[hi]!;
  const span = b.tMs - a.tMs;
  const f = span <= 0 ? 0 : (tMs - a.tMs) / span;
  return { tMs, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: a.w + (b.w - a.w) * f, h: a.h + (b.h - a.h) * f, confidence: a.confidence == null || b.confidence == null ? null : Math.min(a.confidence, b.confidence) };
}

/** The mask box at a timeline position, or null when the mask is disabled/outside its range. */
export function maskBoxAt(mask: MaskTrack, tMs: number): NormBox | null {
  if (!mask.enabled || tMs < mask.startMs || tMs >= mask.endMs) return null;
  const k = interpolateKeyframes(mask.keyframes, tMs);
  return k ? { x: k.x, y: k.y, w: k.w, h: k.h } : null;
}

/** Intersection over union of two normalized boxes. */
export function boxIou(a: NormBox, b: NormBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Expands a box by a fraction of its size on every side, clamped to the unit square. */
export function expandBox(box: NormBox, margin: number): NormBox {
  const dx = box.w * margin;
  const dy = box.h * margin;
  const x = Math.max(0, box.x - dx);
  const y = Math.max(0, box.y - dy);
  return { x, y, w: Math.min(1 - x, box.w + 2 * dx), h: Math.min(1 - y, box.h + 2 * dy) };
}

/** Timeline position for a source position inside a clip (inverse of `timelineToSourceMs`). */
export function sourceToTimelineMs(clip: Clip, sourceMs: number): number {
  if (clip.freeze) return clip.startMs;
  const span = Math.max(1, clip.sourceOutMs - clip.sourceInMs);
  const p = Math.max(0, Math.min(1, (sourceMs - clip.sourceInMs) / span));
  const progress = clip.reverse ? 1 - p : p;
  return clip.startMs + progress * clip.durationMs;
}

/**
 * Drops keyframes that linear interpolation reproduces within `tolerance` (normalized units) so tracked masks stay
 * compact in the document. Always keeps the first and last keyframe and at least one keyframe per `maxGapMs`.
 */
export function simplifyKeyframes(keyframes: MaskKeyframe[], tolerance = 0.004, maxGapMs = 500): MaskKeyframe[] {
  if (keyframes.length <= 2) return [...keyframes];
  const sorted = [...keyframes].sort((a, b) => a.tMs - b.tMs);
  const keep: boolean[] = new Array(sorted.length).fill(false);
  keep[0] = true;
  keep[sorted.length - 1] = true;
  const err = (a: MaskKeyframe, b: MaskKeyframe, k: MaskKeyframe): number => {
    const span = b.tMs - a.tMs;
    const f = span <= 0 ? 0 : (k.tMs - a.tMs) / span;
    return Math.max(Math.abs(a.x + (b.x - a.x) * f - k.x), Math.abs(a.y + (b.y - a.y) * f - k.y), Math.abs(a.w + (b.w - a.w) * f - k.w), Math.abs(a.h + (b.h - a.h) * f - k.h));
  };
  const stack: Array<[number, number]> = [[0, sorted.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    let worst = -1;
    let worstErr = 0;
    for (let i = lo + 1; i < hi; i++) {
      const e = err(sorted[lo]!, sorted[hi]!, sorted[i]!);
      if (e > worstErr) {
        worstErr = e;
        worst = i;
      }
    }
    const gapTooLong = sorted[hi]!.tMs - sorted[lo]!.tMs > maxGapMs;
    if (worst >= 0 && (worstErr > tolerance || gapTooLong)) {
      const pick = worstErr > tolerance ? worst : Math.floor((lo + hi) / 2);
      keep[pick] = true;
      stack.push([lo, pick], [pick, hi]);
    }
  }
  return sorted.filter((_, i) => keep[i]);
}
