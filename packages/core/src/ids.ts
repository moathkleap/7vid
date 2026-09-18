import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

/** Generates a sortable, unique identifier (ULID) optionally prefixed for readability. */
export function newId(prefix?: string): string {
  const id = ulid();
  return prefix ? `${prefix}_${id}` : id;
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 26;
}
