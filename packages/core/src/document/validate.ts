import { clipEndMs, getDocumentDurationMs } from './queries';
import type { ProjectDocument } from './types';

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code:
    | 'SEQUENCE_INVALID'
    | 'TRACK_CLIP_OVERLAP'
    | 'CLIP_INVALID_DURATION'
    | 'CLIP_SOURCE_RANGE'
    | 'CLIP_ASSET_MISSING'
    | 'ASSET_FILE_MISSING'
    | 'MASK_CLIP_MISSING'
    | 'MASK_EMPTY'
    | 'SUBTITLE_CUE_INVALID'
    | 'SUBTITLE_CUE_BEYOND_END'
    | 'MARKER_BEYOND_END'
    | 'PROJECT_EMPTY';
  severity: IssueSeverity;
  message: string;
  ref: { trackId?: string; clipId?: string; assetId?: string; maskId?: string; subtitleTrackId?: string; cueId?: string; markerId?: string };
}

export interface ValidationReport {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
}

/** Structural validation of a project document. Errors block rendering/export; warnings are informative. */
export function validateDocument(doc: ProjectDocument): ValidationReport {
  const issues: ValidationIssue[] = [];
  const s = doc.settings;
  if (!(s.width > 0 && s.height > 0 && s.fps.num > 0 && s.fps.den > 0 && s.sampleRate > 0)) {
    issues.push({ code: 'SEQUENCE_INVALID', severity: 'error', message: 'Sequence settings are invalid', ref: {} });
  }
  const duration = getDocumentDurationMs(doc);
  const clipIds = new Set<string>();
  for (const track of doc.tracks) {
    const sorted = [...track.clips].sort((a, b) => a.startMs - b.startMs);
    for (let i = 0; i < sorted.length; i++) {
      const clip = sorted[i]!;
      clipIds.add(clip.id);
      if (!(clip.durationMs > 0) || clip.startMs < 0) {
        issues.push({ code: 'CLIP_INVALID_DURATION', severity: 'error', message: `Clip "${clip.name}" has an invalid position or duration`, ref: { trackId: track.id, clipId: clip.id } });
      }
      const asset = doc.assets[clip.assetId];
      if (!asset) {
        issues.push({ code: 'CLIP_ASSET_MISSING', severity: 'error', message: `Clip "${clip.name}" references an unknown asset`, ref: { trackId: track.id, clipId: clip.id, assetId: clip.assetId } });
      } else {
        if (asset.missing) {
          issues.push({ code: 'ASSET_FILE_MISSING', severity: 'error', message: `Media file for "${asset.name}" is missing`, ref: { assetId: asset.id, clipId: clip.id } });
        }
        if (!clip.freeze && asset.kind !== 'image') {
          if (clip.sourceInMs < 0 || clip.sourceOutMs <= clip.sourceInMs || (asset.durationMs != null && clip.sourceOutMs > asset.durationMs + 1)) {
            issues.push({ code: 'CLIP_SOURCE_RANGE', severity: 'error', message: `Clip "${clip.name}" source range is outside its media`, ref: { trackId: track.id, clipId: clip.id } });
          }
        }
      }
      const next = sorted[i + 1];
      if (next && next.startMs < clipEndMs(clip)) {
        issues.push({ code: 'TRACK_CLIP_OVERLAP', severity: 'error', message: `Clips "${clip.name}" and "${next.name}" overlap on track ${track.name}`, ref: { trackId: track.id, clipId: next.id } });
      }
    }
  }
  for (const mask of doc.masks) {
    if (!clipIds.has(mask.clipId)) {
      issues.push({ code: 'MASK_CLIP_MISSING', severity: 'error', message: `Mask "${mask.label}" references a missing clip`, ref: { maskId: mask.id, clipId: mask.clipId } });
    }
    if (mask.keyframes.length === 0 && !mask.keyframesFile) {
      issues.push({ code: 'MASK_EMPTY', severity: 'warning', message: `Mask "${mask.label}" has no keyframes`, ref: { maskId: mask.id } });
    }
  }
  for (const sub of doc.subtitles) {
    for (const cue of sub.cues) {
      if (cue.endMs <= cue.startMs || cue.startMs < 0) {
        issues.push({ code: 'SUBTITLE_CUE_INVALID', severity: 'error', message: 'A subtitle cue has an invalid time range', ref: { subtitleTrackId: sub.id, cueId: cue.id } });
      } else if (duration > 0 && cue.startMs >= duration) {
        issues.push({ code: 'SUBTITLE_CUE_BEYOND_END', severity: 'warning', message: 'A subtitle cue starts after the end of the timeline', ref: { subtitleTrackId: sub.id, cueId: cue.id } });
      }
    }
  }
  for (const marker of doc.markers) {
    if (duration > 0 && marker.tMs > duration) {
      issues.push({ code: 'MARKER_BEYOND_END', severity: 'warning', message: `Marker "${marker.label}" is beyond the end of the timeline`, ref: { markerId: marker.id } });
    }
  }
  if (clipIds.size === 0) {
    issues.push({ code: 'PROJECT_EMPTY', severity: 'warning', message: 'The timeline is empty', ref: {} });
  }
  const errors = issues.filter((i) => i.severity === 'error').length;
  return { ok: errors === 0, errors, warnings: issues.length - errors, issues };
}
