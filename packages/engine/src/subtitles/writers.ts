import { formatAssTime, formatSrtTime, formatVttTime, type SubtitleCue, type SubtitleStyle, type SubtitleTrack } from '@sevenvid/core';

export function toSrt(cues: SubtitleCue[]): string {
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  return sorted.map((c, i) => `${i + 1}\n${formatSrtTime(c.startMs)} --> ${formatSrtTime(c.endMs)}\n${c.speaker ? `${c.speaker}: ` : ''}${c.text.trim()}\n`).join('\n') + (sorted.length ? '\n' : '');
}

export function toVtt(cues: SubtitleCue[]): string {
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  return 'WEBVTT\n\n' + sorted.map((c) => `${formatVttTime(c.startMs)} --> ${formatVttTime(c.endMs)}\n${c.speaker ? `<v ${c.speaker}>` : ''}${c.text.trim()}\n`).join('\n');
}

function assColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return '&H00FFFFFF';
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255))).toString(16).padStart(2, '0');
  return `&H${a}${m[3]}${m[2]}${m[1]}`.toUpperCase();
}

function alignment(position: SubtitleStyle['position']): number {
  return position === 'top' ? 8 : position === 'center' ? 5 : 2;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, '\\N');
}

/** Builds an ASS document sized to the sequence so burned-in captions match the preview. Arabic shaping and bidi are handled by libass. */
export function toAss(track: SubtitleTrack, seq: { width: number; height: number }): string {
  const s = track.style;
  const fontSize = Math.round((s.fontSize * seq.height) / 1080);
  const marginV = Math.round((s.marginV * seq.height) / 1080);
  const outline = Math.max(0, Math.round((s.outlineWidth * seq.height) / 1080 * 10) / 10);
  const borderStyle = s.backgroundColor ? 3 : 1;
  const back = s.backgroundColor ? assColor(s.backgroundColor, 0.35) : '&H80000000';
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${seq.width}`,
    `PlayResY: ${seq.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${s.fontFamily},${fontSize},${assColor(s.color)},${assColor(s.color)},${assColor(s.outlineColor)},${back},${s.bold ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},${outline},0,${alignment(s.position)},${Math.round(seq.width * 0.05)},${Math.round(seq.width * 0.05)},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = [...track.cues]
    .sort((a, b) => a.startMs - b.startMs)
    .map((c) => `Dialogue: 0,${formatAssTime(c.startMs)},${formatAssTime(c.endMs)},Default,${c.speaker ?? ''},0,0,0,,${escapeAssText(c.text.trim())}`);
  return header.concat(events).join('\n') + '\n';
}

/** Parses SRT or VTT text into cues (tolerant of BOMs, CRLF and missing indices). */
export function parseSubtitles(text: string, makeId: () => string): SubtitleCue[] {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: SubtitleCue[] = [];
  const blocks = clean.split(/\n{2,}/);
  const timeRe = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;
  const shortRe = /(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2})[.,](\d{1,3})/;
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '' && l.trim() !== 'WEBVTT');
    const idx = lines.findIndex((l) => timeRe.test(l) || shortRe.test(l));
    if (idx < 0) continue;
    const line = lines[idx]!;
    let startMs: number;
    let endMs: number;
    const m = timeRe.exec(line);
    if (m) {
      startMs = ((+m[1]! * 60 + +m[2]!) * 60 + +m[3]!) * 1000 + Number(m[4]!.padEnd(3, '0'));
      endMs = ((+m[5]! * 60 + +m[6]!) * 60 + +m[7]!) * 1000 + Number(m[8]!.padEnd(3, '0'));
    } else {
      const n = shortRe.exec(line)!;
      startMs = (+n[1]! * 60 + +n[2]!) * 1000 + Number(n[3]!.padEnd(3, '0'));
      endMs = (+n[4]! * 60 + +n[5]!) * 1000 + Number(n[6]!.padEnd(3, '0'));
    }
    const textLines = lines.slice(idx + 1).map((l) => l.replace(/<[^>]+>/g, ''));
    if (endMs <= startMs || textLines.length === 0) continue;
    cues.push({ id: makeId(), startMs, endMs, text: textLines.join('\n'), speaker: null });
  }
  return cues;
}
