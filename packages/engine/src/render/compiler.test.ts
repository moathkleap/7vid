import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCommand, createAssetRef, createClip, createDocument, createSubtitleTrack, getDocumentDurationMs, newId, type AssetRef, type ProjectDocument } from '@sevenvid/core';
import { validateRenderedFile } from '../export/validate';
import { locateFfmpeg } from '../ffmpeg/locator';
import { runFfmpeg } from '../ffmpeg/runner';
import { probeMedia } from '../media/probe';
import { resolveAppPaths } from '../paths/AppPaths';
import { toAss, toSrt, toVtt, parseSubtitles } from '../subtitles/writers';
import { cleanup, tempDir } from '../test/helpers';
import { buildFfmpegArgs, compileRenderGraph } from './RenderGraphCompiler';

const fixtures = path.resolve(__dirname, '../../../../tests/fixtures/generated');
const ff = locateFfmpeg(resolveAppPaths({ userData: tempDir(), resources: '/nonexistent' }));
const has = ff.ffmpeg && ff.ffprobe && fs.existsSync(path.join(fixtures, 'clip-10s-720p.mp4'));

async function ref(file: string): Promise<AssetRef> {
  const info = await probeMedia(ff.ffprobe!, path.join(fixtures, file));
  return createAssetRef({ id: `ast_${file.replace(/\W/g, '_')}`, kind: info.kind, name: file, sourcePath: info.path, durationMs: info.durationMs, width: info.video?.width ?? null, height: info.video?.height ?? null, fps: info.video?.fps ?? null, hasVideo: info.kind !== 'audio', hasAudio: Boolean(info.audio) });
}

async function renderDoc(doc: ProjectDocument, dir: string, name: string, extra: Partial<Parameters<typeof compileRenderGraph>[0]> = {}) {
  const target = { width: doc.settings.width, height: doc.settings.height, fps: doc.settings.fps, sampleRate: 48000, channels: 2 };
  const graph = compileRenderGraph({ doc, target, ...extra });
  const script = path.join(dir, `${name}.filter.txt`);
  fs.writeFileSync(script, graph.filterScript);
  const out = path.join(dir, `${name}.mp4`);
  const args = buildFfmpegArgs(graph, script, { videoEncoder: 'libx264', videoArgs: ['-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p'], audioEncoder: 'aac', audioArgs: ['-b:a', '96k'], container: 'mp4', fps: target.fps }, out);
  await runFfmpeg({ ffmpeg: ff.ffmpeg!, args, operation: `test:${name}` });
  const validation = await validateRenderedFile(ff.ffmpeg!, ff.ffprobe!, out, { durationMs: graph.durationMs, width: target.width, height: target.height, fps: target.fps });
  return { graph, out, validation };
}

