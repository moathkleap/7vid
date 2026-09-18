import { clipAtOnTrack, timelineToSourceMs, type Clip, type ProjectDocument, type SubtitleTrack, type Track } from '@sevenvid/core';

export interface LayerFrame {
  clip: Clip;
  track: Track;
  sourceMs: number;
  order: number;
}

/** Visual clips active at a timeline position, bottom to top (video tracks in order, then overlays). */
export function visibleLayers(doc: ProjectDocument, tMs: number): LayerFrame[] {
  const soloed = doc.tracks.some((t) => t.solo);
  const tracks = [...doc.tracks.filter((t) => t.kind === 'video'), ...doc.tracks.filter((t) => t.kind === 'overlay')];
  const layers: LayerFrame[] = [];
  let order = 0;
  for (const track of tracks) {
    if (track.muted || (soloed && !track.solo)) continue;
    const clip = clipAtOnTrack(track, tMs);
    if (!clip) continue;
    const asset = doc.assets[clip.assetId];
    if (!asset || !asset.hasVideo) continue;
    layers.push({ clip, track, sourceMs: timelineToSourceMs(clip, tMs), order: order++ });
  }
  return layers;
}

/** Audible clips at a timeline position with their effective linear gain (0..1+). */
export function audibleClips(doc: ProjectDocument, tMs: number): Array<{ clip: Clip; track: Track; sourceMs: number; gain: number }> {
  const soloed = doc.tracks.some((t) => t.solo);
  const out: Array<{ clip: Clip; track: Track; sourceMs: number; gain: number }> = [];
  for (const track of doc.tracks) {
    if (track.kind === 'overlay' || track.muted || (soloed && !track.solo)) continue;
    const clip = clipAtOnTrack(track, tMs);
    if (!clip || clip.audio.muted || clip.freeze) continue;
    const asset = doc.assets[clip.assetId];
    if (!asset || !asset.hasAudio) continue;
    const local = tMs - clip.startMs;
    let gain = Math.pow(10, (clip.audio.gainDb + track.gainDb + doc.master.gainDb) / 20);
    if (clip.audio.fadeInMs > 0 && local < clip.audio.fadeInMs) gain *= local / clip.audio.fadeInMs;
    if (clip.audio.fadeOutMs > 0 && local > clip.durationMs - clip.audio.fadeOutMs) gain *= Math.max(0, (clip.durationMs - local) / clip.audio.fadeOutMs);
    out.push({ clip, track, sourceMs: timelineToSourceMs(clip, tMs), gain: Math.max(0, Math.min(1, gain)) });
  }
  return out;
}

export function activeCues(tracks: SubtitleTrack[], tMs: number): Array<{ track: SubtitleTrack; text: string }> {
  const out: Array<{ track: SubtitleTrack; text: string }> = [];
  for (const track of tracks) {
    if (!track.enabled) continue;
    for (const cue of track.cues) if (cue.startMs <= tMs && tMs < cue.endMs) out.push({ track, text: cue.text });
  }
  return out;
}

/** CSS filter string approximating the clip's color effect for the live preview. */
export function cssFilterFor(clip: Clip): string {
  const parts: string[] = [];
  for (const e of clip.effects) {
    if (!e.enabled) continue;
    if (e.type === 'color') {
      const b = Number(e.params.brightness ?? 0);
      const c = Number(e.params.contrast ?? 1);
      const s = Number(e.params.saturation ?? 1);
      const ex = Number(e.params.exposure ?? 0);
      if (b || ex) parts.push(`brightness(${(1 + b + ex * 0.5).toFixed(3)})`);
      if (c !== 1) parts.push(`contrast(${c.toFixed(3)})`);
      if (s !== 1) parts.push(`saturate(${s.toFixed(3)})`);
      const temp = Number(e.params.temperature ?? 6500);
      if (Math.abs(temp - 6500) > 50) parts.push(`sepia(${Math.min(0.4, Math.abs(temp - 6500) / 10000).toFixed(3)})`);
    } else if (e.type === 'sharpen') {
      parts.push('contrast(1.05)');
    }
  }
  return parts.join(' ');
}

export interface DrawRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Computes destination rectangle for a source of size (sw, sh) inside the canvas (W, H) using the clip transform. */
export function fitRect(clip: Clip, sw: number, sh: number, W: number, H: number): DrawRect {
  const t = clip.transform;
  const scale = Math.max(0.01, t.scale);
  const boxW = W * scale;
  const boxH = H * scale;
  let w: number;
  let h: number;
  if (t.fit === 'stretch') {
    w = boxW;
    h = boxH;
  } else if (t.fit === 'cover') {
    const r = Math.max(boxW / sw, boxH / sh);
    w = sw * r;
    h = sh * r;
  } else {
    const r = Math.min(boxW / sw, boxH / sh);
    w = sw * r;
    h = sh * r;
  }
  const x = (W - w) / 2 + t.offsetX * W;
  const y = (H - h) / 2 + t.offsetY * H;
  return { x, y, w, h };
}
