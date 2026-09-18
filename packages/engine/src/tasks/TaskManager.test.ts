import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../db/database';
import { EventBus } from '../events/EventBus';
import { LogHub } from '../logging/logger';
import { cleanup, tempDir } from '../test/helpers';
import { TaskManager } from './TaskManager';

let dir: string;
let db: AppDatabase;

function setup() {
  dir = tempDir();
  db = openDatabase(path.join(dir, 'tasks.db'));
  const bus = new EventBus();
  const logs = new LogHub({ dir: path.join(dir, 'logs'), level: 'debug' });
  const tm = new TaskManager(db.tasks, bus, logs.logger);
  return { tm, bus };
}

afterEach(() => {
  db?.close();
  cleanup(dir);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('TaskManager', () => {
  it('runs tasks to completion with progress and persistence', async () => {
    const { tm, bus } = setup();
    const progress: number[] = [];
    bus.on('task.progress', (p) => progress.push(p.progress));
    tm.registerKind<{ n: number }, number>({
      kind: 'sum',
      run: async (ctx) => {
        let s = 0;
        for (let i = 1; i <= ctx.params.n; i++) {
          s += i;
          ctx.progress(i / ctx.params.n, `step ${i}`);
          await ctx.checkpoint();
        }
        return s;
      },
    });
    const result = await tm.run<{ n: number }, number>({ kind: 'sum', params: { n: 10 }, title: 'Sum' });
    expect(result).toBe(55);
    const info = tm.list({ includeFinished: true })[0]!;
    expect(info.status).toBe('done');
    expect(info.progress).toBe(1);
    expect(db.tasks.get(info.id)?.status).toBe('done');
  });

  it('reports failures as AppError info without crashing the manager', async () => {
    const { tm } = setup();
    tm.registerKind({ kind: 'boom', run: async () => { throw Object.assign(new Error('no space left'), { code: 'ENOSPC' }); } });
    const task = tm.enqueue({ kind: 'boom', params: {} });
    const done = await tm.wait(task.id);
    expect(done.status).toBe('failed');
    expect(done.error?.code).toBe('DISK_FULL');
    expect(done.error?.recovery.some((r) => r.kind === 'free-disk')).toBe(true);
  });

  it('cancels a running task', async () => {
    const { tm } = setup();
    tm.registerKind({
      kind: 'slow',
      run: async (ctx) => {
        for (let i = 0; i < 100; i++) {
          await sleep(10);
          await ctx.checkpoint();
        }
        return 'finished';
      },
    });
    const task = tm.enqueue({ kind: 'slow', params: {} });
    await sleep(30);
    await tm.cancel(task.id);
    const done = await tm.wait(task.id);
    expect(done.status).toBe('cancelled');
  });

  it('pauses and resumes a cooperative task', async () => {
    const { tm } = setup();
    let ticks = 0;
    tm.registerKind({
      kind: 'ticker',
      pausable: true,
      run: async (ctx) => {
        for (let i = 0; i < 20; i++) {
          await sleep(5);
          ticks++;
          await ctx.checkpoint();
        }
        return ticks;
      },
    });
    const task = tm.enqueue({ kind: 'ticker', params: {} });
    await sleep(25);
    await tm.pause(task.id);
    const paused = ticks;
    await sleep(50);
    expect(ticks).toBeLessThanOrEqual(paused + 1);
    expect(tm.get(task.id)?.status).toBe('paused');
    await tm.resume(task.id);
    const done = await tm.wait(task.id);
    expect(done.status).toBe('done');
    expect(ticks).toBe(20);
  });

  it('refuses to pause non-pausable tasks with a clear error', async () => {
    const { tm } = setup();
    tm.registerKind({ kind: 'np', pausable: false, run: async () => { await sleep(60); return 1; } });
    const task = tm.enqueue({ kind: 'np', params: {} });
    await sleep(10);
    await expect(tm.pause(task.id)).rejects.toMatchObject({ info: { code: 'TASK_NOT_PAUSABLE' } });
    await tm.wait(task.id);
  });

  it('honors priority and lane concurrency', async () => {
    const { tm } = setup();
    tm.setConcurrency('default', 1);
    const order: string[] = [];
    tm.registerKind<{ name: string }, void>({ kind: 'ord', run: async (ctx) => { order.push(ctx.params.name); await sleep(5); } });
    tm.registerKind({ kind: 'blocker', run: async () => { await sleep(30); } });
    tm.enqueue({ kind: 'blocker', params: {} });
    const low = tm.enqueue({ kind: 'ord', params: { name: 'low' }, priority: 0 });
    const high = tm.enqueue({ kind: 'ord', params: { name: 'high' }, priority: 10 });
    await Promise.all([tm.wait(low.id), tm.wait(high.id)]);
    expect(order).toEqual(['high', 'low']);
  });

  it('retries failed tasks and recovers interrupted ones after restart', async () => {
    const { tm } = setup();
    let attempts = 0;
    tm.registerKind({ kind: 'flaky', run: async () => { attempts++; if (attempts === 1) throw new Error('first try fails'); return 'ok'; } });
    const task = tm.enqueue({ kind: 'flaky', params: {} });
    expect((await tm.wait(task.id)).status).toBe('failed');
    tm.retry(task.id);
    const done = await tm.wait(task.id);
    expect(done.status).toBe('done');
    expect(done.attempts).toBe(2);
    db.tasks.upsert({ ...done, id: 'tsk_zombie', status: 'running' });
    const bus2 = new EventBus();
    const tm2 = new TaskManager(db.tasks, bus2, new LogHub({ dir: path.join(dir, 'logs2') }).logger);
    expect(tm2.recoverFromPreviousRun()).toEqual(['tsk_zombie']);
    expect(tm2.get('tsk_zombie')?.status).toBe('interrupted');
  });
});
