import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { maskBoxAt } from '@sevenvid/core';
import type { BlurFacesResult, DetectFacesResult, MaskVerificationResult, TrackTargetResult } from '@sevenvid/ipc';
import { createEngine, type Engine } from '../api/createEngine';
import { cleanup, tempDir, testHost } from '../test/helpers';

const root = path.resolve(__dirname, '../../../..');
const fixtures = path.join(root, 'tests', 'fixtures', 'generated');
const devModels = path.join(root, '.sevenvid-dev', 'userData', 'models');
const venv = process.platform === 'win32' ? path.join(root, 'ai-worker', '.venv', 'Scripts', 'python.exe') : path.join(root, 'ai-worker', '.venv', 'bin', 'python');
const has = fs.existsSync(venv) && fs.existsSync(path.join(devModels, 'opencv', 'yunet-2023mar', 'face_detection_yunet_2023mar.onnx')) && fs.existsSync(path.join(fixtures, 'face-pan-4s.mp4'));

let dir: string;
let engine: Engine;

afterEach(async () => {
  await engine?.dispose();
  cleanup(dir);
});

async function importClip(projectId: string, file: string) {
  const imported = await engine.invoke('media.import', { paths: [path.join(fixtures, file)], projectId });
  const asset = imported.assets[0]!;
  const analyze = engine.tasks.list({ includeFinished: true }).find((t) => t.kind === 'media.analyze' && t.params.assetId === asset.id)!;
  expect((await engine.tasks.wait(analyze.id)).status).toBe('done');
  const state = await engine.invoke('media.addToTimeline', { projectId, assetId: asset.id });
  return state.document.tracks.flatMap((t) => t.clips).find((c) => c.assetId === asset.id)!;
}

async function runTask<T>(task: { id: string }): Promise<T> {
  const done = await engine.tasks.wait(task.id);
  expect(done.status, JSON.stringify(done.error)).toBe('done');
  return done.result as T;
}

describe.skipIf(!has)('vision service (python worker)', () => {
  beforeAll(() => {
    process.env.SEVENVID_WORKER_DIR = path.join(root, 'ai-worker');
  });

  it('detects faces, blurs them with tracking, verifies the blur and exports', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(root, 'resources'), modelsDir: devModels }, logLevel: 'warn' });
    await engine.start();
    const runtime = await engine.invoke('runtime.status', { probe: true });
    expect(runtime.python?.workerInstalled, JSON.stringify(runtime)).toBe(true);
    expect(runtime.worker?.capabilities.faces?.available).toBe(true);
    await engine.capabilities.refresh();
    expect(engine.capabilities.status('vision.faces').status).toBe('available');
    expect(engine.capabilities.status('vision.tracking').status).toBe('available');
    const models = await engine.invoke('models.list');
    expect(models.find((m) => m.spec.id === 'opencv/yunet-2023mar')?.status).toBe('installed');
    const test = await engine.invoke('models.test', { modelId: 'opencv/yunet-2023mar' });
    expect(test.ok, test.message).toBe(true);

    const project = await engine.invoke('projects.create', { name: 'privacy', width: 512, height: 512, fps: 25 });
    await engine.invoke('projects.open', { projectId: project.id });
    const clip = await importClip(project.id, 'face-pan-4s.mp4');
    const faces = await runTask<DetectFacesResult>(await engine.invoke('vision.detectFaces', { projectId: project.id, clipId: clip.id, sampleFps: 4 }));
    expect(faces.totalDetections).toBeGreaterThanOrEqual(8);
    expect(faces.tracks.length).toBeGreaterThanOrEqual(1);
    expect(faces.tracks[0]!.box.w).toBeGreaterThan(0.1);
    const blurred = await runTask<BlurFacesResult>(await engine.invoke('vision.blurFaces', { projectId: project.id, clipId: clip.id, kind: 'blur', shape: 'ellipse', selector: 'largest' }));
    expect(blurred.masks).toHaveLength(1);
    const maskInfo = blurred.masks[0]!;
    expect(maskInfo.keyframes).toBeGreaterThanOrEqual(3);
    expect(maskInfo.coverage).toBeGreaterThan(0.8);
    const doc = engine.sessions.get(project.id).document;
    const mask = doc.masks.find((m) => m.id === maskInfo.maskId)!;
    expect(mask.source).toBe('auto-face');
    expect(mask.endMs - mask.startMs).toBeGreaterThan(3000);
    const boxAt = maskBoxAt(mask, 2000)!;
    expect(boxAt.w).toBeGreaterThan(0.15);
    const verification = await runTask<MaskVerificationResult>(await engine.invoke('vision.verifyMask', { projectId: project.id, maskId: mask.id }));
    expect(verification.ok, JSON.stringify(verification.samples)).toBe(true);
    expect(verification.samples.every((s) => s.after < s.before * 0.4)).toBe(true);
    const verified = engine.sessions.get(project.id).document.masks.find((m) => m.id === mask.id)!;
    expect(verified.verification?.ok).toBe(true);
    // the export renders the mask (validated file)
    const exp = await engine.invoke('export.start', { projectId: project.id, settings: { presetId: 'web-small' }, outputPath: path.join(dir, 'blurred.mp4') });
    const done = await engine.tasks.wait(exp.taskId!);
    expect(done.status, JSON.stringify(done.error)).toBe('done');
    // undo: first the verification record, then the masks as one step
    await engine.invoke('session.undo', { projectId: project.id });
    const undone = await engine.invoke('session.undo', { projectId: project.id });
    expect(undone.document.masks).toHaveLength(0);
  }, 300_000);

  it('tracks a manually selected region and reports honest status', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(root, 'resources'), modelsDir: devModels }, logLevel: 'warn' });
    await engine.start();
    const project = await engine.invoke('projects.create', { name: 'track', width: 640, height: 360, fps: 30 });
    await engine.invoke('projects.open', { projectId: project.id });
    const clip = await importClip(project.id, 'moving-box-6s.mp4');
    const r = await runTask<TrackTargetResult>(await engine.invoke('vision.trackTarget', { projectId: project.id, clipId: clip.id, box: { x: 40 / 640, y: 120 / 360, w: 80 / 640, h: 80 / 360 }, startMs: 0, endMs: 5000, kind: 'pixelate' }));
    expect(r.status).toBe('ok');
    expect(r.keyframes).toBeGreaterThanOrEqual(3);
    expect(r.coveredEndMs).toBeGreaterThan(4500);
    const mask = engine.sessions.get(project.id).document.masks.find((m) => m.id === r.maskId)!;
    const at4 = maskBoxAt(mask, 4000)!;
    // box center at t=4 s: x = 40 + 240 + 40 = 320 px → 0.5
    expect(Math.abs(at4.x + at4.w / 2 - 0.5)).toBeLessThan(0.06);
    // no faces in this clip: blurFaces must fail with a clear error instead of inventing masks
    const noFaces = await engine.invoke('vision.blurFaces', { projectId: project.id, clipId: clip.id });
    const failed = await engine.tasks.wait(noFaces.id);
    expect(failed.status).toBe('failed');
    expect(failed.error?.code).toBe('NO_FACES_FOUND');
  }, 300_000);
});
