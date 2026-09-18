export function nowIso(): string {
  return new Date().toISOString();
}

export function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === '1';
}

export function fromBool(v: boolean): number {
  return v ? 1 : 0;
}

export function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || v === '') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

export function num(v: unknown): number | null {
  return v == null ? null : Number(v);
}
