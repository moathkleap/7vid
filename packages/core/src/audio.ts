import type { Effect, EffectType } from './document/types';

export type AudioPresetId = 'clean-voice' | 'denoise' | 'normalize' | 'podcast' | 'bright' | 'warm';

export interface AudioPreset {
  id: AudioPresetId;
  nameKey: string;
  descriptionKey: string;
  effects: Array<{ type: EffectType; params: Record<string, number | string | boolean> }>;
}

/** Audio enhancement chains rendered by FFmpeg (see the render graph compiler for the exact filters). */
export const AUDIO_PRESETS: Record<AudioPresetId, AudioPreset> = {
  'clean-voice': {
    id: 'clean-voice',
    nameKey: 'presets.audio.cleanVoice',
    descriptionKey: 'presets.audio.cleanVoiceDesc',
    effects: [
      { type: 'audio-denoise', params: { noiseFloorDb: -30, reductionDb: 12 } },
      { type: 'audio-voice', params: { expansion: 6.25 } },
      { type: 'audio-compressor', params: { thresholdDb: -18, ratio: 3, attackMs: 20, releaseMs: 250, makeupDb: 2 } },
    ],
  },
  denoise: { id: 'denoise', nameKey: 'presets.audio.denoise', descriptionKey: 'presets.audio.denoiseDesc', effects: [{ type: 'audio-denoise', params: { noiseFloorDb: -30, reductionDb: 14 } }] },
  normalize: { id: 'normalize', nameKey: 'presets.audio.normalize', descriptionKey: 'presets.audio.normalizeDesc', effects: [{ type: 'audio-normalize', params: { targetLufs: -16 } }] },
  podcast: {
    id: 'podcast',
    nameKey: 'presets.audio.podcast',
    descriptionKey: 'presets.audio.podcastDesc',
    effects: [
      { type: 'audio-denoise', params: { noiseFloorDb: -28, reductionDb: 10 } },
      { type: 'audio-eq', params: { low: -2, mid: 1.5, high: 2 } },
      { type: 'audio-compressor', params: { thresholdDb: -20, ratio: 4, attackMs: 10, releaseMs: 200, makeupDb: 3 } },
      { type: 'audio-normalize', params: { targetLufs: -16 } },
    ],
  },
  bright: { id: 'bright', nameKey: 'presets.audio.bright', descriptionKey: 'presets.audio.brightDesc', effects: [{ type: 'audio-eq', params: { low: 0, mid: 0, high: 3 } }] },
  warm: { id: 'warm', nameKey: 'presets.audio.warm', descriptionKey: 'presets.audio.warmDesc', effects: [{ type: 'audio-eq', params: { low: 3, mid: 0, high: -1 } }] },
};

export const AUDIO_EFFECT_TYPES: EffectType[] = ['audio-normalize', 'audio-denoise', 'audio-voice', 'audio-eq', 'audio-compressor', 'audio-duck'];

export function isAudioEffect(e: Effect): boolean {
  return AUDIO_EFFECT_TYPES.includes(e.type);
}
