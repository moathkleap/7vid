import { applyPatches, current, enablePatches, isDraft, produceWithPatches, type Patch } from 'immer';
import { newId } from '../ids';
import { fpsEquals } from './factory';
import { clipEndMs, getDocumentDurationMs, naturalDurationMs, sortClips } from './queries';
import type {
  AssetRef,
  Clip,
  ClipAudio,
  Effect,
  EffectParamValue,
  FreezeFrame,
  Marker,
  MaskTrack,
  MasterAudio,
  ProjectDocument,
  SequenceSettings,
  SubtitleCue,
  SubtitleTrack,
  Track,
  TrackKind,
  Transform,
} from './types';

enablePatches();

/** Deep-clones a value, unwrapping immer drafts first (structuredClone cannot clone proxies). */
function cloneValue<T>(value: T): T {
  return structuredClone(isDraft(value) ? (current(value) as T) : value);
}

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export type Command =
  | { type: 'project.rename'; name: string }
  | { type: 'sequence.update'; settings: Partial<SequenceSettings> }
  | { type: 'asset.add'; asset: AssetRef }
  | { type: 'asset.update'; assetId: string; patch: Partial<Omit<AssetRef, 'id'>> }
  | { type: 'asset.remove'; assetId: string }
  | { type: 'track.add'; kind: TrackKind; name?: string; id?: string; index?: number }
  | { type: 'track.remove'; trackId: string }
  | {
      type: 'track.update';
      trackId: string;
      patch: Partial<Pick<Track, 'name' | 'muted' | 'locked' | 'solo' | 'gainDb'>>;
    }
  | { type: 'track.move'; trackId: string; toIndex: number }
  | { type: 'clip.insert'; clip: Clip; mode: 'overwrite' | 'insert' }
  | { type: 'clip.remove'; clipIds: string[]; ripple: boolean }
  | { type: 'clip.move'; clipId: string; trackId?: string; startMs: number; mode?: 'overwrite' | 'insert' }
  | { type: 'clip.trim'; clipId: string; edge: 'start' | 'end'; toMs: number; ripple: boolean }
  | { type: 'clip.split'; clipId: string; atMs: number; newClipId?: string }
  | { type: 'clip.join'; clipIdA: string; clipIdB: string }
  | { type: 'clip.update'; clipId: string; patch: Partial<Pick<Clip, 'name' | 'color' | 'linkedClipId'>> }
  | { type: 'clip.setSpeed'; clipId: string; speed: number; ripple: boolean }
  | { type: 'clip.setReverse'; clipId: string; reverse: boolean }
  | { type: 'clip.setFreeze'; clipId: string; freeze: FreezeFrame | null; durationMs?: number; ripple?: boolean }
  | { type: 'clip.setTransform'; clipId: string; transform: Partial<Transform> }
  | { type: 'clip.setAudio'; clipId: string; audio: Partial<ClipAudio> }
  | { type: 'clip.duplicate'; clipId: string; newClipId?: string }
  | { type: 'clip.replaceAsset'; clipId: string; asset: AssetRef }
  | { type: 'effect.add'; clipId: string; effect: Effect }
  | {
      type: 'effect.update';
      clipId: string;
      effectId: string;
      patch: { enabled?: boolean; params?: Record<string, EffectParamValue> };
    }
  | { type: 'effect.remove'; clipId: string; effectId: string }
  | { type: 'mask.add'; mask: MaskTrack }
  | { type: 'mask.update'; maskId: string; patch: Partial<Omit<MaskTrack, 'id'>> }
  | { type: 'mask.remove'; maskId: string }
  | { type: 'subtitle.addTrack'; track: SubtitleTrack }
  | { type: 'subtitle.updateTrack'; trackId: string; patch: Partial<Omit<SubtitleTrack, 'id' | 'cues'>> }
  | { type: 'subtitle.removeTrack'; trackId: string }
  | { type: 'subtitle.setCues'; trackId: string; cues: SubtitleCue[] }
  | { type: 'subtitle.addCue'; trackId: string; cue: SubtitleCue }
  | { type: 'subtitle.updateCue'; trackId: string; cueId: string; patch: Partial<Omit<SubtitleCue, 'id'>> }
  | { type: 'subtitle.removeCue'; trackId: string; cueId: string }
  | { type: 'marker.add'; marker: Marker }
  | { type: 'marker.update'; markerId: string; patch: Partial<Omit<Marker, 'id'>> }
  | { type: 'marker.remove'; markerId: string }
  | { type: 'master.update'; patch: Partial<MasterAudio> }
  | { type: 'timeline.cutRange'; startMs: number; endMs: number }
  | { type: 'timeline.cutRanges'; ranges: TimeRange[] }
  | { type: 'timeline.trimStart'; ms: number }
  | { type: 'timeline.trimEnd'; ms: number }
  | { type: 'timeline.setDuration'; targetMs: number; strategy: 'trim-end' | 'trim-start' | 'speed' }
  | { type: 'batch'; commands: Command[]; label?: string };

