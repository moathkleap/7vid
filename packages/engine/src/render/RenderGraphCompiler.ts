import { clipEndMs, fpsToNumber, getDocumentDurationMs, isAudioEffect, type Clip, type Effect, type Fraction, type ProjectDocument, type Track } from '@sevenvid/core';
import { AppError } from '../errors';
import { escapeFilterPath } from './filterUtils';
import { compileMaskStage } from './masks';

export { escapeFilterPath };

export interface RenderTarget {
  width: number;
  height: number;
  fps: Fraction;
  sampleRate: number;
  channels: number;
}

/** Filters that scale/pad the composited video to a different output size (appended before subtitles). */
export function outputSizeFilters(width: number, height: number): string[] {
  return [`scale=${width}:${height}:force_original_aspect_ratio=decrease`, `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`];
}

export interface CompileOptions {
  doc: ProjectDocument;
  target: RenderTarget;
  /** Render only this timeline range (ms). */
  range?: { startMs: number; endMs: number } | null;
  /** Map asset ids to alternative files (proxies for preview renders). */
  pathOverrides?: Record<string, string>;
  /** Pre-generated ASS file to burn in. */
  subtitlesAssPath?: string | null;
  fontsDir?: string | null;
  /** Extra per-clip video filters (phase 3 masks etc.) appended after transforms. */
  clipVideoFilters?: Record<string, string[]>;
  /** Extra filters applied on the composited video before subtitles. */
  finalVideoFilters?: string[];
  /** Extra filters applied to the mixed audio. */
  finalAudioFilters?: string[];
  /** Render the document's mask tracks (blur/pixelate/box) on the composite; needs a scratch dir for command files. */
  masks?: { scratchDir: string } | null;
  /** Bypass switches used by before/after comparisons. */
  bypass?: { videoEffects?: boolean; audioEffects?: boolean; masks?: boolean };
  /** Only build the audio graph (silence detection, loudness, transcription). */
  audioOnly?: boolean;
  /** Only build the video graph (single-frame renders); no audio output label is produced. */
  videoOnly?: boolean;
}

export interface InputSpec {
  path: string;
  args: string[];
}

export interface CompiledGraph {
  inputs: InputSpec[];
  filterScript: string;
  /** Null for audio-only graphs. */
  videoLabel: string | null;
  /** Null for video-only graphs. */
  audioLabel: string | null;
  durationMs: number;
  warnings: string[];
  clipCount: number;
  /** Number of mask tracks rendered by this graph. */
  masksApplied: number;
  /** Temporary files referenced by the graph (delete after the render). */
  tempFiles: string[];
}

const sec = (ms: number) => (ms / 1000).toFixed(3);

function db(gain: number): string {
  return `${gain.toFixed(2)}dB`;
}

function atempoChain(speed: number): string[] {
  const parts: string[] = [];
  let s = speed;
  while (s > 2) {
    parts.push('atempo=2');
    s /= 2;
  }
  while (s < 0.5) {
    parts.push('atempo=0.5');
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-6) parts.push(`atempo=${s.toFixed(4)}`);
  return parts;
}

function transformFilters(clip: Clip, target: RenderTarget, layer: 'base' | 'overlay'): string[] {
  const t = clip.transform;
  const f: string[] = [];
  const cropW = 1 - t.cropLeft - t.cropRight;
  const cropH = 1 - t.cropTop - t.cropBottom;
  if (cropW < 0.999 || cropH < 0.999) f.push(`crop=iw*${cropW.toFixed(4)}:ih*${cropH.toFixed(4)}:iw*${t.cropLeft.toFixed(4)}:ih*${t.cropTop.toFixed(4)}`);
  const rot = ((Math.round(t.rotate) % 360) + 360) % 360;
  if (rot === 90) f.push('transpose=1');
  else if (rot === 180) f.push('hflip', 'vflip');
  else if (rot === 270) f.push('transpose=2');
  else if (rot !== 0) f.push(`rotate=${((rot * Math.PI) / 180).toFixed(5)}:c=black@0:ow=rotw(${((rot * Math.PI) / 180).toFixed(5)}):oh=roth(${((rot * Math.PI) / 180).toFixed(5)})`);
  if (t.flipH) f.push('hflip');
  if (t.flipV) f.push('vflip');
  const W = target.width;
  const H = target.height;
  const scale = Math.max(0.01, t.scale);
  const sw = Math.round(W * scale);
  const sh = Math.round(H * scale);
  const padColor = layer === 'base' ? 'black' : 'black@0';
  const fmt = layer === 'base' ? 'yuv420p' : 'yuva420p';
  f.push(`format=${fmt}`);
  switch (t.fit) {
    case 'cover':
      f.push(`scale=${sw}:${sh}:force_original_aspect_ratio=increase`, `crop=${sw}:${sh}`);
      break;
    case 'stretch':
      f.push(`scale=${sw}:${sh}`);
      break;
    case 'blur-fill':
      f.push(`split[bg][fg]`);
      break;
    case 'contain':
    default:
      f.push(`scale=${sw}:${sh}:force_original_aspect_ratio=decrease`, `pad=${sw}:${sh}:(ow-iw)/2:(oh-ih)/2:color=${padColor}`);
      break;
  }
  return f;
}

