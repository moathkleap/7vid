/** All timeline positions and durations are integer milliseconds. */
export interface Fraction {
  num: number;
  den: number;
}

export const FPS_24: Fraction = { num: 24, den: 1 };
export const FPS_25: Fraction = { num: 25, den: 1 };
export const FPS_30: Fraction = { num: 30, den: 1 };
export const FPS_29_97: Fraction = { num: 30000, den: 1001 };
export const FPS_60: Fraction = { num: 60, den: 1 };

export function fpsToNumber(fps: Fraction): number {
  return fps.den === 0 ? 0 : fps.num / fps.den;
}

export function parseFps(value: string | number | null | undefined): Fraction | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return numberToFps(value);
  }
  const s = value.trim();
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m) {
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (num > 0 && den > 0) return { num, den };
    return null;
  }
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return numberToFps(n);
  return null;
}

export function numberToFps(n: number): Fraction {
  if (Math.abs(n - 29.97) < 0.01) return FPS_29_97;
  if (Math.abs(n - 59.94) < 0.01) return { num: 60000, den: 1001 };
  if (Math.abs(n - 23.976) < 0.01) return { num: 24000, den: 1001 };
  if (Number.isInteger(n)) return { num: n, den: 1 };
  return { num: Math.round(n * 1000), den: 1000 };
}

export function frameDurationMs(fps: Fraction): number {
  return 1000 / fpsToNumber(fps);
}

export function msToFrame(ms: number, fps: Fraction): number {
  return Math.round((ms / 1000) * fpsToNumber(fps));
}

export function frameToMs(frame: number, fps: Fraction): number {
  return Math.round((frame / fpsToNumber(fps)) * 1000);
}

/** Snaps a millisecond position to the nearest frame boundary of the sequence. */
export function snapToFrame(ms: number, fps: Fraction): number {
  return frameToMs(msToFrame(ms, fps), fps);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pad(n: number, width = 2): string {
  return String(Math.floor(n)).padStart(width, '0');
}

/** Formats milliseconds as HH:MM:SS.mmm (or MM:SS.mmm when hours are zero). */
export function formatMs(ms: number, opts: { alwaysHours?: boolean; millis?: boolean } = {}): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const base = h > 0 || opts.alwaysHours ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return opts.millis === false ? base : `${base}.${pad(millis, 3)}`;
}

/** Formats milliseconds as SMPTE-like timecode HH:MM:SS:FF for the given fps. */
export function formatTimecode(ms: number, fps: Fraction): string {
  const total = Math.max(0, ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const frame = Math.floor(((total % 1000) / 1000) * fpsToNumber(fps));
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frame)}`;
}

/** Formats milliseconds as an SRT timestamp HH:MM:SS,mmm */
export function formatSrtTime(ms: number): string {
  return formatMs(ms, { alwaysHours: true }).replace('.', ',');
}

/** Formats milliseconds as a WebVTT timestamp HH:MM:SS.mmm */
export function formatVttTime(ms: number): string {
  return formatMs(ms, { alwaysHours: true });
}

/** Formats milliseconds as an ASS timestamp H:MM:SS.cc */
export function formatAssTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/**
 * Parses flexible time expressions into milliseconds.
 * Accepts: "90", "1:30", "01:30.5", "1:02:03", "1:02:03,250", "1h2m3s", "2m", "45s", "1.5s", "500ms".
 * Returns null when the text is not a time expression.
 */
export function parseTimeExpression(input: string): number | null {
  const s = normalizeDigits(input).trim().toLowerCase();
  if (!s) return null;
  const hms = /^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?(?:[.,](\d{1,3}))?$/.exec(s);
  if (hms) {
    const a = Number(hms[1]);
    const b = Number(hms[2]);
    const c = hms[3] != null ? Number(hms[3]) : null;
    const frac = hms[4] != null ? Number(hms[4].padEnd(3, '0')) : 0;
    if (c == null) return (a * 60 + b) * 1000 + frac;
    return (a * 3600 + b * 60 + c) * 1000 + frac;
  }
  const units = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m(?!s))?\s*(?:(\d+(?:\.\d+)?)\s*s)?\s*(?:(\d+)\s*ms)?$/.exec(
    s,
  );
  if (units && (units[1] || units[2] || units[3] || units[4])) {
    const h = units[1] ? Number(units[1]) : 0;
    const m = units[2] ? Number(units[2]) : 0;
    const sec = units[3] ? Number(units[3]) : 0;
    const ms = units[4] ? Number(units[4]) : 0;
    return Math.round(h * 3_600_000 + m * 60_000 + sec * 1000 + ms);
  }
  const plain = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (plain) return Math.round(Number(plain[1]) * 1000);
  return null;
}

/** Converts Arabic-Indic (٠-٩) and Persian (۰-۹) digits to ASCII digits. */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[،]/g, ',')
    .replace(/[٫]/g, '.')
    .replace(/[٬]/g, ',');
}
