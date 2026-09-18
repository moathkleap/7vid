import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { locateFfmpeg } from '../ffmpeg/locator';
import { resolveAppPaths } from '../paths/AppPaths';
import { probeMedia } from './probe';
import { decideProxy, DEFAULT_PLAYBACK_CAPABILITIES, generateProxy } from './proxy';
import { generatePoster, generateSprite } from './thumbnails';
import { generateWaveform } from './waveform';
import { tempDir, cleanup } from '../test/helpers';

const fixtures = path.resolve(__dirname, '../../../../tests/fixtures/generated');
const ff = locateFfmpeg(resolveAppPaths({ userData: tempDir(), resources: '/nonexistent' }));
const has = ff.ffmpeg && ff.ffprobe && fs.existsSync(path.join(fixtures, 'clip-10s-720p.mp4'));

describe.skipIf(!has)('media analysis', () => {
  it('probes every supported container and reports real metadata', async () => {
    const expectations: Array<[string, 'video' | 'image' | 'audio', number | null, number | null, string | null]> = [
      ['clip-10s-720p.mp4', 'video', 10_000, 720, 'h264'],
      ['clip-5s-1080p.mkv', 'video', 5_000, 1080, 'h264'],
      ['clip-4s-vp9.webm', 'video', 4_000, 360, 'vp9'],
      ['clip-3s-mpeg4.avi', 'video', 3_000, 480, 'mpeg4'],
      ['clip-6s-prores.mov', 'video', 6_000, 540, 'prores'],
      ['clip-2s.m4v', 'video', 2_000, 720, 'h264'],
      ['vertical-4s.mp4', 'video', 4_000, 1920, 'h264'],
      ['image.png', 'image', null, 720, 'png'],
      ['photo.jpg', 'image', null, 1080, 'mjpeg'],
      ['tone-3s.wav', 'audio', 3_000, null, null],
      ['music-8s.mp3', 'audio', 8_000, null, null],
    ];
    for (const [file, kind, duration, height, codec] of expectations) {
      const info = await probeMedia(ff.ffprobe!, path.join(fixtures, file));
      expect(info.kind, file).toBe(kind);
      if (duration != null) expect(Math.abs((info.durationMs ?? 0) - duration), `${file} duration ${info.durationMs}`).toBeLessThan(120);
      if (height != null) expect(info.video?.height, file).toBe(height);
      if (codec != null) expect(info.video?.codec, file).toBe(codec);
      if (kind === 'audio') expect(info.audio?.channels ?? 0).toBeGreaterThan(0);
    }
  });

  it('rejects missing and unsupported files honestly', async () => {
    await expect(probeMedia(ff.ffprobe!, path.join(fixtures, 'nope.mp4'))).rejects.toMatchObject({ info: { code: 'FILE_NOT_FOUND' } });
    const bogus = path.join(tempDir(), 'bogus.mp4');
    fs.writeFileSync(bogus, 'not a video');
    await expect(probeMedia(ff.ffprobe!, bogus)).rejects.toMatchObject({ info: { code: 'MEDIA_ANALYSIS_FAILED' } });
  });

  it('generates poster, sprite sheet, waveform and a validated proxy', async () => {
    const dir = tempDir();
    const info = await probeMedia(ff.ffprobe!, path.join(fixtures, 'clip-3s-mpeg4.avi'));
    const poster = await generatePoster(ff.ffmpeg!, info, path.join(dir, 'poster.jpg'));
    expect(fs.statSync(poster).size).toBeGreaterThan(1000);
    const sprite = await generateSprite(ff.ffmpeg!, info, path.join(dir, 'sprite.png'), { tileWidth: 80 });
    expect(sprite?.count).toBeGreaterThanOrEqual(6);
    expect(fs.existsSync(path.join(dir, 'sprite.json'))).toBe(true);
    const wf = await generateWaveform(ff.ffmpeg!, info, path.join(dir, 'wave.json'), { samplesPerSecond: 10 });
    expect(wf?.peaks.length).toBeGreaterThanOrEqual(29);
    expect(Math.max(...wf!.peaks)).toBeGreaterThan(0.05);
    const decision = decideProxy(info, { maxHeight: 540, caps: { ...DEFAULT_PLAYBACK_CAPABILITIES, h264: false, aac: false } });
    expect(decision).toEqual({ needed: true, reason: 'container', format: 'webm' });
    const proxy = await generateProxy(ff.ffmpeg!, info, path.join(dir, 'proxy.webm'), { height: 360, format: 'webm' });
    const pinfo = await probeMedia(ff.ffprobe!, proxy);
    expect(pinfo.video?.codec).toBe('vp9');
    expect(pinfo.audio?.codec).toBe('opus');
    expect(pinfo.video?.height).toBe(360);
    expect(Math.abs((pinfo.durationMs ?? 0) - 3000)).toBeLessThan(150);
    cleanup(dir);
  });

  it('decides proxies from real playback capabilities', async () => {
    const mp4 = await probeMedia(ff.ffprobe!, path.join(fixtures, 'clip-10s-720p.mp4'));
    expect(decideProxy(mp4, { maxHeight: 540, caps: DEFAULT_PLAYBACK_CAPABILITIES }).reason).toBe('resolution');
    expect(decideProxy(mp4, { maxHeight: 720, caps: DEFAULT_PLAYBACK_CAPABILITIES }).needed).toBe(false);
    expect(decideProxy(mp4, { maxHeight: 720, caps: { ...DEFAULT_PLAYBACK_CAPABILITIES, h264: false } }).reason).toBe('video-codec');
    const mov = await probeMedia(ff.ffprobe!, path.join(fixtures, 'clip-6s-prores.mov'));
    expect(decideProxy(mov, { maxHeight: 720, caps: DEFAULT_PLAYBACK_CAPABILITIES }).reason).toBe('video-codec');
  });
});