function colorFilters(effects: Effect[]): string[] {
  const f: string[] = [];
  for (const e of effects) {
    if (!e.enabled) continue;
    const p = e.params;
    switch (e.type) {
      case 'color': {
        const brightness = Number(p.brightness ?? 0);
        const contrast = Number(p.contrast ?? 1);
        const saturation = Number(p.saturation ?? 1);
        const gamma = Number(p.gamma ?? 1);
        const exposure = Number(p.exposure ?? 0);
        const temperature = Number(p.temperature ?? 6500);
        const highlights = Number(p.highlights ?? 0);
        const shadows = Number(p.shadows ?? 0);
        const tint = Number(p.tint ?? 0);
        if (brightness || contrast !== 1 || saturation !== 1 || gamma !== 1) f.push(`eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}:gamma=${gamma.toFixed(3)}`);
        if (exposure) f.push(`exposure=exposure=${exposure.toFixed(3)}`);
        if (Math.abs(temperature - 6500) > 1) f.push(`colortemperature=temperature=${Math.round(temperature)}`);
        if (highlights || shadows) f.push(`curves=m='0/0 0.25/${(0.25 + shadows * 0.15).toFixed(3)} 0.75/${(0.75 + highlights * 0.15).toFixed(3)} 1/1'`);
        if (tint) f.push(`colorbalance=gm=${(-tint).toFixed(3)}:gs=${(-tint * 0.5).toFixed(3)}`);
        break;
      }
      case 'sharpen': {
        const amount = Number(p.amount ?? 0.6);
        if (amount > 0) f.push(`unsharp=5:5:${amount.toFixed(2)}:5:5:0`);
        break;
      }
      case 'denoise': {
        const strength = Number(p.strength ?? 3);
        f.push(`hqdn3d=${strength.toFixed(1)}:${(strength * 0.75).toFixed(1)}:${(strength * 1.5).toFixed(1)}:${(strength * 1.1).toFixed(1)}`);
        break;
      }
      case 'stabilize': {
        f.push(`deshake=rx=${Number(p.rx ?? 32)}:ry=${Number(p.ry ?? 32)}:edge=mirror`);
        break;
      }
      default:
        break;
    }
  }
  return f;
}

function audioEffectFilters(effects: Effect[]): string[] {
  const f: string[] = [];
  for (const e of effects) {
    if (!e.enabled) continue;
    const p = e.params;
    switch (e.type) {
      case 'audio-denoise':
        f.push(`afftdn=nf=${Number(p.noiseFloorDb ?? -25)}:nr=${Number(p.reductionDb ?? 12)}`);
        break;
      case 'audio-voice':
        f.push('highpass=f=80', 'lowpass=f=12000', `speechnorm=e=${Number(p.expansion ?? 6.25)}:r=0.0001:l=1`);
        break;
      case 'audio-normalize':
        f.push(`loudnorm=I=${Number(p.targetLufs ?? -16)}:TP=-1.5:LRA=11`);
        break;
      case 'audio-eq':
        for (const band of [['low', 100], ['mid', 1000], ['high', 8000]] as const) {
          const g = Number(p[band[0]] ?? 0);
          if (g) f.push(`equalizer=f=${band[1]}:t=q:w=1:g=${g.toFixed(1)}`);
        }
        break;
      case 'audio-compressor':
        f.push(`acompressor=threshold=${Number(p.thresholdDb ?? -18)}dB:ratio=${Number(p.ratio ?? 3)}:attack=${Number(p.attackMs ?? 20)}:release=${Number(p.releaseMs ?? 250)}:makeup=${Number(p.makeupDb ?? 2)}dB`);
        break;
      default:
        break;
    }
  }
  return f;
}

/**
 * Compiles a project document into an FFmpeg filtergraph. Every video clip becomes an overlay on a black base
 * enabled for its timeline range; audio clips are delayed and mixed. Gaps, multiple tracks, speed, reverse,
 * freeze frames, transforms, color and audio effects, fades and burned-in subtitles are all expressed here.
 */
