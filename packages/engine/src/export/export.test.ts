import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDocumentDurationMs } from '@sevenvid/core';
import { createEngine, type Engine } from '../api/createEngine';
import { cleanup, tempDir, testHost } from '../test/helpers';

const fixtures = path.resolve(__dirname, '../../../../tests/fixtures/generated');
const hasFixtures = fs.existsSync(path.join(fixtures, 'clip-10s-720p.mp4'));
let dir: string;
let engine: Engine;

afterEach(async () => {
  await engine?.dispose();
  cleanup(dir);
});

describe.skipIf(!hasFixtures)('import → edit → export → validate', () => {
  it('runs the full pipeline through the engine API', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'debug' });
    await engine.start();
    expect(engine.capabilities.status('media.import').status).toBe('available');
    const project = await engine.invoke('projects.create', { name: 'pipeline', width: 640, height: 360, fps: 30 });
    await engine.invoke('projects.open', { projectId: project.id });
    const imported = await engine.invoke('media.import', { paths: [path.join(fixtures, 'clip-10s-720p.mp4'), path.join(fixtures, 'tone-3s.wav'), path.join(fixtures, 'missing.mp4'), path.join(fixtures, 'README.txt')], projectId: project.id });
    expect(imported.assets).toHaveLength(2);
    expect(imported.skipped.map((s) => s.reason).sort()).toEqual(['not-found', 'unsupported']);
    const video = imported.assets[0]!;
    for (const a of imported.assets) {
      const task = engine.tasks.list({ includeFinished: true }).find((t) => t.kind === 'media.analyze' && t.params.assetId === a.id)!;
      const done = await engine.tasks.wait(task.id);
      expect(done.status, JSON.stringify(done.error)).toBe('done');
    }
    const analyzed = (await engine.invoke('media.get', { assetId: video.id }))!;
    expect(analyzed.analysisStatus).toBe('ready');
    expect(analyzed.durationMs).toBeGreaterThan(9900);
    expect(analyzed.spriteMeta?.count).toBeGreaterThan(0);
    expect(fs.existsSync(analyzed.thumbnailPath!)).toBe(true);
    expect(['pending', 'running', 'ready']).toContain(analyzed.proxyStatus);
    const proxyTask = engine.tasks.list({ includeFinished: true }).find((t) => t.kind === 'media.proxy')!;
    expect((await engine.tasks.wait(proxyTask.id)).status).toBe('done');
    expect((await engine.invoke('media.get', { assetId: video.id }))!.proxyStatus).toBe('ready');
    const wf = await engine.invoke('media.waveform', { assetId: video.id });
    expect(wf?.peaks.length).toBeGreaterThan(100);
    let state = await engine.invoke('media.addToTimeline', { projectId: project.id, assetId: video.id });
    expect(getDocumentDurationMs(state.document)).toBe(analyzed.durationMs);
    state = await engine.invoke('session.command', { projectId: project.id, command: { type: 'timeline.trimStart', ms: 2000 } });
    state = await engine.invoke('session.command', { projectId: project.id, command: { type: 'timeline.trimEnd', ms: 5000 } });
    state = await engine.invoke('media.addToTimeline', { projectId: project.id, assetId: imported.assets[1]!.id, atMs: 500 });
    expect(state.document.tracks.find((t) => t.kind === 'audio')!.clips).toHaveLength(1);
    const duration = getDocumentDurationMs(state.document);
    expect(duration).toBeGreaterThanOrEqual(3000);
    const started = await engine.invoke('export.start', { projectId: project.id, settings: { presetId: 'web-small', width: 480, height: 270, speedPreset: 'ultrafast' }, outputPath: path.join(dir, 'out', 'final.mp4') });
    expect(['queued', 'running']).toContain(started.status);
    const done = await engine.tasks.wait(started.taskId!);
    expect(done.status, JSON.stringify(done.error)).toBe('done');
    const info = (await engine.invoke('export.get', { exportId: started.id }))!;
    expect(info.status).toBe('done');
    expect(info.validation?.ok).toBe(true);
    expect((info.validation as { width?: number }).width).toBe(480);
    expect(fs.statSync(info.outputPath).size).toBeGreaterThan(10_000);
    const withProxy = (await engine.invoke('media.get', { assetId: video.id }))!;
    const url = await engine.invoke('media.url', { path: withProxy.proxyPath! });
    expect(url.url).toContain('proxy');
    expect((await engine.invoke('media.url', { path: '/etc/passwd' })).url).toBeNull();
  }, 180_000);

  it('refuses to export an empty timeline and reports the reason', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') } });
    await engine.start();
    const project = await engine.invoke('projects.create', { name: 'empty' });
    await expect(engine.invoke('export.start', { projectId: project.id, settings: { presetId: 'web-small' } })).rejects.toMatchObject({ info: { code: 'VALIDATION_FAILED' } });
  });
});
