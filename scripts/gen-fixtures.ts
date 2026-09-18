/**
 * Generates synthetic test media with FFmpeg (no external downloads):
 * videos in every supported container, images, audio, a clip with silence gaps, a clip with real
 * synthesized speech (espeak-ng, when installed) and a clip with a moving high-contrast box
 * (for tracking tests). Output: tests/fixtures/generated/.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(__dirname, '..', 'tests', 'fixtures', 'generated');
fs.mkdirSync(out, { recursive: true });
const ffmpeg = process.env.SEVENVID_FFMPEG_PATH ?? 'ffmpeg';

function run(args: string[]): void {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

function exists(name: string): boolean {
  const target = path.join(out, name);
  return fs.existsSync(target) && fs.statSync(target).size > 0;
}

function which(bin: string): string | null {
  try {
    return execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)[0]?.trim() || null;
  } catch {
    return null;
  }
}

const items: Array<{ name: string; args: string[] }> = [
  { name: 'clip-10s-720p.mp4', args: ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '10', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest'] },
  { name: 'clip-5s-1080p.mkv', args: ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-t', '5', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'] },
  { name: 'clip-4s-vp9.webm', args: ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '4', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '500k', '-c:a', 'libopus', '-shortest'] },
  { name: 'clip-3s-mpeg4.avi', args: ['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100', '-t', '3', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame', '-shortest'] },
  { name: 'clip-6s-prores.mov', args: ['-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=48000', '-t', '6', '-c:v', 'prores_ks', '-profile:v', '0', '-c:a', 'pcm_s16le', '-shortest'] },
  { name: 'clip-2s.m4v', args: ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an'] },
  { name: 'vertical-4s.mp4', args: ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'] },
  { name: 'image.png', args: ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=1', '-frames:v', '1'] },
  { name: 'photo.jpg', args: ['-f', 'lavfi', '-i', 'mandelbrot=size=1920x1080:rate=1', '-frames:v', '1', '-q:v', '3'] },
  { name: 'tone-3s.wav', args: ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:a', 'pcm_s16le'] },
  // quiet tone with broadband noise: for denoise / loudness tests (-30 dBFS tone + noise)
  { name: 'noisy-tone-4s.wav', args: ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-f', 'lavfi', '-i', 'anoisesrc=color=white:sample_rate=48000:amplitude=0.05:seed=7', '-filter_complex', '[0:a]volume=-20dB[t];[t][1:a]amix=inputs=2:normalize=0[a]', '-map', '[a]', '-t', '4', '-c:a', 'pcm_s16le'] },
  { name: 'music-8s.mp3', args: ['-f', 'lavfi', '-i', 'sine=frequency=261.63:sample_rate=44100', '-f', 'lavfi', '-i', 'sine=frequency=329.63:sample_rate=44100', '-filter_complex', '[0:a][1:a]amix=inputs=2[a]', '-map', '[a]', '-t', '8', '-c:a', 'libmp3lame', '-b:a', '128k'] },
  // 12 s: tone 0-3s, silence 3-6s, tone 6-8s, silence 8-11s, tone 11-12s (FFmpeg silencedetect tests)
  { name: 'tone-with-silence-12s.mp4', args: ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', "sine=frequency=440:sample_rate=48000,volume=enable='between(t,3,6)+between(t,8,11)':volume=0", '-t', '12', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'] },
  // moving white box on a dark background, 6 s: x = 40 + 60 t, y = 120 + 20 sin(t) (object tracking / blur verification tests).
  // drawbox does not evaluate `t`, so the box is a second source moved with overlay (eval=frame).
  { name: 'moving-box-6s.mp4', args: ['-f', 'lavfi', '-i', 'color=c=0x202020:size=640x360:rate=30', '-f', 'lavfi', '-i', 'color=c=white:size=80x80:rate=30', '-filter_complex', "[0:v][1:v]overlay=x='40+t*60':y='120+20*sin(t)':eval=frame:shortest=1[v]", '-map', '[v]', '-t', '6', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an'] },
];

for (const item of items) {
  if (exists(item.name)) continue;
  process.stdout.write(`generating ${item.name}\n`);
  run([...item.args, path.join(out, item.name)]);
}

// Real speech (espeak-ng) with pauses: speech 0-3 s, silence 3-6 s, speech 6-8 s, silence 8-11 s, speech 11-12 s.
// Used by the VAD and transcription tests; skipped (and those tests skip) when espeak-ng is not installed.
const espeak = which('espeak-ng') ?? which('espeak');
if (!exists('speech-with-silence-12s.mp4')) {
  if (espeak) {
    process.stdout.write('generating speech-with-silence-12s.mp4 (espeak-ng)\n');
    const speech = path.join(out, 'speech-en-4s.wav');
    execFileSync(espeak, ['-v', 'en', '-s', '150', '-w', speech, 'This is a test recording for the seven vid speech detector. Please count every pause carefully, then continue to the end.'], { stdio: 'inherit' });
    run([
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-i', speech,
      '-filter_complex', '[1:a]atrim=0:3,asetpts=PTS-STARTPTS[s1];[1:a]atrim=0:2,asetpts=PTS-STARTPTS,adelay=6000:all=1[s2];[1:a]atrim=0:1,asetpts=PTS-STARTPTS,adelay=11000:all=1[s3];[s1][s2][s3]amix=inputs=3:normalize=0:duration=longest,apad=whole_dur=12,aformat=sample_rates=48000:channel_layouts=stereo[a]',
      '-map', '0:v', '-map', '[a]', '-t', '12', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(out, 'speech-with-silence-12s.mp4'),
    ]);
    if (!exists('speech-ar-3s.wav')) execFileSync(espeak, ['-v', 'ar', '-s', '140', '-w', path.join(out, 'speech-ar-3s.wav'), 'مرحبا بكم في تطبيق سفن فيد لتحرير الفيديو'], { stdio: 'inherit' });
  } else {
    process.stdout.write('espeak-ng not found: speech fixtures skipped (VAD/STT tests will skip)\n');
  }
}

fs.writeFileSync(path.join(out, 'README.txt'), 'Synthetic test media generated by scripts/gen-fixtures.ts. Safe to delete.\n');
const py = ['ai-worker/.venv/bin/python', 'ai-worker/.venv/Scripts/python.exe'].map((p) => path.join(path.resolve(__dirname, '..'), p)).find((p) => fs.existsSync(p));
if (py) {
  try {
    execFileSync(py, [path.resolve(__dirname, '..', 'ai-worker', 'scripts', 'gen_fixtures.py'), out], { stdio: 'inherit' });
  } catch (err) {
    process.stdout.write(`python fixtures skipped: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
process.stdout.write(`fixtures ready in ${out}\n`);