export function compileRenderGraph(opts: CompileOptions): CompiledGraph {
  const { doc, target } = opts;
  const warnings: string[] = [];
  const fps = fpsToNumber(target.fps);
  const fullDuration = getDocumentDurationMs(doc);
  const range = opts.range ?? { startMs: 0, endMs: fullDuration };
  const durationMs = Math.max(1, range.endMs - range.startMs);
  if (fullDuration <= 0) throw new AppError({ code: 'VALIDATION_FAILED', operation: 'render.compile', message: 'The timeline is empty; nothing to render' });
  const inputs: InputSpec[] = [];
  const lines: string[] = [];
  const soloed = doc.tracks.some((t) => t.solo);
  const audible = (t: Track) => !t.muted && (!soloed || t.solo);
  const bypass = opts.bypass ?? {};
  const videoEffectsOf = (clip: Clip): Effect[] => (bypass.videoEffects ? [] : clip.effects);
  const audioEffectsOf = (clip: Clip): Effect[] => (bypass.audioEffects ? clip.effects.filter((e) => !isAudioEffect(e)) : clip.effects);

  if (!opts.audioOnly) lines.push(`color=c=black:s=${target.width}x${target.height}:r=${target.fps.num}/${target.fps.den}:d=${sec(durationMs)},format=yuv420p[base0]`);
  let baseLabel = 'base0';
  let layer = 0;
  let clipCount = 0;
  const audioLabels: string[] = [];

  const visualTracks = opts.audioOnly ? [] : [...doc.tracks.filter((t) => t.kind === 'video'), ...doc.tracks.filter((t) => t.kind === 'overlay')];
  for (const track of visualTracks) {
    if (track.muted && track.kind !== 'audio' && !audible(track)) continue;
    for (const clip of [...track.clips].sort((a, b) => a.startMs - b.startMs)) {
      const asset = doc.assets[clip.assetId];
      if (!asset) throw new AppError({ code: 'ASSET_NOT_FOUND', operation: 'render.compile', message: `Clip ${clip.name} references missing asset ${clip.assetId}` });
      if (asset.missing) throw new AppError({ code: 'FILE_NOT_FOUND', operation: 'render.compile', message: `Media file for ${asset.name} is missing`, details: { assetId: asset.id, path: asset.sourcePath } });
      if (!asset.hasVideo) continue;
      const start = clip.startMs - range.startMs;
      const end = clipEndMs(clip) - range.startMs;
      if (end <= 0 || start >= durationMs) continue;
      const file = opts.pathOverrides?.[asset.id] ?? asset.sourcePath;
      const idx = inputs.length;
      const sourceSpan = clip.sourceOutMs - clip.sourceInMs;
      const vf: string[] = [];
      if (asset.kind === 'image') {
        inputs.push({ path: file, args: ['-loop', '1', '-framerate', String(Math.max(1, Math.round(fps))), '-t', sec(clip.durationMs + 100)] });
        vf.push(`trim=duration=${sec(clip.durationMs)}`, 'setpts=PTS-STARTPTS');
      } else if (clip.freeze) {
        inputs.push({ path: file, args: ['-ss', sec(clip.freeze.atSourceMs), '-t', '0.5'] });
        vf.push('trim=end_frame=1', 'setpts=PTS-STARTPTS', 'loop=loop=-1:size=1:start=0', `trim=duration=${sec(clip.durationMs)}`, 'setpts=PTS-STARTPTS');
      } else {
        inputs.push({ path: file, args: ['-ss', sec(clip.sourceInMs), '-t', sec(sourceSpan + 40)] });
        vf.push(`trim=duration=${sec(sourceSpan)}`, 'setpts=PTS-STARTPTS');
        if (clip.reverse) {
          vf.push('reverse');
          if (sourceSpan > 30_000) warnings.push(`Reversing ${clip.name} loads ${Math.round(sourceSpan / 1000)} s of frames into memory`);
        }
        if (Math.abs(clip.speed - 1) > 1e-6) vf.push(`setpts=PTS/${clip.speed.toFixed(6)}`);
      }
      vf.push(`fps=${target.fps.num}/${target.fps.den}`);
      const layerKind = layer === 0 && track.kind === 'video' && clip.transform.fit !== 'blur-fill' ? 'base' : 'overlay';
      const tf = transformFilters(clip, target, layerKind);
      const blurFill = clip.transform.fit === 'blur-fill';
      if (blurFill) {
        const idxSplit = tf.indexOf('split[bg][fg]');
        const before = tf.slice(0, idxSplit);
        const W = target.width;
        const H = target.height;
        lines.push(`[${idx}:v]${[...vf, ...before, 'split'].join(',')}[bg${idx}][fg${idx}]`);
        lines.push(`[bg${idx}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2,format=yuv420p[bgb${idx}]`);
        lines.push(`[fg${idx}]scale=${W}:${H}:force_original_aspect_ratio=decrease,format=yuva420p[fgs${idx}]`);
        lines.push(`[bgb${idx}][fgs${idx}]overlay=(W-w)/2:(H-h)/2:format=auto,format=yuva420p[clip${idx}]`);
      } else {
        const extra = [...colorFilters(videoEffectsOf(clip)), ...(opts.clipVideoFilters?.[clip.id] ?? [])];
        const opacity = clip.transform.opacity;
        if (opacity < 0.999) extra.push('format=yuva420p', `colorchannelmixer=aa=${opacity.toFixed(3)}`);
        lines.push(`[${idx}:v]${[...vf, ...tf, ...extra].join(',')}[clip${idx}]`);
      }
      const x = `(W-w)/2+${Math.round(clip.transform.offsetX * target.width)}`;
      const y = `(H-h)/2+${Math.round(clip.transform.offsetY * target.height)}`;
      const shifted = `[clip${idx}]setpts=PTS+${sec(Math.max(0, start))}/TB[sh${idx}]`;
      lines.push(shifted);
      const next = `base${layer + 1}`;
      lines.push(`[${baseLabel}][sh${idx}]overlay=x=${x}:y=${y}:eof_action=pass:enable='between(t,${sec(Math.max(0, start))},${sec(Math.min(durationMs, end))})'[${next}]`);
      baseLabel = next;
      layer++;
      clipCount++;
    }
  }

  const audioTracks = opts.videoOnly ? [] : doc.tracks.filter((t) => t.kind === 'video' || t.kind === 'audio');
  for (const track of audioTracks) {
    if (!audible(track)) continue;
    for (const clip of track.clips) {
      const asset = doc.assets[clip.assetId];
      if (!asset || !asset.hasAudio || clip.audio.muted || clip.freeze) continue;
      const start = clip.startMs - range.startMs;
      const end = clipEndMs(clip) - range.startMs;
      if (end <= 0 || start >= durationMs) continue;
      const file = opts.pathOverrides?.[asset.id] ?? asset.sourcePath;
      const idx = inputs.length;
      const sourceSpan = clip.sourceOutMs - clip.sourceInMs;
      inputs.push({ path: file, args: ['-ss', sec(clip.sourceInMs), '-t', sec(sourceSpan + 40)] });
      const af: string[] = [`atrim=duration=${sec(sourceSpan)}`, 'asetpts=PTS-STARTPTS'];
      if (clip.reverse) af.push('areverse');
      if (Math.abs(clip.speed - 1) > 1e-6) af.push(...atempoChain(clip.speed));
      af.push(...audioEffectFilters(audioEffectsOf(clip)));
      const gain = clip.audio.gainDb + track.gainDb;
      if (Math.abs(gain) > 0.01) af.push(`volume=${db(gain)}`);
      if (clip.audio.fadeInMs > 0) af.push(`afade=t=in:st=0:d=${sec(clip.audio.fadeInMs)}`);
      if (clip.audio.fadeOutMs > 0) af.push(`afade=t=out:st=${sec(Math.max(0, clip.durationMs - clip.audio.fadeOutMs))}:d=${sec(clip.audio.fadeOutMs)}`);
      af.push(`aresample=${target.sampleRate}`, `aformat=sample_fmts=fltp:channel_layouts=${target.channels === 1 ? 'mono' : 'stereo'}`);
      if (start > 0) af.push(`adelay=${Math.round(start)}:all=1`);
      else if (start < 0) af.push(`atrim=start=${sec(-start)}`, 'asetpts=PTS-STARTPTS');
      lines.push(`[${idx}:a]${af.join(',')}[a${idx}]`);
      audioLabels.push(`[a${idx}]`);
    }
  }

  if (!opts.videoOnly) {
    if (audioLabels.length === 0) {
      lines.push(`anullsrc=r=${target.sampleRate}:cl=${target.channels === 1 ? 'mono' : 'stereo'},atrim=duration=${sec(durationMs)}[amix]`);
    } else if (audioLabels.length === 1) {
      lines.push(`${audioLabels[0]}anull[amix]`);
    } else {
      lines.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[amix]`);
    }
    const masterAf: string[] = [`atrim=duration=${sec(durationMs)}`, 'asetpts=PTS-STARTPTS'];
    if (Math.abs(doc.master.gainDb) > 0.01) masterAf.push(`volume=${db(doc.master.gainDb)}`);
    if (doc.master.normalize) masterAf.push(`loudnorm=I=${doc.master.targetLufs}:TP=-1.5:LRA=11`);
    masterAf.push(...(opts.finalAudioFilters ?? []));
    lines.push(`[amix]${masterAf.join(',')}[aout]`);
  }
  const audioLabel = opts.videoOnly ? null : '[aout]';

  if (opts.audioOnly) {
    return { inputs, filterScript: lines.join(';\n') + '\n', videoLabel: null, audioLabel, durationMs, warnings, clipCount, masksApplied: 0, tempFiles: [] };
  }

  let masksApplied = 0;
  const tempFiles: string[] = [];
  if (opts.masks && !bypass.masks && doc.masks.length > 0) {
    const stage = compileMaskStage({ masks: doc.masks, width: target.width, height: target.height, range, scratchDir: opts.masks.scratchDir, inputLabel: baseLabel });
    lines.push(...stage.lines);
    baseLabel = stage.outputLabel;
    masksApplied = stage.applied;
    tempFiles.push(...stage.files);
  }

  const finalVf: string[] = [`trim=duration=${sec(durationMs)}`, ...(opts.finalVideoFilters ?? [])];
  if (opts.subtitlesAssPath) {
    const fonts = opts.fontsDir ? `:fontsdir='${escapeFilterPath(opts.fontsDir)}'` : '';
    finalVf.push(`subtitles=filename='${escapeFilterPath(opts.subtitlesAssPath)}'${fonts}`);
  }
  finalVf.push('format=yuv420p');
  lines.push(`[${baseLabel}]${finalVf.join(',')}[vout]`);

  return { inputs, filterScript: lines.join(';\n') + '\n', videoLabel: '[vout]', audioLabel, durationMs, warnings, clipCount, masksApplied, tempFiles };
}

export interface EncodingOptions {
  videoEncoder: string;
  /** e.g. ['-crf','20','-preset','medium'] */
  videoArgs: string[];
  audioEncoder: string;
  audioArgs: string[];
  container: 'mp4' | 'mov' | 'webm';
  fps: Fraction;
  threads?: number;
}

/** Turns a compiled graph into the final FFmpeg argument list (filter graph passed via script file). */
export function buildFfmpegArgs(graph: CompiledGraph, filterScriptPath: string, enc: EncodingOptions, outputPath: string): string[] {
  const args: string[] = [];
  if (enc.threads && enc.threads > 0) args.push('-threads', String(enc.threads));
  for (const input of graph.inputs) args.push(...input.args, '-i', input.path);
  if (!graph.videoLabel || !graph.audioLabel) throw new AppError({ code: 'RENDER_FAILED', operation: 'render.args', message: 'buildFfmpegArgs needs a graph with both video and audio outputs' });
  args.push('-filter_complex_script', filterScriptPath, '-map', graph.videoLabel, '-map', graph.audioLabel);
  args.push('-r', `${enc.fps.num}/${enc.fps.den}`, '-c:v', enc.videoEncoder, ...enc.videoArgs, '-c:a', enc.audioEncoder, ...enc.audioArgs);
  if (enc.container === 'mp4' || enc.container === 'mov') args.push('-movflags', '+faststart');
  args.push('-t', sec(graph.durationMs), '-f', enc.container === 'mov' ? 'mov' : enc.container, outputPath);
  return args;
}

/** Argument list for an audio-only render to a PCM WAV file (analysis and previews). */
export function buildFfmpegAudioArgs(graph: CompiledGraph, filterScriptPath: string, outputPath: string, opts: { sampleRate?: number; channels?: number } = {}): string[] {
  const args: string[] = [];
  for (const input of graph.inputs) args.push(...input.args, '-i', input.path);
  if (!graph.audioLabel) throw new AppError({ code: 'RENDER_FAILED', operation: 'render.args', message: 'graph has no audio output' });
  args.push('-filter_complex_script', filterScriptPath, '-map', graph.audioLabel, '-vn', '-c:a', 'pcm_s16le');
  if (opts.sampleRate) args.push('-ar', String(opts.sampleRate));
  if (opts.channels) args.push('-ac', String(opts.channels));
  args.push('-t', sec(graph.durationMs), '-f', 'wav', outputPath);
  return args;
}
