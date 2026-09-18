import type { ExportSettings, VideoCodecId } from '@sevenvid/core';
import { testEncoder, type FfmpegLocation } from '../ffmpeg/locator';

export interface EncoderChoice {
  videoEncoder: string;
  videoArgs: string[];
  audioEncoder: string;
  audioArgs: string[];
  hardware: boolean;
}

const HW_BY_CODEC: Record<VideoCodecId, string[]> = {
  h264: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox', 'h264_vaapi'],
  h265: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_videotoolbox', 'hevc_vaapi'],
  av1: ['av1_nvenc', 'av1_qsv', 'av1_amf', 'av1_vaapi'],
  vp9: [],
};

const SW_BY_CODEC: Record<VideoCodecId, string[]> = {
  h264: ['libx264'],
  h265: ['libx265'],
  av1: ['libsvtav1', 'libaom-av1'],
  vp9: ['libvpx-vp9'],
};

/** Cache of real test-encode results per encoder name (populated lazily). */
export class EncoderProbe {
  private readonly verified = new Map<string, { ok: boolean; error: string | null; ms: number }>();
  constructor(private readonly ffmpeg: FfmpegLocation) {}

  results(): Record<string, { ok: boolean; error: string | null; ms: number }> {
    return Object.fromEntries(this.verified);
  }

  verify(encoder: string): { ok: boolean; error: string | null; ms: number } {
    const cached = this.verified.get(encoder);
    if (cached) return cached;
    if (!this.ffmpeg.ffmpeg || !this.ffmpeg.encoders.includes(encoder)) {
      const r = { ok: false, error: 'not in FFmpeg build', ms: 0 };
      this.verified.set(encoder, r);
      return r;
    }
    const r = testEncoder(this.ffmpeg.ffmpeg, encoder);
    this.verified.set(encoder, r);
    return r;
  }

  verifyAllHardware(): Record<string, { ok: boolean; error: string | null; ms: number }> {
    for (const e of this.ffmpeg.hwEncoders) this.verify(e);
    return this.results();
  }
}

function qualityArgs(encoder: string, s: ExportSettings): string[] {
  const speed = s.speedPreset;
  if (s.qualityMode === 'bitrate') {
    const kb = Math.max(200, s.videoBitrateKbps);
    const common = ['-b:v', `${kb}k`, '-maxrate', `${Math.round(kb * 1.5)}k`, '-bufsize', `${kb * 2}k`];
    if (encoder === 'libx264' || encoder === 'libx265') return [...common, '-preset', speed];
    if (encoder === 'libsvtav1') return [...common, '-preset', '8'];
    if (encoder === 'libvpx-vp9') return [...common, '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1'];
    if (encoder.endsWith('_nvenc')) return [...common, '-preset', 'p4', '-rc', 'vbr'];
    return common;
  }
  const crf = Math.max(0, Math.min(51, s.crf));
  if (encoder === 'libx264') return ['-crf', String(crf), '-preset', speed, '-profile:v', 'high'];
  if (encoder === 'libx265') return ['-crf', String(crf), '-preset', speed, '-tag:v', 'hvc1'];
  if (encoder === 'libsvtav1') return ['-crf', String(Math.min(63, crf + 8)), '-preset', '8'];
  if (encoder === 'libaom-av1') return ['-crf', String(Math.min(63, crf + 8)), '-b:v', '0', '-cpu-used', '6', '-row-mt', '1'];
  if (encoder === 'libvpx-vp9') return ['-crf', String(Math.min(63, crf + 10)), '-b:v', '0', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1'];
  if (encoder.endsWith('_nvenc')) return ['-rc', 'vbr', '-cq', String(crf), '-preset', 'p4', '-b:v', '0'];
  if (encoder.endsWith('_qsv')) return ['-global_quality', String(crf), '-look_ahead', '0'];
  if (encoder.endsWith('_amf')) return ['-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf)];
  if (encoder.endsWith('_videotoolbox')) return ['-q:v', String(Math.round(100 - crf * 1.6))];
  if (encoder.endsWith('_vaapi')) return ['-qp', String(crf)];
  return ['-crf', String(crf)];
}

/** Picks an encoder that exists and (for hardware) has passed a real test encode, with software fallback. */
export function chooseEncoders(ffmpeg: FfmpegLocation, probe: EncoderProbe, s: ExportSettings, preferHardware: boolean): EncoderChoice {
  const candidates: Array<{ name: string; hardware: boolean }> = [];
  if (preferHardware && s.hardwareAcceleration === 'auto') for (const hw of HW_BY_CODEC[s.videoCodec]) if (ffmpeg.encoders.includes(hw)) candidates.push({ name: hw, hardware: true });
  for (const sw of SW_BY_CODEC[s.videoCodec]) if (ffmpeg.encoders.includes(sw)) candidates.push({ name: sw, hardware: false });
  let chosen: { name: string; hardware: boolean } | null = null;
  for (const c of candidates) {
    if (c.hardware) {
      if (probe.verify(c.name).ok) {
        chosen = c;
        break;
      }
      continue;
    }
    chosen = c;
    break;
  }
  if (!chosen) throw new Error(`No encoder available for ${s.videoCodec} in this FFmpeg build`);
  const audioEncoder = s.audioCodec === 'opus' ? 'libopus' : s.audioCodec === 'mp3' ? 'libmp3lame' : 'aac';
  const audioArgs = ['-b:a', `${s.audioBitrateKbps}k`, '-ar', '48000'];
  const videoArgs = [...qualityArgs(chosen.name, s), '-pix_fmt', chosen.name.endsWith('_vaapi') ? 'vaapi' : 'yuv420p'];
  return { videoEncoder: chosen.name, videoArgs, audioEncoder, audioArgs, hardware: chosen.hardware };
}
