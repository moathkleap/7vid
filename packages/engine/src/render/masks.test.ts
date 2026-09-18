import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCommand, createAssetRef, createClip, createDocument, createMaskTrack, type AssetRef, type MaskTrack, type ProjectDocument } from '@sevenvid/core';
import { validateRenderedFile } from '../export/validate';
import { locateFfmpeg } from '../ffmpeg/locator';
import { runFfmpeg } from '../ffmpeg/runner';
import { probeMedia } from '../media/probe';
import { resolveAppPaths } from '../paths/AppPaths';
import { cleanup, tempDir } from '../test/helpers';
import { blockMeanError, frameSharpness, grayFrame, laplacianVariance } from '../vision/frameStats';
import { maskWindowAt, pixelateBlockPx } from './masks';
import { buildFfmpegArgs, compileRenderGraph } from './RenderGraphCompiler';

const fixtures = path.resolve(__dirname, '../../../../tests/fixtures/generated');
const ff = locateFfmpeg(resolveAppPaths({ userData: tempDir(), resources: '/nonexistent' }));
const has = ff.ffmpeg && ff.ffprobe && fs.existsSync(path.join(fixtures, 'clip-10s-720p.mp4'));

async function ref(file: string): Promise<AssetRef> {
  const info = await probeMedia(ff.ffprobe!, path.join(fixtures, file));
  return createAssetRef({ id: `ast_${file.replace(/\W/g, '_')}`, kind: info.kind, name: file, sourcePath: info.path, durationMs: info.durationMs, width: info.video?.width ?? null, height: info.video?.height ?? null, fps: info.video?.fps ?? null, hasVideo: info.kind !== 'audio', hasAudio: Boolean(info.audio) });
}

async function renderFrame(doc: ProjectDocument, dir: string, tMs: number, opts: { masks: boolean }): Promise<string> {
  const target = { width: doc.settings.width, height: doc.settings.height, fps: doc.settings.fps, sampleRate: 48000, channels: 2 };
  const graph = compileRenderGraph({ doc, target, range: { startMs: tMs, endMs: tMs + 100 }, masks: opts.masks ? { scratchDir: dir } : null, videoOnly: true });
  const script = path.join(dir, `f-${tMs}-${opts.masks ? 'm' : 'b'}.txt`);
  fs.writeFileSync(script, graph.filterScript);
  const out = path.join(dir, `f-${tMs}-${opts.masks ? 'm' : 'b'}.png`);
  const args: string[] = [];
  for (const input of graph.inputs) args.push(...input.args, '-i', input.path);
  args.push('-filter_complex_script', script, '-map', graph.videoLabel!, '-frames:v', '1', '-update', '1', out);
  await runFfmpeg({ ffmpeg: ff.ffmpeg!, args, operation: 'test:frame' });
  return out;
}

const box = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
const inner = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
const outside = { x: 0.02, y: 0.02, w: 0.2, h: 0.2 };

async function docWithMask(kind: MaskTrack['kind'], shape: MaskTrack['shape'], keyframes: MaskTrack['keyframes']): Promise<ProjectDocument> {
  const clip10 = await ref('clip-10s-720p.mp4');
  let doc = createDocument({ name: `mask-${kind}`, settings: { width: 640, height: 360, fps: { num: 30, den: 1 } } });
  const v1 = doc.tracks.find((t) => t.kind === 'video')!;
  doc = applyCommand(doc, { type: 'asset.add', asset: clip10 }).doc;
  doc = applyCommand(doc, { type: 'clip.insert', clip: createClip({ trackId: v1.id, asset: clip10, startMs: 0, id: 'c1' }), mode: 'overwrite' }).doc;
  const mask = createMaskTrack({ clipId: 'c1', kind, shape, source: 'manual', label: 'test', startMs: 0, endMs: 5000, strength: kind === 'pixelate' ? 16 : 30 });
  mask.keyframes = keyframes;
  doc = applyCommand(doc, { type: 'mask.add', mask }).doc;
  return doc;
}

