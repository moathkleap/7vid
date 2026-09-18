import { newId } from '../ids';
import { FPS_30, type Fraction } from '../time';
import type {
  AssetRef,
  Clip,
  ClipAudio,
  MaskTrack,
  Marker,
  ProjectDocument,
  ProjectKind,
  SequenceSettings,
  SubtitleStyle,
  SubtitleTrack,
  Track,
  TrackKind,
  Transform,
} from './types';
import { DOCUMENT_SCHEMA_VERSION } from './types';

export function defaultTransform(): Transform {
  return {
    cropLeft: 0,
    cropTop: 0,
    cropRight: 0,
    cropBottom: 0,
    rotate: 0,
    flipH: false,
    flipV: false,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    fit: 'contain',
    opacity: 1,
  };
}

export function defaultClipAudio(): ClipAudio {
  return { gainDb: 0, muted: false, fadeInMs: 0, fadeOutMs: 0 };
}

export function defaultSubtitleStyle(): SubtitleStyle {
  return {
    fontFamily: 'Noto Naskh Arabic',
    fontSize: 42,
    color: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    backgroundColor: null,
    position: 'bottom',
    marginV: 48,
    bold: false,
  };
}

export function defaultSequenceSettings(overrides: Partial<SequenceSettings> = {}): SequenceSettings {
  return {
    width: 1920,
    height: 1080,
    fps: FPS_30,
    sampleRate: 48000,
    channels: 2,
    aspectPreset: '16:9',
    platformPreset: 'youtube',
    ...overrides,
  };
}

export function createTrack(kind: TrackKind, name: string, id = newId('trk')): Track {
  return { id, kind, name, muted: false, locked: false, solo: false, gainDb: 0, clips: [] };
}

export function createDocument(input: {
  name: string;
  kind?: ProjectKind;
  settings?: Partial<SequenceSettings>;
  id?: string;
  now?: string;
}): ProjectDocument {
  const now = input.now ?? new Date().toISOString();
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    id: input.id ?? newId('prj'),
    name: input.name,
    kind: input.kind ?? 'editor',
    createdAt: now,
    updatedAt: now,
    settings: defaultSequenceSettings(input.settings),
    assets: {},
    tracks: [
      createTrack('video', 'V1'),
      createTrack('audio', 'A1'),
      createTrack('overlay', 'FX1'),
    ],
    masks: [],
    subtitles: [],
    markers: [],
    master: { gainDb: 0, normalize: false, targetLufs: -14 },
    meta: { templateId: null, description: '', tags: [] },
  };
}

export interface CreateClipInput {
  trackId: string;
  asset: AssetRef;
  startMs: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  id?: string;
  linkedClipId?: string | null;
  /** Duration for still images. */
  imageDurationMs?: number;
}

export function createClip(input: CreateClipInput): Clip {
  const asset = input.asset;
  const sourceIn = Math.max(0, input.sourceInMs ?? 0);
  const assetDuration = asset.durationMs ?? input.imageDurationMs ?? 5000;
  const sourceOut = Math.min(
    asset.kind === 'image' ? sourceIn + (input.imageDurationMs ?? 5000) : assetDuration,
    input.sourceOutMs ?? Number.POSITIVE_INFINITY,
  );
  return {
    id: input.id ?? newId('clp'),
    trackId: input.trackId,
    assetId: asset.id,
    name: asset.name,
    startMs: Math.max(0, Math.round(input.startMs)),
    durationMs: Math.max(1, Math.round(sourceOut - sourceIn)),
    sourceInMs: Math.round(sourceIn),
    sourceOutMs: Math.round(sourceOut),
    speed: 1,
    reverse: false,
    freeze: null,
    transform: defaultTransform(),
    effects: [],
    audio: defaultClipAudio(),
    linkedClipId: input.linkedClipId ?? null,
    color: null,
  };
}

export function createSubtitleTrack(input: {
  language: string;
  name?: string;
  source?: SubtitleTrack['source'];
  id?: string;
}): SubtitleTrack {
  return {
    id: input.id ?? newId('sub'),
    name: input.name ?? `Subtitles (${input.language})`,
    language: input.language,
    cues: [],
    style: defaultSubtitleStyle(),
    enabled: true,
    burnIn: false,
    source: input.source ?? 'manual',
  };
}

export function createMaskTrack(input: {
  clipId: string;
  kind: MaskTrack['kind'];
  source: MaskTrack['source'];
  label: string;
  startMs: number;
  endMs: number;
  id?: string;
  shape?: MaskTrack['shape'];
  strength?: number;
}): MaskTrack {
  return {
    id: input.id ?? newId('msk'),
    clipId: input.clipId,
    kind: input.kind,
    shape: input.shape ?? (input.kind === 'box' ? 'rect' : 'ellipse'),
    strength: input.strength ?? (input.kind === 'pixelate' ? 16 : 24),
    feather: 0.01,
    color: '#000000',
    keyframes: [],
    keyframesFile: null,
    source: input.source,
    label: input.label,
    enabled: true,
    status: 'ok',
    startMs: input.startMs,
    endMs: input.endMs,
    lostRanges: [],
    verification: null,
  };
}

export function createMarker(tMs: number, label = '', color = '#7C5CFF'): Marker {
  return { id: newId('mrk'), tMs, label, color };
}

export function createAssetRef(input: Omit<AssetRef, 'missing' | 'proxyPath'> & Partial<Pick<AssetRef, 'missing' | 'proxyPath'>>): AssetRef {
  return { proxyPath: null, missing: false, ...input };
}

export function fpsEquals(a: Fraction, b: Fraction): boolean {
  return a.num * b.den === b.num * a.den;
}
