export const CAPABILITY_IDS = [
  'media.import',
  'media.proxy',
  'edit.basic',
  'render.export',
  'render.hwencode',
  'audio.enhance',
  'audio.vad',
  'stt',
  'tts',
  'translate',
  'planner.deterministic',
  'llm.text',
  'vision.faces',
  'vision.objects',
  'vision.tracking',
  'vision.segmentation',
  'vision.faceEmbedding',
  'ocr',
  'enhance.video',
  'stabilize',
  'interpolate',
  'upscale.lanczos',
  'upscale.ai',
  'gen.image',
  'gen.video',
  'gen.music',
  'python.runtime',
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export type CapabilityStatus =
  | 'available'
  | 'needs-model'
  | 'needs-provider'
  | 'needs-hardware'
  | 'needs-runtime'
  | 'unavailable';

export type CapabilityActionType = 'open-models' | 'open-settings' | 'setup-runtime' | 'open-providers' | 'none';

export interface CapabilityInfo {
  id: CapabilityId;
  status: CapabilityStatus;
  /** i18n key explaining the status (empty when available). */
  reasonKey: string;
  reasonParams: Record<string, string | number>;
  action: { type: CapabilityActionType; target: string | null };
  providerId: string | null;
  external: boolean;
  checkedAt: string;
}

export type CapabilityMap = Record<CapabilityId, CapabilityInfo>;

export function isCapabilityAvailable(map: CapabilityMap | null | undefined, id: CapabilityId): boolean {
  return map?.[id]?.status === 'available';
}
