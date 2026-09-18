import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OcrResult } from '@sevenvid/ipc';
import { createEngine, type Engine } from '../api/createEngine';
import { cleanup, tempDir, testHost } from '../test/helpers';

const root = path.resolve(__dirname, '../../../..');
const fixtures = path.join(root, 'tests', 'fixtures', 'generated');
const devModels = path.join(root, '.sevenvid-dev', 'userData', 'models');
const has = fs.existsSync(path.join(fixtures, 'text-3s.mp4')) && fs.existsSync(path.join(devModels, 'tesseract', 'eng-fast', 'eng.traineddata')) && fs.existsSync(path.join(devModels, 'tesseract', 'ara-fast', 'ara.traineddata'));
let dir: string;
let engine: Engine;

afterEach(async () => {
  await engine?.dispose();
  cleanup(dir);
});

describe.skipIf(!has)('ocr service', () => {
  it('recognizes English and Arabic text in a frame and creates text masks on a clip', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(root, 'resources'), modelsDir: devModels }, logLevel: 'warn' });
    await engine.start();
    expect(engine.capabilities.status('ocr').status).toBe('available');
    const rec = await engine.ocr.recognizeFile(path.join(fixtures, 'text-frame.png'), ['en', 'ar']);
    expect(rec.text).toMatch(/OPEN 24 HOURS/);
    expect(rec.lines.some((l) => l.language === 'ar' || l.language === 'mixed')).toBe(true);
    expect(rec.text).toContain('مرحبا بكم');
    const eng = rec.lines.find((l) => /OPEN/.test(l.text))!;
    expect(eng.box.y).toBeGreaterThan(0.4);
    expect(eng.box.w).toBeGreaterThan(0.3);
    // model test button runs the same inference
    const t = await engine.invoke('models.test', { modelId: 'tesseract/eng-fast' });
    expect(t.ok, t.message).toBe(true);

    const project = await engine.invoke('projects.create', { name: 'ocr', width: 1280, height: 720, fps: 25 });
    await engine.invoke('projects.open', { projectId: project.id });
    const imported = await engine.invoke('media.import', { paths: [path.join(fixtures, 'text-3s.mp4')], projectId: project.id });
    const asset = imported.assets[0]!;
    const analyze = engine.tasks.list({ includeFinished: true }).find((x) => x.kind === 'media.analyze' && x.params.assetId === asset.id)!;
    expect((await engine.tasks.wait(analyze.id)).status).toBe('done');
    const state = await engine.invoke('media.addToTimeline', { projectId: project.id, assetId: asset.id });
    const clip = state.document.tracks.flatMap((tr) => tr.clips)[0]!;
    const task = await engine.invoke('ocr.detect', { projectId: project.id, clipId: clip.id, languages: ['en', 'ar'], sampleFps: 1 });
    const done = await engine.tasks.wait(task.id);
    expect(done.status, JSON.stringify(done.error)).toBe('done');
    const result = done.result as OcrResult;
    expect(result.framesAnalyzed).toBeGreaterThanOrEqual(2);
    expect(result.tracks.length).toBeGreaterThanOrEqual(2);
    expect(result.tracks.some((tr) => /OPEN/.test(tr.text))).toBe(true);
    expect(result.tracks.some((tr) => tr.text.includes('مرحبا'))).toBe(true);
    expect(result.text).toMatch(/OPEN/);
    const cached = await engine.invoke('analysis.get', { projectId: project.id, clipId: clip.id, kind: 'ocr' });
    expect((cached as OcrResult).tracks.length).toBe(result.tracks.length);
    const masked = await engine.invoke('ocr.createMasks', { projectId: project.id, clipId: clip.id, kind: 'pixelate' });
    expect(masked.document.masks.length).toBe(result.tracks.length);
    expect(masked.document.masks.every((m) => m.source === 'auto-text' && m.keyframes.length === 1)).toBe(true);
    const search = await engine.invoke('search.query', { q: 'OPEN' });
    expect(search.some((r) => r.type === 'asset')).toBe(true);
  }, 120_000);
});