describe.skipIf(!has)('render graph compiler', () => {
  it('renders trims, gaps, multiple tracks, images, speed, reverse, freeze and audio into a valid file', async () => {
    const dir = tempDir();
    const clip10 = await ref('clip-10s-720p.mp4');
    const clip4 = await ref('clip-4s-vp9.webm');
    const image = await ref('image.png');
    const tone = await ref('tone-3s.wav');
    let doc = createDocument({ name: 'compiler', settings: { width: 640, height: 360, fps: { num: 30, den: 1 } } });
    const v1 = doc.tracks.find((t) => t.kind === 'video')!;
    const fx = doc.tracks.find((t) => t.kind === 'overlay')!;
    const a1 = doc.tracks.find((t) => t.kind === 'audio')!;
    for (const a of [clip10, clip4, image, tone]) doc = applyCommand(doc, { type: 'asset.add', asset: a }).doc;
    // V1: 0-2s trimmed from clip10 (source 1s-3s), gap, 3-5s clip4 at 2x speed (source 0-4s), 5-6s freeze frame, 6-7s reversed clip4
    doc = applyCommand(doc, { type: 'clip.insert', clip: createClip({ trackId: v1.id, asset: clip10, startMs: 0, sourceInMs: 1000, sourceOutMs: 3000, id: 'c1' }), mode: 'overwrite' }).doc;
    const fast = createClip({ trackId: v1.id, asset: clip4, startMs: 3000, sourceInMs: 0, sourceOutMs: 4000, id: 'c2' });
    doc = applyCommand(doc, { type: 'clip.insert', clip: fast, mode: 'overwrite' }).doc;
    doc = applyCommand(doc, { type: 'clip.setSpeed', clipId: 'c2', speed: 2, ripple: false }).doc;
    const frozen = createClip({ trackId: v1.id, asset: clip10, startMs: 5000, sourceInMs: 4000, sourceOutMs: 4100, id: 'c3' });
    doc = applyCommand(doc, { type: 'clip.insert', clip: frozen, mode: 'overwrite' }).doc;
    doc = applyCommand(doc, { type: 'clip.setFreeze', clipId: 'c3', freeze: { atSourceMs: 4000 }, durationMs: 1000 }).doc;
    const rev = createClip({ trackId: v1.id, asset: clip4, startMs: 6000, sourceInMs: 1000, sourceOutMs: 2000, id: 'c4' });
    doc = applyCommand(doc, { type: 'clip.insert', clip: rev, mode: 'overwrite' }).doc;
    doc = applyCommand(doc, { type: 'clip.setReverse', clipId: 'c4', reverse: true }).doc;
    // FX: image overlay 1-4s scaled to half, top-left offset
    const img = createClip({ trackId: fx.id, asset: image, startMs: 1000, imageDurationMs: 3000, id: 'c5' });
    doc = applyCommand(doc, { type: 'clip.insert', clip: img, mode: 'overwrite' }).doc;
    doc = applyCommand(doc, { type: 'clip.setTransform', clipId: 'c5', transform: { scale: 0.5, offsetX: -0.2, offsetY: -0.2, opacity: 0.8 } }).doc;
    // A1: tone at 2s with fades and gain
    const t = createClip({ trackId: a1.id, asset: tone, startMs: 2000, id: 'c6' });
    doc = applyCommand(doc, { type: 'clip.insert', clip: t, mode: 'overwrite' }).doc;
    doc = applyCommand(doc, { type: 'clip.setAudio', clipId: 'c6', audio: { gainDb: -6, fadeInMs: 300, fadeOutMs: 300 } }).doc;
    doc = applyCommand(doc, { type: 'effect.add', clipId: 'c1', effect: { id: newId('fx'), type: 'color', enabled: true, params: { brightness: 0.05, contrast: 1.1, saturation: 1.2, temperature: 5500 } } }).doc;
    expect(getDocumentDurationMs(doc)).toBe(7000);
    const { graph, validation } = await renderDoc(doc, dir, 'full');
    expect(graph.clipCount).toBe(5);
    expect(validation.ok, JSON.stringify(validation.checks)).toBe(true);
    expect(validation.durationMs).toBeGreaterThan(6800);
    cleanup(dir);
  }, 120_000);

  it('renders a range, a cut timeline and burned-in Arabic subtitles', async () => {
    const dir = tempDir();
    const clip10 = await ref('clip-10s-720p.mp4');
    let doc = createDocument({ name: 'range', settings: { width: 320, height: 180, fps: { num: 25, den: 1 } } });
    const v1 = doc.tracks.find((t) => t.kind === 'video')!;
    doc = applyCommand(doc, { type: 'asset.add', asset: clip10 }).doc;
    doc = applyCommand(doc, { type: 'clip.insert', clip: createClip({ trackId: v1.id, asset: clip10, startMs: 0, id: 'c1' }), mode: 'overwrite' }).doc;
    doc = applyCommand(doc, { type: 'timeline.cutRange', startMs: 2000, endMs: 6000 }).doc;
    expect(getDocumentDurationMs(doc)).toBe(6000);
    const sub = createSubtitleTrack({ language: 'ar', id: 'sub1' });
    sub.burnIn = true;
    doc = applyCommand(doc, { type: 'subtitle.addTrack', track: sub }).doc;
    doc = applyCommand(doc, { type: 'subtitle.setCues', trackId: 'sub1', cues: [{ id: 'q1', startMs: 500, endMs: 2500, text: 'مرحباً بكم في 7vid', speaker: null }, { id: 'q2', startMs: 3000, endMs: 5500, text: 'Hello world', speaker: null }] }).doc;
    const ass = path.join(dir, 'subs.ass');
    fs.writeFileSync(ass, toAss(doc.subtitles[0]!, doc.settings));
    const full = await renderDoc(doc, dir, 'cut', { subtitlesAssPath: ass });
    expect(full.validation.ok, JSON.stringify(full.validation.checks)).toBe(true);
    const part = await renderDoc(doc, dir, 'range', { range: { startMs: 1000, endMs: 3500 } });
    expect(part.graph.durationMs).toBe(2500);
    expect(part.validation.ok, JSON.stringify(part.validation.checks)).toBe(true);
    cleanup(dir);
  }, 120_000);

  it('writes and parses subtitle formats', () => {
    const cues = [{ id: 'a', startMs: 1000, endMs: 2500, text: 'أهلاً', speaker: null }, { id: 'b', startMs: 3000, endMs: 4000, text: 'Hi\nthere', speaker: 'Sam' }];
    const srt = toSrt(cues);
    expect(srt).toContain('00:00:01,000 --> 00:00:02,500');
    expect(parseSubtitles(srt, () => newId()).map((c) => [c.startMs, c.endMs])).toEqual([[1000, 2500], [3000, 4000]]);
    const vtt = toVtt(cues);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(parseSubtitles(vtt, () => newId())).toHaveLength(2);
    const track = createSubtitleTrack({ language: 'ar' });
    track.cues = cues;
    const ass = toAss(track, { width: 1920, height: 1080 });
    expect(ass).toContain('Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,أهلاً');
    expect(ass).toContain('Hi\\Nthere');
  });

  it('refuses to compile an empty timeline', () => {
    const doc = createDocument({ name: 'empty' });
    expect(() => compileRenderGraph({ doc, target: { width: 640, height: 360, fps: { num: 30, den: 1 }, sampleRate: 48000, channels: 2 } })).toThrowError(/empty/);
  });
});