describe.skipIf(!has)('mask render stage', () => {
  it('laplacian variance distinguishes flat from detailed regions', () => {
    const flat = Buffer.alloc(64 * 64, 100);
    const noisy = Buffer.from(Array.from({ length: 64 * 64 }, (_, i) => (i * 7919) % 255));
    expect(laplacianVariance(flat, 64, 64).variance).toBe(0);
    expect(laplacianVariance(noisy, 64, 64).variance).toBeGreaterThan(1000);
  });

  it.each([
    ['blur', 'rect'],
    ['pixelate', 'rect'],
    ['box', 'rect'],
    ['blur', 'ellipse'],
  ] as const)('%s/%s mask lowers sharpness inside the box and leaves the outside untouched', async (kind, shape) => {
    const dir = tempDir();
    const doc = await docWithMask(kind, shape, [{ tMs: 0, ...box, confidence: 1 }]);
    const before = await renderFrame(doc, dir, 1000, { masks: false });
    const after = await renderFrame(doc, dir, 1000, { masks: true });
    const inBefore = await frameSharpness(ff.ffmpeg!, before, 0, inner);
    const inAfter = await frameSharpness(ff.ffmpeg!, after, 0, inner);
    const outBefore = await frameSharpness(ff.ffmpeg!, before, 0, outside);
    const outAfter = await frameSharpness(ff.ffmpeg!, after, 0, outside);
    expect(inBefore.sharpness).toBeGreaterThan(50);
    if (kind === 'pixelate') {
      // pixelation adds block edges (Laplacian goes up); verify the region equals its block-average reconstruction instead
      const win = maskWindowAt(doc.masks[0]!, 1000, 640, 360)!;
      const block = pixelateBlockPx(doc.masks[0]!.strength, 360);
      const region = { x: win.x + 20, y: win.y + 20, w: win.w - 40, h: win.h - 40 };
      const fb = await grayFrame(ff.ffmpeg!, before, 0, null);
      const fa = await grayFrame(ff.ffmpeg!, after, 0, null);
      const eb = blockMeanError(fb.data, fb.width, fb.height, region, block);
      const ea = blockMeanError(fa.data, fa.width, fa.height, region, block);
      expect(ea, 'pixelate block error after').toBeLessThan(1);
      expect(eb, 'pixelate block error before').toBeGreaterThan(Math.max(1, ea * 2));
    } else {
      expect(inAfter.sharpness, `${kind}/${shape} inside`).toBeLessThan(inBefore.sharpness * 0.35);
    }
    expect(Math.abs(outAfter.sharpness - outBefore.sharpness) / outBefore.sharpness, `${kind}/${shape} outside`).toBeLessThan(0.15);
    if (shape === 'ellipse') {
      // the corner of the bounding box stays sharp for an elliptical mask
      const corner = { x: box.x + 0.005, y: box.y + 0.005, w: 0.04, h: 0.04 };
      const cb = await frameSharpness(ff.ffmpeg!, before, 0, corner);
      const ca = await frameSharpness(ff.ffmpeg!, after, 0, corner);
      expect(ca.sharpness).toBeGreaterThan(cb.sharpness * 0.6);
    }
    cleanup(dir);
  }, 60_000);

  it('follows keyframes over time and disables outside the mask range', async () => {
    const dir = tempDir();
    const kf = [
      { tMs: 0, x: 0.05, y: 0.3, w: 0.25, h: 0.35, confidence: 1 },
      { tMs: 4000, x: 0.65, y: 0.3, w: 0.25, h: 0.35, confidence: 1 },
    ];
    const doc = await docWithMask('blur', 'rect', kf);
    // at 2 s the box is centered around x = 0.35 (interpolated)
    const mid = await renderFrame(doc, dir, 2000, { masks: true });
    const midBefore = await renderFrame(doc, dir, 2000, { masks: false });
    const region = { x: 0.4, y: 0.38, w: 0.12, h: 0.18 };
    expect((await frameSharpness(ff.ffmpeg!, mid, 0, region)).sharpness).toBeLessThan((await frameSharpness(ff.ffmpeg!, midBefore, 0, region)).sharpness * 0.35);
    const leftRegion = { x: 0.06, y: 0.38, w: 0.12, h: 0.18 };
    expect((await frameSharpness(ff.ffmpeg!, mid, 0, leftRegion)).sharpness).toBeGreaterThan((await frameSharpness(ff.ffmpeg!, midBefore, 0, leftRegion)).sharpness * 0.7);
    // after endMs (5 s) nothing is masked
    const late = await renderFrame(doc, dir, 6000, { masks: true });
    const lateBefore = await renderFrame(doc, dir, 6000, { masks: false });
    const end = { x: 0.68, y: 0.38, w: 0.12, h: 0.18 };
    expect((await frameSharpness(ff.ffmpeg!, late, 0, end)).sharpness).toBeGreaterThan((await frameSharpness(ff.ffmpeg!, lateBefore, 0, end)).sharpness * 0.7);
    cleanup(dir);
  }, 60_000);

  it('renders a full clip with masks into a valid file', async () => {
    const dir = tempDir();
    const doc = await docWithMask('pixelate', 'rect', [{ tMs: 0, ...box, confidence: 1 }, { tMs: 3000, x: 0.5, y: 0.2, w: 0.3, h: 0.3, confidence: 1 }]);
    const target = { width: 640, height: 360, fps: doc.settings.fps, sampleRate: 48000, channels: 2 };
    const graph = compileRenderGraph({ doc, target, range: { startMs: 0, endMs: 4000 }, masks: { scratchDir: dir } });
    expect(graph.masksApplied).toBe(1);
    expect(graph.tempFiles).toHaveLength(1);
    expect(fs.readFileSync(graph.tempFiles[0]!, 'utf8')).toMatch(/lerp\(/);
    const script = path.join(dir, 'full.txt');
    fs.writeFileSync(script, graph.filterScript);
    const out = path.join(dir, 'full.mp4');
    await runFfmpeg({ ffmpeg: ff.ffmpeg!, args: buildFfmpegArgs(graph, script, { videoEncoder: 'libx264', videoArgs: ['-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p'], audioEncoder: 'aac', audioArgs: ['-b:a', '96k'], container: 'mp4', fps: target.fps }, out), operation: 'test:masks' });
    const v = await validateRenderedFile(ff.ffmpeg!, ff.ffprobe!, out, { durationMs: 4000, width: 640, height: 360, fps: target.fps });
    expect(v.ok, JSON.stringify(v.checks)).toBe(true);
    cleanup(dir);
  }, 60_000);
});
