import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDocumentDurationMs } from '@sevenvid/core';
import type { EnhancePreviewResult, LoudnessResult, RemoveSilenceResult, SilenceDetectionResult } from '@sevenvid/ipc';
import { createEngine, type Engine } from '../api/createEngine';
import { cleanup, tempDir, testHost } from '../test/helpers';

const fixtures = path.resolve(__dirname, '../../../../tests/fixtures/generated');
const hasFixtures = fs.existsSync(path.join(fixtures, 'tone-with-silence-12s.mp4'));
let dir: string;
let engine: Engine;

afterEach(async () => {
  await engine?.dispose();
  cleanup(dir);
});

async function setup(file: string) {
  dir = tempDir();
  engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'warn' });
  await engine.start();
  const project = await engine.invoke('projects.create', { name: 'audio', width: 640, height: 360, fps: 30 });
  await engine.invoke('projects.open', { projectId: project.id });
  const imported = await engine.invoke('media.import', { paths: [path.join(fixtures, file)], projectId: project.id });
  const asset = imported.assets[0]!;
  const analyze = engine.tasks.list({ includeFinished: true }).find((t) => t.kind === 'media.analyze' && t.params.assetId === asset.id)!;
  expect((await engine.tasks.wait(analyze.id)).status).toBe('done');
  const state = await engine.invoke('media.addToTimeline', { projectId: project.id, assetId: asset.id });
  return { project, asset, state };
}

async function runTask<T>(task: { id: string }): Promise<T> {
  const done = await engine.tasks.wait(task.id);
  expect(done.status, JSON.stringify(done.error)).toBe('done');
  return done.result as T;
}

describe.skipIf(!hasFixtures)('audio service', () => {
  it('detects silences with FFmpeg and removes them with verification', async () => {
    const { project } = await setup('tone-with-silence-12s.mp4');
    const det = await runTask<SilenceDetectionResult>(await engine.invoke('audio.detectSilence', { projectId: project.id, method: 'silencedetect', thresholdDb: -40, minSilenceMs: 800 }));
    expect(det.method).toBe('silencedetect');
    expect(det.ranges).toHaveLength(2);
    expect(Math.abs(det.ranges[0]!.startMs - 3000)).toBeLessThan(150);
    expect(Math.abs(det.ranges[0]!.endMs - 6000)).toBeLessThan(150);
    expect(Math.abs(det.ranges[1]!.startMs - 8000)).toBeLessThan(150);
    expect(Math.abs(det.ranges[1]!.endMs - 11000)).toBeLessThan(150);
    const before = getDocumentDurationMs(engine.sessions.get(project.id).document);
    const rem = await runTask<RemoveSilenceResult>(await engine.invoke('audio.removeSilence', { projectId: project.id, method: 'silencedetect', thresholdDb: -40, minSilenceMs: 800, paddingMs: 100 }));
    expect(rem.cutRanges).toHaveLength(2);
    expect(rem.removedMs).toBeGreaterThan(5000);
    expect(Math.abs(rem.beforeDurationMs - before)).toBeLessThan(5);
    expect(Math.abs(rem.afterDurationMs - (before - rem.removedMs))).toBeLessThan(40);
    expect(rem.verified).toBe(true);
    expect(rem.remainingSilences).toHaveLength(0);
    const doc = engine.sessions.get(project.id).document;
    expect(getDocumentDurationMs(doc)).toBe(rem.afterDurationMs);
    // undo restores the original duration (one undoable step)
    const undone = await engine.invoke('session.undo', { projectId: project.id });
    expect(getDocumentDurationMs(undone.document)).toBe(before);
  }, 120_000);

  it('measures loudness and previews an enhancement preset with real before/after numbers', async () => {
    const { project, state } = await setup('noisy-tone-4s.wav');
    const clip = state.document.tracks.flatMap((t) => t.clips)[0]!;
    const m = await runTask<LoudnessResult>(await engine.invoke('audio.measure', { projectId: project.id }));
    expect(m.integratedLufs).not.toBeNull();
    expect(m.integratedLufs!).toBeLessThan(-10);
    expect(m.truePeakDb).not.toBeNull();
    expect(m.durationMs).toBeGreaterThan(3900);
    const applied = await engine.invoke('audio.applyPreset', { projectId: project.id, clipIds: [clip.id], presetId: 'normalize' });
    const c = applied.document.tracks.flatMap((t) => t.clips).find((x) => x.id === clip.id)!;
    expect(c.effects.map((e) => e.type)).toEqual(['audio-normalize']);
    const pv = await runTask<EnhancePreviewResult>(await engine.invoke('audio.previewEnhance', { projectId: project.id, clipId: clip.id }));
    expect(fs.existsSync(pv.beforePath) && fs.existsSync(pv.afterPath)).toBe(true);
    expect(pv.effects).toEqual(['audio-normalize']);
    expect(pv.before.integratedLufs).not.toBeNull();
    expect(pv.after.integratedLufs).not.toBeNull();
    expect(Math.abs(pv.after.integratedLufs! - -16)).toBeLessThan(4);
    expect(Math.abs(pv.after.integratedLufs! - pv.before.integratedLufs!)).toBeGreaterThan(1);
    // replacing with another preset swaps the chain instead of stacking
    const applied2 = await engine.invoke('audio.applyPreset', { projectId: project.id, clipIds: [clip.id], presetId: 'clean-voice' });
    const c2 = applied2.document.tracks.flatMap((t) => t.clips).find((x) => x.id === clip.id)!;
    expect(c2.effects.map((e) => e.type)).toEqual(['audio-denoise', 'audio-voice', 'audio-compressor']);
  }, 120_000);
});
