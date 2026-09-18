import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, type Engine } from '../api/createEngine';
import { cleanup, tempDir, testHost } from '../test/helpers';
import { parseSubtitles } from './writers';

const fixtures = path.resolve(__dirname, '../../../../tests/fixtures/generated');
const hasFixtures = fs.existsSync(path.join(fixtures, 'clip-4s-vp9.webm'));
let dir: string;
let engine: Engine;

afterEach(async () => {
  await engine?.dispose();
  cleanup(dir);
});

const SRT = `1
00:00:00,500 --> 00:00:01,800
مرحبا بكم في تطبيق سفن فيد

2
00:00:02,000 --> 00:00:03,000
Welcome to 7vid

3
00:00:03,100 --> 00:00:03,900
الترجمة تعمل
`;

describe.skipIf(!hasFixtures)('subtitle service', () => {
  it('imports SRT, exports VTT/SRT/ASS with verification, and reports missing STT models honestly', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'warn' });
    await engine.start();
    const project = await engine.invoke('projects.create', { name: 'subs', width: 640, height: 360, fps: 30 });
    await engine.invoke('projects.open', { projectId: project.id });
    const imported = await engine.invoke('media.import', { paths: [path.join(fixtures, 'clip-4s-vp9.webm')], projectId: project.id });
    const analyze = engine.tasks.list({ includeFinished: true }).find((t) => t.kind === 'media.analyze' && t.params.assetId === imported.assets[0]!.id)!;
    await engine.tasks.wait(analyze.id);
    await engine.invoke('media.addToTimeline', { projectId: project.id, assetId: imported.assets[0]!.id });
    const srt = path.join(dir, 'in.srt');
    fs.writeFileSync(srt, SRT, 'utf8');
    const state = await engine.invoke('subtitles.import', { projectId: project.id, path: srt });
    const track = state.document.subtitles[0]!;
    expect(track.cues).toHaveLength(3);
    expect(track.language).toBe('ar');
    expect(track.source).toBe('imported');
    expect(track.cues[0]!.text).toBe('مرحبا بكم في تطبيق سفن فيد');
    for (const format of ['vtt', 'srt', 'ass'] as const) {
      const out = await engine.invoke('subtitles.export', { projectId: project.id, trackId: track.id, format, outputPath: path.join(dir, `out.${format}`) });
      expect(out.cues).toBe(3);
      const text = fs.readFileSync(out.path, 'utf8');
      if (format === 'ass') {
        expect(text).toContain('[Events]');
        expect(text.match(/^Dialogue:/gm)).toHaveLength(3);
        expect(text).toContain('PlayResX: 640');
      } else {
        expect(parseSubtitles(text, () => 'x')).toHaveLength(3);
        expect(text).toContain('Welcome to 7vid');
      }
    }
    // burn-in through the export pipeline: the ASS file is generated and the render validates
    await engine.invoke('session.command', { projectId: project.id, command: { type: 'subtitle.updateTrack', trackId: track.id, patch: { burnIn: true } } });
    const exp = await engine.invoke('export.start', { projectId: project.id, settings: { presetId: 'web-small', burnSubtitles: true }, outputPath: path.join(dir, 'burn.mp4') });
    const done = await engine.tasks.wait(exp.taskId!);
    expect(done.status, JSON.stringify(done.error)).toBe('done');
    // no Whisper model installed here: the transcribe channel must refuse with a model error, never pretend
    if (!engine.subtitles.installedSttModel()) {
      await expect(engine.invoke('subtitles.transcribe', { projectId: project.id })).rejects.toMatchObject({ info: { code: 'MODEL_NOT_INSTALLED' } });
      expect(engine.capabilities.status('stt').status).not.toBe('available');
    }
  }, 120_000);
});