export type CommandType = Command['type'];

export interface CommandResult {
  doc: ProjectDocument;
  patches: Patch[];
  inversePatches: Patch[];
  changed: boolean;
  label: string;
}

export type CommandErrorCode =
  | 'CLIP_NOT_FOUND'
  | 'TRACK_NOT_FOUND'
  | 'ASSET_NOT_FOUND'
  | 'MASK_NOT_FOUND'
  | 'SUBTITLE_TRACK_NOT_FOUND'
  | 'CUE_NOT_FOUND'
  | 'MARKER_NOT_FOUND'
  | 'EFFECT_NOT_FOUND'
  | 'TRACK_LOCKED'
  | 'TRACK_KIND_MISMATCH'
  | 'INVALID_RANGE'
  | 'INVALID_VALUE'
  | 'CLIPS_NOT_ADJACENT'
  | 'CANNOT_REMOVE_LAST_TRACK'
  | 'ASSET_IN_USE';

export class CommandError extends Error {
  constructor(
    public readonly code: CommandErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

function req<T>(value: T | undefined, code: CommandErrorCode, message: string, details?: Record<string, unknown>): T {
  if (value === undefined) throw new CommandError(code, message, details);
  return value;
}

function trackOf(doc: ProjectDocument, trackId: string): Track {
  return req(doc.tracks.find((t) => t.id === trackId), 'TRACK_NOT_FOUND', `Track ${trackId} not found`, { trackId });
}

function locate(doc: ProjectDocument, clipId: string): { track: Track; clip: Clip; index: number } {
  for (const track of doc.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index]!, index };
  }
  throw new CommandError('CLIP_NOT_FOUND', `Clip ${clipId} not found`, { clipId });
}

function assertUnlocked(track: Track): void {
  if (track.locked) throw new CommandError('TRACK_LOCKED', `Track ${track.name} is locked`, { trackId: track.id });
}

function sortTrack(track: Track): void {
  track.clips.sort((a, b) => a.startMs - b.startMs);
}

/** Shifts every clip on the track that starts at or after `fromMs` by `deltaMs`. */
function rippleTrack(track: Track, fromMs: number, deltaMs: number, exceptClipId?: string): void {
  for (const clip of track.clips) {
    if (clip.id === exceptClipId) continue;
    if (clip.startMs >= fromMs) clip.startMs = Math.max(0, clip.startMs + deltaMs);
  }
}

/** Source-range adjustment for trimming `deltaTimelineMs` off the given edge, honoring speed and reverse. */
function applyEdgeTrim(clip: Clip, edge: 'start' | 'end', deltaTimelineMs: number): void {
  const deltaSource = deltaTimelineMs * clip.speed;
  if (clip.freeze) {
    clip.durationMs = Math.max(1, clip.durationMs - deltaTimelineMs);
    if (edge === 'start') clip.startMs += deltaTimelineMs;
    return;
  }
  const affectsIn = (edge === 'start') !== clip.reverse;
  if (affectsIn) clip.sourceInMs = clip.sourceInMs + deltaSource;
  else clip.sourceOutMs = clip.sourceOutMs - deltaSource;
  if (edge === 'start') clip.startMs += deltaTimelineMs;
  clip.durationMs = naturalDurationMs(clip);
}

/** Removes the timeline range [a, b) from a single clip, returning up to two remaining pieces (mutates nothing). */
function cutClipRange(clip: Clip, a: number, b: number, newIdFactory: () => string): Clip[] {
  const start = clip.startMs;
  const end = clipEndMs(clip);
  if (b <= start || a >= end) return [clip];
  if (a <= start && b >= end) return [];
  const pieces: Clip[] = [];
  if (a > start) {
    const left: Clip = cloneValue(clip);
    applyEdgeTrim(left, 'end', end - a);
    pieces.push(left);
  }
  if (b < end) {
    const right: Clip = cloneValue(clip);
    right.id = pieces.length > 0 ? newIdFactory() : clip.id;
    applyEdgeTrim(right, 'start', b - start);
    pieces.push(right);
  }
  return pieces;
}

