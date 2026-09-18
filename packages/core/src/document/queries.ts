import type { Clip, ProjectDocument, Track } from './types';

export function getTrack(doc: ProjectDocument, trackId: string): Track | undefined {
  return doc.tracks.find((t) => t.id === trackId);
}

export function findClip(doc: ProjectDocument, clipId: string): { track: Track; clip: Clip; index: number } | undefined {
  for (const track of doc.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index]!, index };
  }
  return undefined;
}

export function allClips(doc: ProjectDocument): Clip[] {
  return doc.tracks.flatMap((t) => t.clips);
}

export function clipEndMs(clip: Clip): number {
  return clip.startMs + clip.durationMs;
}

/** Total timeline duration: the end of the last clip on any track (0 for an empty project). */
export function getDocumentDurationMs(doc: ProjectDocument): number {
  let end = 0;
  for (const track of doc.tracks) {
    for (const clip of track.clips) end = Math.max(end, clipEndMs(clip));
  }
  return end;
}

export function clipsAt(doc: ProjectDocument, tMs: number): Clip[] {
  return allClips(doc).filter((c) => c.startMs <= tMs && tMs < clipEndMs(c));
}

export function clipAtOnTrack(track: Track, tMs: number): Clip | undefined {
  return track.clips.find((c) => c.startMs <= tMs && tMs < clipEndMs(c));
}

export function clipsOverlap(a: Clip, b: Clip): boolean {
  return a.startMs < clipEndMs(b) && b.startMs < clipEndMs(a);
}

export function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.startMs - b.startMs);
}

/** Converts a timeline position inside a clip to the corresponding source position (ms). */
export function timelineToSourceMs(clip: Clip, tMs: number): number {
  const local = Math.max(0, Math.min(clip.durationMs, tMs - clip.startMs));
  if (clip.freeze) return clip.freeze.atSourceMs;
  const sourceSpan = clip.sourceOutMs - clip.sourceInMs;
  const progress = clip.durationMs === 0 ? 0 : local / clip.durationMs;
  const p = clip.reverse ? 1 - progress : progress;
  return clip.sourceInMs + p * sourceSpan;
}

/** Expected timeline duration of a clip for its source range and speed. */
export function naturalDurationMs(clip: Pick<Clip, 'sourceInMs' | 'sourceOutMs' | 'speed'>): number {
  const span = clip.sourceOutMs - clip.sourceInMs;
  return Math.max(1, Math.round(span / (clip.speed || 1)));
}

export function hasAssetUsage(doc: ProjectDocument, assetId: string): boolean {
  return allClips(doc).some((c) => c.assetId === assetId);
}

export function isEmptyProject(doc: ProjectDocument): boolean {
  return allClips(doc).length === 0;
}

/** Summary used by the AI planner to reason about the project. */
export interface DocumentSummary {
  durationMs: number;
  clipCount: number;
  videoTrackCount: number;
  audioTrackCount: number;
  hasAudio: boolean;
  hasVideo: boolean;
  subtitleLanguages: string[];
  maskCount: number;
  width: number;
  height: number;
  aspect: string;
}

export function summarizeDocument(doc: ProjectDocument): DocumentSummary {
  const clips = allClips(doc);
  const assets = clips.map((c) => doc.assets[c.assetId]).filter(Boolean);
  return {
    durationMs: getDocumentDurationMs(doc),
    clipCount: clips.length,
    videoTrackCount: doc.tracks.filter((t) => t.kind === 'video').length,
    audioTrackCount: doc.tracks.filter((t) => t.kind === 'audio').length,
    hasAudio: assets.some((a) => a!.hasAudio),
    hasVideo: assets.some((a) => a!.hasVideo),
    subtitleLanguages: doc.subtitles.map((s) => s.language),
    maskCount: doc.masks.length,
    width: doc.settings.width,
    height: doc.settings.height,
    aspect: doc.settings.aspectPreset,
  };
}
