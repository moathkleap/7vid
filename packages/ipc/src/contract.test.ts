import { describe, expect, it } from 'vitest';
import { channels, events, isChannel, isEvent } from './contract';

describe('ipc contract', () => {
  it('validates inputs with zod', () => {
    expect(channels['projects.create'].input.safeParse({ name: '' }).success).toBe(false);
    expect(channels['projects.create'].input.safeParse({ name: 'x' }).success).toBe(true);
    expect(channels['tasks.cancel'].input.safeParse({}).success).toBe(false);
  });
  it('knows its channel and event names', () => {
    expect(isChannel('projects.list')).toBe(true);
    expect(isChannel('nope')).toBe(false);
    expect(isEvent('task.updated')).toBe(true);
    expect(Object.keys(events).length).toBeGreaterThan(5);
  });
});