function placeClip(track: Track, clip: Clip, mode: 'overwrite' | 'insert', newIdFactory: () => string): void {
  if (mode === 'insert') {
    rippleTrack(track, clip.startMs, clip.durationMs, clip.id);
    track.clips.push(clip);
    sortTrack(track);
    return;
  }
  const a = clip.startMs;
  const b = clipEndMs(clip);
  const next: Clip[] = [];
  for (const existing of track.clips) {
    if (existing.id === clip.id) continue;
    next.push(...cutClipRange(existing, a, b, newIdFactory));
  }
  next.push(clip);
  track.clips = next;
  sortTrack(track);
}

function splitMasksForClip(doc: ProjectDocument, clip: Clip, atMs: number, newClipId: string): void {
  const additions: MaskTrack[] = [];
  for (const mask of doc.masks) {
    if (mask.clipId !== clip.id) continue;
    if (mask.startMs >= atMs) {
      mask.clipId = newClipId;
    } else if (mask.endMs > atMs) {
      const right: MaskTrack = cloneValue(mask);
      right.id = newId('msk');
      right.clipId = newClipId;
      right.startMs = atMs;
      right.keyframes = mask.keyframes.filter((k) => k.tMs >= atMs);
      mask.endMs = atMs;
      mask.keyframes = mask.keyframes.filter((k) => k.tMs < atMs);
      additions.push(right);
    }
  }
  doc.masks.push(...additions);
}

function cutRangeEverywhere(doc: ProjectDocument, a: number, b: number): void {
  if (!(b > a) || a < 0) throw new CommandError('INVALID_RANGE', `Invalid range ${a}-${b}`, { startMs: a, endMs: b });
  const delta = b - a;
  for (const track of doc.tracks) {
    if (track.locked) continue;
    const next: Clip[] = [];
    for (const clip of track.clips) {
      const pieces = cutClipRange(clip, a, b, () => newId('clp'));
      for (const piece of pieces) {
        if (piece.startMs >= b) piece.startMs -= delta;
        next.push(piece);
      }
      if (pieces.length === 0) {
        doc.masks = doc.masks.filter((m) => m.clipId !== clip.id);
      }
    }
    track.clips = next;
    sortTrack(track);
  }
  for (const sub of doc.subtitles) {
    const cues: SubtitleCue[] = [];
    for (const cue of sub.cues) {
      if (cue.endMs <= a) {
        cues.push(cue);
      } else if (cue.startMs >= b) {
        cues.push({ ...cue, startMs: cue.startMs - delta, endMs: cue.endMs - delta });
      } else if (cue.startMs < a && cue.endMs > b) {
        cues.push({ ...cue, endMs: cue.endMs - delta });
      } else if (cue.startMs < a) {
        cues.push({ ...cue, endMs: a });
      } else if (cue.endMs > b) {
        cues.push({ ...cue, startMs: a, endMs: cue.endMs - delta });
      }
    }
    sub.cues = cues;
  }
  doc.markers = doc.markers
    .filter((m) => m.tMs < a || m.tMs >= b)
    .map((m) => (m.tMs >= b ? { ...m, tMs: m.tMs - delta } : m));
  const masks: MaskTrack[] = [];
  for (const mask of doc.masks) {
    if (mask.endMs <= a) {
      masks.push(mask);
      continue;
    }
    if (mask.startMs >= b) {
      mask.startMs -= delta;
      mask.endMs -= delta;
      mask.keyframes = mask.keyframes.map((k) => ({ ...k, tMs: k.tMs - delta }));
      masks.push(mask);
      continue;
    }
    mask.keyframes = mask.keyframes
      .filter((k) => k.tMs < a || k.tMs >= b)
      .map((k) => (k.tMs >= b ? { ...k, tMs: k.tMs - delta } : k));
    mask.startMs = Math.min(mask.startMs, a);
    mask.endMs = mask.endMs >= b ? mask.endMs - delta : Math.min(mask.endMs, a);
    if (mask.endMs > mask.startMs) masks.push(mask);
  }
  doc.masks = masks;
}

function commandLabel(cmd: Command): string {
  if (cmd.type === 'batch') return cmd.label ?? `batch(${cmd.commands.length})`;
  return cmd.type;
}

function mutate(doc: ProjectDocument, cmd: Command): void {
  switch (cmd.type) {
    case 'project.rename': {
      if (!cmd.name.trim()) throw new CommandError('INVALID_VALUE', 'Project name cannot be empty');
      doc.name = cmd.name.trim();
      return;
    }
    case 'sequence.update': {
      const next = { ...doc.settings, ...cmd.settings };
      if (next.width <= 0 || next.height <= 0 || next.width % 2 || next.height % 2) {
        throw new CommandError('INVALID_VALUE', 'Sequence dimensions must be positive even numbers', {
          width: next.width,
          height: next.height,
        });
      }
      if (next.fps.num <= 0 || next.fps.den <= 0) throw new CommandError('INVALID_VALUE', 'Invalid fps');
      if (!fpsEquals(next.fps, doc.settings.fps)) doc.settings.fps = next.fps;
      doc.settings = { ...next, fps: doc.settings.fps };
      return;
    }
    case 'asset.add': {
      doc.assets[cmd.asset.id] = cmd.asset;
      return;
    }
    case 'asset.update': {
      const asset = req(doc.assets[cmd.assetId], 'ASSET_NOT_FOUND', `Asset ${cmd.assetId} not found`);
      Object.assign(asset, cmd.patch);
      return;
    }
    case 'asset.remove': {
      req(doc.assets[cmd.assetId], 'ASSET_NOT_FOUND', `Asset ${cmd.assetId} not found`);
      const removedClipIds = new Set<string>();
      for (const track of doc.tracks) {
        track.clips = track.clips.filter((c) => {
          if (c.assetId === cmd.assetId) removedClipIds.add(c.id);
          return c.assetId !== cmd.assetId;
        });
      }
      doc.masks = doc.masks.filter((m) => !removedClipIds.has(m.clipId));
      delete doc.assets[cmd.assetId];
      return;
    }
    case 'track.add': {
      const kindCount = doc.tracks.filter((t) => t.kind === cmd.kind).length + 1;
      const prefix = cmd.kind === 'video' ? 'V' : cmd.kind === 'audio' ? 'A' : 'FX';
      const track: Track = {
        id: cmd.id ?? newId('trk'),
        kind: cmd.kind,
        name: cmd.name ?? `${prefix}${kindCount}`,
        muted: false,
        locked: false,
        solo: false,
        gainDb: 0,
        clips: [],
      };
      if (cmd.index != null) doc.tracks.splice(Math.max(0, Math.min(doc.tracks.length, cmd.index)), 0, track);
      else doc.tracks.push(track);
      return;
    }
    case 'track.remove': {
      const track = trackOf(doc, cmd.trackId);
      const sameKind = doc.tracks.filter((t) => t.kind === track.kind);
      if (sameKind.length <= 1 && track.kind !== 'overlay') {
        throw new CommandError('CANNOT_REMOVE_LAST_TRACK', `Cannot remove the last ${track.kind} track`);
      }
      const clipIds = new Set(track.clips.map((c) => c.id));
      doc.masks = doc.masks.filter((m) => !clipIds.has(m.clipId));
      doc.tracks = doc.tracks.filter((t) => t.id !== cmd.trackId);
      return;
    }
    case 'track.update': {
      const track = trackOf(doc, cmd.trackId);
      Object.assign(track, cmd.patch);
      return;
    }
    case 'track.move': {
      const from = doc.tracks.findIndex((t) => t.id === cmd.trackId);
      if (from < 0) throw new CommandError('TRACK_NOT_FOUND', `Track ${cmd.trackId} not found`);
      const [track] = doc.tracks.splice(from, 1);
      doc.tracks.splice(Math.max(0, Math.min(doc.tracks.length, cmd.toIndex)), 0, track!);
      return;
    }
    case 'clip.insert': {
      const track = trackOf(doc, cmd.clip.trackId);
      assertUnlocked(track);
      req(doc.assets[cmd.clip.assetId], 'ASSET_NOT_FOUND', `Asset ${cmd.clip.assetId} not found`);
      if (cmd.clip.durationMs <= 0) throw new CommandError('INVALID_VALUE', 'Clip duration must be positive');
      placeClip(track, cloneValue(cmd.clip), cmd.mode, () => newId('clp'));
      return;
    }
    case 'clip.remove': {
      for (const clipId of cmd.clipIds) {
        const { track, clip, index } = locate(doc, clipId);
        assertUnlocked(track);
        track.clips.splice(index, 1);
        doc.masks = doc.masks.filter((m) => m.clipId !== clipId);
        if (cmd.ripple) rippleTrack(track, clipEndMs(clip), -clip.durationMs);
      }
      return;
    }
    case 'clip.move': {
      const { track: fromTrack, clip, index } = locate(doc, cmd.clipId);
      assertUnlocked(fromTrack);
      const toTrack = cmd.trackId ? trackOf(doc, cmd.trackId) : fromTrack;
      assertUnlocked(toTrack);
      if (toTrack.kind !== fromTrack.kind) {
        throw new CommandError('TRACK_KIND_MISMATCH', 'Cannot move a clip between tracks of different kinds');
      }
      if (cmd.startMs < 0) throw new CommandError('INVALID_VALUE', 'Clip start must be >= 0');
      fromTrack.clips.splice(index, 1);
      const delta = cmd.startMs - clip.startMs;
      clip.startMs = Math.round(cmd.startMs);
      clip.trackId = toTrack.id;
      for (const mask of doc.masks) {
        if (mask.clipId !== clip.id) continue;
        mask.startMs += delta;
        mask.endMs += delta;
        mask.keyframes = mask.keyframes.map((k) => ({ ...k, tMs: k.tMs + delta }));
      }
      placeClip(toTrack, clip, cmd.mode ?? 'overwrite', () => newId('clp'));
      return;
    }
    case 'clip.trim': {
      const { track, clip } = locate(doc, cmd.clipId);
      assertUnlocked(track);
      const start = clip.startMs;
      const end = clipEndMs(clip);
      const asset = doc.assets[clip.assetId];
      if (cmd.edge === 'start') {
        const to = Math.round(cmd.toMs);
        if (to >= end) throw new CommandError('INVALID_RANGE', 'Start edge cannot pass the clip end');
        const delta = to - start;
        const sourceDelta = delta * clip.speed;
        if (!clip.freeze) {
          const affectsIn = !clip.reverse;
          if (affectsIn && clip.sourceInMs + sourceDelta < 0) {
            throw new CommandError('INVALID_RANGE', 'Cannot extend clip before the start of its source');
          }
          if (!affectsIn && asset?.durationMs != null && clip.sourceOutMs - sourceDelta > asset.durationMs) {
            throw new CommandError('INVALID_RANGE', 'Cannot extend clip beyond the end of its source');
          }
        }
        applyEdgeTrim(clip, 'start', delta);
        if (cmd.ripple) rippleTrack(track, start + 1, delta, clip.id);
        else {
          const prev = track.clips.find((c) => c.id !== clip.id && c.startMs < clip.startMs && clipEndMs(c) > clip.startMs);
          if (prev) applyEdgeTrim(prev, 'end', clipEndMs(prev) - clip.startMs);
        }
      } else {
        const to = Math.round(cmd.toMs);
        if (to <= start) throw new CommandError('INVALID_RANGE', 'End edge cannot pass the clip start');
        const delta = end - to;
        const sourceDelta = delta * clip.speed;
        if (!clip.freeze) {
          const affectsOut = !clip.reverse;
          if (affectsOut && asset?.durationMs != null && asset.kind !== 'image' && clip.sourceOutMs - sourceDelta > asset.durationMs) {
            throw new CommandError('INVALID_RANGE', 'Cannot extend clip beyond the end of its source');
          }
          if (!affectsOut && clip.sourceInMs + sourceDelta < 0) {
            throw new CommandError('INVALID_RANGE', 'Cannot extend clip before the start of its source');
          }
        }
        applyEdgeTrim(clip, 'end', delta);
        if (cmd.ripple) rippleTrack(track, end, -delta, clip.id);
        else {
          const next = track.clips.filter((c) => c.id !== clip.id && c.startMs < clipEndMs(clip) && clipEndMs(c) > clipEndMs(clip) && c.startMs >= start);
          for (const n of next) applyEdgeTrim(n, 'start', clipEndMs(clip) - n.startMs);
          track.clips = track.clips.filter((c) => c.id === clip.id || !(c.startMs >= start && clipEndMs(c) <= clipEndMs(clip)));
        }
      }
      sortTrack(track);
      return;
    }
    case 'clip.split': {
      const { track, clip } = locate(doc, cmd.clipId);
      assertUnlocked(track);
      const at = Math.round(cmd.atMs);
      if (at <= clip.startMs || at >= clipEndMs(clip)) {
        throw new CommandError('INVALID_RANGE', 'Split point must be inside the clip', { atMs: at });
      }
      const right = cloneValue(clip);
      right.id = cmd.newClipId ?? newId('clp');
      right.linkedClipId = null;
      applyEdgeTrim(right, 'start', at - clip.startMs);
      applyEdgeTrim(clip, 'end', clipEndMs(clip) - at);
      splitMasksForClip(doc, clip, at, right.id);
      track.clips.push(right);
      sortTrack(track);
      return;
    }
    case 'clip.join': {
      const a = locate(doc, cmd.clipIdA);
      const b = locate(doc, cmd.clipIdB);
      assertUnlocked(a.track);
      const [first, second] = a.clip.startMs <= b.clip.startMs ? [a, b] : [b, a];
      const contiguous =
        first.track.id === second.track.id &&
        first.clip.assetId === second.clip.assetId &&
        first.clip.speed === second.clip.speed &&
        first.clip.reverse === second.clip.reverse &&
        !first.clip.freeze &&
        !second.clip.freeze &&
        Math.abs(clipEndMs(first.clip) - second.clip.startMs) <= 1 &&
        Math.abs(first.clip.sourceOutMs - second.clip.sourceInMs) <= first.clip.speed;
      if (!contiguous) throw new CommandError('CLIPS_NOT_ADJACENT', 'Clips are not adjacent parts of the same source');
      first.clip.sourceOutMs = second.clip.sourceOutMs;
      first.clip.durationMs = naturalDurationMs(first.clip);
      first.track.clips = first.track.clips.filter((c) => c.id !== second.clip.id);
      for (const mask of doc.masks) if (mask.clipId === second.clip.id) mask.clipId = first.clip.id;
      return;
    }
    case 'clip.update': {
      const { clip } = locate(doc, cmd.clipId);
      Object.assign(clip, cmd.patch);
      return;
    }
    case 'clip.setSpeed': {
      const { track, clip } = locate(doc, cmd.clipId);
      assertUnlocked(track);
      if (!(cmd.speed > 0) || cmd.speed > 100) throw new CommandError('INVALID_VALUE', 'Speed must be between 0 and 100');
      const oldEnd = clipEndMs(clip);
      clip.speed = cmd.speed;
      if (!clip.freeze) clip.durationMs = naturalDurationMs(clip);
      const delta = clipEndMs(clip) - oldEnd;
      if (cmd.ripple) rippleTrack(track, oldEnd, delta, clip.id);
      else if (delta > 0) placeClip(track, clip, 'overwrite', () => newId('clp'));
      return;
    }
    case 'clip.setReverse': {
      const { clip } = locate(doc, cmd.clipId);
      clip.reverse = cmd.reverse;
      return;
    }
    case 'clip.setFreeze': {
      const { track, clip } = locate(doc, cmd.clipId);
      assertUnlocked(track);
      const oldEnd = clipEndMs(clip);
      clip.freeze = cmd.freeze;
      if (cmd.freeze) {
        if (cmd.durationMs != null) clip.durationMs = Math.max(1, Math.round(cmd.durationMs));
      } else {
        clip.durationMs = naturalDurationMs(clip);
      }
      const delta = clipEndMs(clip) - oldEnd;
      if (cmd.ripple) rippleTrack(track, oldEnd, delta, clip.id);
      else if (delta > 0) placeClip(track, clip, 'overwrite', () => newId('clp'));
      return;
    }
    case 'clip.setTransform': {
      const { clip } = locate(doc, cmd.clipId);
      clip.transform = { ...clip.transform, ...cmd.transform };
      return;
    }
    case 'clip.setAudio': {
      const { clip } = locate(doc, cmd.clipId);
      clip.audio = { ...clip.audio, ...cmd.audio };
      return;
    }
    case 'clip.duplicate': {
      const { track, clip } = locate(doc, cmd.clipId);
      assertUnlocked(track);
      const copy = cloneValue(clip);
      copy.id = cmd.newClipId ?? newId('clp');
      copy.linkedClipId = null;
      copy.startMs = clipEndMs(clip);
      placeClip(track, copy, 'insert', () => newId('clp'));
      return;
    }
    case 'clip.replaceAsset': {
      const { clip } = locate(doc, cmd.clipId);
      doc.assets[cmd.asset.id] = cmd.asset;
      clip.assetId = cmd.asset.id;
      clip.name = cmd.asset.name;
      const maxSource = cmd.asset.durationMs ?? clip.sourceOutMs;
      clip.sourceInMs = Math.min(clip.sourceInMs, Math.max(0, maxSource - 1));
      clip.sourceOutMs = Math.min(clip.sourceOutMs, maxSource);
      if (clip.sourceOutMs <= clip.sourceInMs) clip.sourceOutMs = clip.sourceInMs + 1;
      if (!clip.freeze) clip.durationMs = naturalDurationMs(clip);
      return;
    }
    case 'effect.add': {
      const { clip } = locate(doc, cmd.clipId);
      clip.effects.push(cloneValue(cmd.effect));
      return;
    }
    case 'effect.update': {
      const { clip } = locate(doc, cmd.clipId);
      const effect = req(clip.effects.find((e) => e.id === cmd.effectId), 'EFFECT_NOT_FOUND', `Effect ${cmd.effectId} not found`);
      if (cmd.patch.enabled != null) effect.enabled = cmd.patch.enabled;
      if (cmd.patch.params) effect.params = { ...effect.params, ...cmd.patch.params };
      return;
    }
    case 'effect.remove': {
      const { clip } = locate(doc, cmd.clipId);
      const before = clip.effects.length;
      clip.effects = clip.effects.filter((e) => e.id !== cmd.effectId);
      if (clip.effects.length === before) throw new CommandError('EFFECT_NOT_FOUND', `Effect ${cmd.effectId} not found`);
      return;
    }
    case 'mask.add': {
      locate(doc, cmd.mask.clipId);
      if (cmd.mask.endMs <= cmd.mask.startMs) throw new CommandError('INVALID_RANGE', 'Mask range is empty');
      doc.masks.push(cloneValue(cmd.mask));
      return;
    }
    case 'mask.update': {
      const mask = req(doc.masks.find((m) => m.id === cmd.maskId), 'MASK_NOT_FOUND', `Mask ${cmd.maskId} not found`);
      Object.assign(mask, cmd.patch);
      return;
    }
    case 'mask.remove': {
      const before = doc.masks.length;
      doc.masks = doc.masks.filter((m) => m.id !== cmd.maskId);
      if (doc.masks.length === before) throw new CommandError('MASK_NOT_FOUND', `Mask ${cmd.maskId} not found`);
      return;
    }
    case 'subtitle.addTrack': {
      doc.subtitles.push(cloneValue(cmd.track));
      return;
    }
    case 'subtitle.updateTrack': {
      const track = req(doc.subtitles.find((s) => s.id === cmd.trackId), 'SUBTITLE_TRACK_NOT_FOUND', `Subtitle track ${cmd.trackId} not found`);
      Object.assign(track, cmd.patch);
      return;
    }
    case 'subtitle.removeTrack': {
      const before = doc.subtitles.length;
      doc.subtitles = doc.subtitles.filter((s) => s.id !== cmd.trackId);
      if (doc.subtitles.length === before) throw new CommandError('SUBTITLE_TRACK_NOT_FOUND', `Subtitle track ${cmd.trackId} not found`);
      return;
    }
    case 'subtitle.setCues': {
      const track = req(doc.subtitles.find((s) => s.id === cmd.trackId), 'SUBTITLE_TRACK_NOT_FOUND', `Subtitle track ${cmd.trackId} not found`);
      for (const cue of cmd.cues) {
        if (cue.endMs <= cue.startMs) throw new CommandError('INVALID_RANGE', 'Cue end must be after start', { cueId: cue.id });
      }
      track.cues = [...cmd.cues].sort((a, b) => a.startMs - b.startMs);
      return;
    }
    case 'subtitle.addCue': {
      const track = req(doc.subtitles.find((s) => s.id === cmd.trackId), 'SUBTITLE_TRACK_NOT_FOUND', `Subtitle track ${cmd.trackId} not found`);
      if (cmd.cue.endMs <= cmd.cue.startMs) throw new CommandError('INVALID_RANGE', 'Cue end must be after start');
      track.cues.push({ ...cmd.cue });
      track.cues.sort((a, b) => a.startMs - b.startMs);
      return;
    }
    case 'subtitle.updateCue': {
      const track = req(doc.subtitles.find((s) => s.id === cmd.trackId), 'SUBTITLE_TRACK_NOT_FOUND', `Subtitle track ${cmd.trackId} not found`);
      const cue = req(track.cues.find((c) => c.id === cmd.cueId), 'CUE_NOT_FOUND', `Cue ${cmd.cueId} not found`);
      Object.assign(cue, cmd.patch);
      if (cue.endMs <= cue.startMs) throw new CommandError('INVALID_RANGE', 'Cue end must be after start');
      track.cues.sort((a, b) => a.startMs - b.startMs);
      return;
    }
    case 'subtitle.removeCue': {
      const track = req(doc.subtitles.find((s) => s.id === cmd.trackId), 'SUBTITLE_TRACK_NOT_FOUND', `Subtitle track ${cmd.trackId} not found`);
      const before = track.cues.length;
      track.cues = track.cues.filter((c) => c.id !== cmd.cueId);
      if (track.cues.length === before) throw new CommandError('CUE_NOT_FOUND', `Cue ${cmd.cueId} not found`);
      return;
    }
    case 'marker.add': {
      doc.markers.push({ ...cmd.marker });
      doc.markers.sort((a, b) => a.tMs - b.tMs);
      return;
    }
    case 'marker.update': {
      const marker = req(doc.markers.find((m) => m.id === cmd.markerId), 'MARKER_NOT_FOUND', `Marker ${cmd.markerId} not found`);
      Object.assign(marker, cmd.patch);
      doc.markers.sort((a, b) => a.tMs - b.tMs);
      return;
    }
    case 'marker.remove': {
      const before = doc.markers.length;
      doc.markers = doc.markers.filter((m) => m.id !== cmd.markerId);
      if (doc.markers.length === before) throw new CommandError('MARKER_NOT_FOUND', `Marker ${cmd.markerId} not found`);
      return;
    }
    case 'master.update': {
      doc.master = { ...doc.master, ...cmd.patch };
      return;
    }
    case 'timeline.cutRange': {
      cutRangeEverywhere(doc, Math.round(cmd.startMs), Math.round(cmd.endMs));
      return;
    }
    case 'timeline.cutRanges': {
      const ranges = [...cmd.ranges]
        .map((r) => ({ startMs: Math.round(r.startMs), endMs: Math.round(r.endMs) }))
        .filter((r) => r.endMs > r.startMs)
        .sort((a, b) => b.startMs - a.startMs);
      for (const r of ranges) cutRangeEverywhere(doc, r.startMs, r.endMs);
      return;
    }
    case 'timeline.trimStart': {
      const ms = Math.round(cmd.ms);
      const dur = getDocumentDurationMs(doc);
      if (ms <= 0) return;
      if (ms >= dur) throw new CommandError('INVALID_RANGE', 'Cannot trim the whole project', { ms, durationMs: dur });
      cutRangeEverywhere(doc, 0, ms);
      return;
    }
    case 'timeline.trimEnd': {
      const ms = Math.round(cmd.ms);
      const dur = getDocumentDurationMs(doc);
      if (ms <= 0) return;
      if (ms >= dur) throw new CommandError('INVALID_RANGE', 'Cannot trim the whole project', { ms, durationMs: dur });
      cutRangeEverywhere(doc, dur - ms, dur);
      return;
    }
    case 'timeline.setDuration': {
      const target = Math.round(cmd.targetMs);
      const dur = getDocumentDurationMs(doc);
      if (target <= 0) throw new CommandError('INVALID_VALUE', 'Target duration must be positive');
      if (target >= dur) return;
      if (cmd.strategy === 'trim-end') cutRangeEverywhere(doc, target, dur);
      else if (cmd.strategy === 'trim-start') cutRangeEverywhere(doc, 0, dur - target);
      else {
        const factor = dur / target;
        for (const track of doc.tracks) {
          for (const clip of track.clips) {
            clip.startMs = Math.round(clip.startMs / factor);
            if (clip.freeze) clip.durationMs = Math.max(1, Math.round(clip.durationMs / factor));
            else {
              clip.speed = clip.speed * factor;
              clip.durationMs = naturalDurationMs(clip);
            }
          }
        }
        for (const sub of doc.subtitles) {
          sub.cues = sub.cues.map((c) => ({ ...c, startMs: Math.round(c.startMs / factor), endMs: Math.max(Math.round(c.startMs / factor) + 1, Math.round(c.endMs / factor)) }));
        }
        doc.markers = doc.markers.map((m) => ({ ...m, tMs: Math.round(m.tMs / factor) }));
        for (const mask of doc.masks) {
          mask.startMs = Math.round(mask.startMs / factor);
          mask.endMs = Math.round(mask.endMs / factor);
          mask.keyframes = mask.keyframes.map((k) => ({ ...k, tMs: Math.round(k.tMs / factor) }));
        }
      }
      return;
    }
    case 'batch': {
      for (const sub of cmd.commands) mutate(doc, sub);
      return;
    }
    default: {
      const never: never = cmd;
      throw new CommandError('INVALID_VALUE', `Unknown command ${(never as { type: string }).type}`);
    }
  }
}

/** Applies a command immutably and returns the new document with forward/inverse patches. */
export function applyCommand(doc: ProjectDocument, cmd: Command, now = new Date().toISOString()): CommandResult {
  const [next, patches, inversePatches] = produceWithPatches(doc, (draft) => {
    mutate(draft, cmd);
    draft.updatedAt = now;
  });
  const changed = patches.some((p) => !(p.path.length === 1 && p.path[0] === 'updatedAt'));
  return { doc: changed ? next : doc, patches: changed ? patches : [], inversePatches: changed ? inversePatches : [], changed, label: commandLabel(cmd) };
}

export function applyDocumentPatches(doc: ProjectDocument, patches: Patch[]): ProjectDocument {
  return applyPatches(doc, patches);
}

export type { Patch };
export { sortClips };
