import { newId } from '@sevenvid/core';
import type { TaskInfo, TaskStatus } from '@sevenvid/ipc';
import type { TasksRepo } from '../db/repos/tasks';
import { AppError } from '../errors';
import type { EventBus } from '../events/EventBus';
import type { Logger } from '../logging/logger';

export type TaskLane = 'default' | 'render' | 'ai' | 'io';

export interface PauseHandlers {
  pause: () => void | Promise<void>;
  resume: () => void | Promise<void>;
}

export interface TaskContext<P = Record<string, unknown>> {
  readonly taskId: string;
  readonly params: P;
  readonly signal: AbortSignal;
  readonly logger: Logger;
  readonly isCancelled: boolean;
  readonly isPaused: boolean;
  /** Reports progress in [0, 1] with an optional message and ETA (ms). */
  progress(value: number, message?: string | null, etaMs?: number | null): void;
  /** Cooperative pause/cancel point: resolves when running, waits while paused, throws when cancelled. */
  checkpoint(): Promise<void>;
  /** Lets long-running child processes support pause/resume (e.g. SIGSTOP/SIGCONT). */
  setPauseHandlers(handlers: PauseHandlers | null): void;
  setCancelHandler(handler: (() => void | Promise<void>) | null): void;
  /** Enqueues a child task and waits for it. */
  runChild<CP, CR>(opts: EnqueueOptions<CP>): Promise<CR>;
}

export interface TaskKindSpec<P = Record<string, unknown>, R = unknown> {
  kind: string;
  lane?: TaskLane;
  cancellable?: boolean;
  pausable?: boolean;
  title?: (params: P) => string;
  run: (ctx: TaskContext<P>) => Promise<R>;
}

export interface EnqueueOptions<P = Record<string, unknown>> {
  kind: string;
  params: P;
  title?: string;
  projectId?: string | null;
  parentTaskId?: string | null;
  priority?: number;
}

interface Running {
  controller: AbortController;
  pauseHandlers: PauseHandlers | null;
  cancelHandler: (() => void | Promise<void>) | null;
  pauseGate: { promise: Promise<void>; resolve: () => void } | null;
  promise: Promise<void>;
  lastPersist: number;
  lastEmit: number;
  startedAt: number;
}

export class TaskManager {
  private readonly kinds = new Map<string, TaskKindSpec<never, unknown>>();
  private readonly tasks = new Map<string, TaskInfo>();
  private readonly running = new Map<string, Running>();
  private readonly waiters = new Map<string, Array<{ resolve: (t: TaskInfo) => void; reject: (e: unknown) => void }>>();
  private concurrency: Record<TaskLane, number> = { default: 2, render: 1, ai: 1, io: 2 };
  private scheduling = false;
  private stopped = false;

  constructor(
    private readonly repo: TasksRepo,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {
    for (const t of repo.list({ includeFinished: true, limit: 500 })) this.tasks.set(t.id, t);
  }

  /** Marks tasks left over from a previous process as interrupted (called once at startup). */
  recoverFromPreviousRun(): string[] {
    const ids = this.repo.markInterrupted();
    for (const id of ids) {
      const t = this.repo.get(id);
      if (t) {
        this.tasks.set(id, t);
        this.bus.emit('task.updated', t);
      }
    }
    if (ids.length) this.logger.warn({ module: 'tasks', operation: 'recover', count: ids.length }, 'interrupted tasks from previous run');
    return ids;
  }

  setConcurrency(lane: TaskLane, n: number): void {
    this.concurrency[lane] = Math.max(1, n);
    this.schedule();
  }

  registerKind<P, R>(spec: TaskKindSpec<P, R>): void {
    this.kinds.set(spec.kind, spec as unknown as TaskKindSpec<never, unknown>);
  }

  hasKind(kind: string): boolean {
    return this.kinds.has(kind);
  }

  enqueue<P>(opts: EnqueueOptions<P>): TaskInfo {
    const spec = this.kinds.get(opts.kind) as TaskKindSpec<P, unknown> | undefined;
    if (!spec) throw new AppError({ code: 'TASK_KIND_UNKNOWN', operation: 'tasks.enqueue', message: `Unknown task kind ${opts.kind}`, details: { kind: opts.kind } });
    const task: TaskInfo = {
      id: newId('tsk'),
      kind: opts.kind,
      title: opts.title ?? spec.title?.(opts.params) ?? opts.kind,
      projectId: opts.projectId ?? null,
      parentTaskId: opts.parentTaskId ?? null,
      status: 'queued',
      priority: opts.priority ?? 0,
      progress: 0,
      progressMessage: null,
      etaMs: null,
      params: (opts.params ?? {}) as Record<string, unknown>,
      result: null,
      error: null,
      attempts: 0,
      cancellable: spec.cancellable ?? true,
      pausable: spec.pausable ?? false,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    };
    this.tasks.set(task.id, task);
    this.persist(task);
    this.bus.emit('task.updated', task);
    this.schedule();
    return task;
  }

  /** Enqueues a task and resolves with its final state (rejects with the task error when it fails). */
  async run<P, R>(opts: EnqueueOptions<P>): Promise<R> {
    const task = this.enqueue(opts);
    const done = await this.wait(task.id);
    if (done.status === 'done') return done.result as R;
    throw new AppError({
      code: done.status === 'cancelled' ? 'TASK_CANCELLED' : (done.error?.code as never) ?? 'UNKNOWN',
      operation: `task:${done.kind}`,
      message: done.error?.message ?? `Task ${done.kind} ended with status ${done.status}`,
      details: { taskId: done.id },
    });
  }

  wait(taskId: string): Promise<TaskInfo> {
    const t = this.tasks.get(taskId);
    if (!t) return Promise.reject(new AppError({ code: 'TASK_NOT_FOUND', operation: 'tasks.wait', message: `Task ${taskId} not found` }));
    if (isFinal(t.status)) return Promise.resolve(t);
    return new Promise((resolve, reject) => {
      const list = this.waiters.get(taskId) ?? [];
      list.push({ resolve, reject });
      this.waiters.set(taskId, list);
    });
  }

  get(taskId: string): TaskInfo | undefined {
    return this.tasks.get(taskId);
  }

  list(opts: { projectId?: string | null; includeFinished?: boolean; limit?: number } = {}): TaskInfo[] {
    let all = [...this.tasks.values()];
    if (opts.projectId) all = all.filter((t) => t.projectId === opts.projectId);
    if (!opts.includeFinished) all = all.filter((t) => !isFinal(t.status));
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return all.slice(0, opts.limit ?? 200);
  }

  async cancel(taskId: string): Promise<TaskInfo> {
    const task = this.require(taskId);
    if (isFinal(task.status)) return task;
    if (!task.cancellable) throw new AppError({ code: 'TASK_NOT_CANCELLABLE', operation: 'tasks.cancel', message: `Task ${task.kind} cannot be cancelled` });
    const running = this.running.get(taskId);
    this.update(task, { status: 'cancelled', finishedAt: new Date().toISOString(), progressMessage: null, etaMs: null });
    if (running) {
      running.pauseGate?.resolve();
      running.controller.abort(new AppError({ code: 'TASK_CANCELLED', operation: 'tasks.cancel', message: 'cancelled by user' }));
      try {
        await running.cancelHandler?.();
      } catch (err) {
        this.logger.warn({ module: 'tasks', taskId, err }, 'cancel handler failed');
      }
    }
    this.settleWaiters(task);
    this.schedule();
    return task;
  }

  async pause(taskId: string): Promise<TaskInfo> {
    const task = this.require(taskId);
    if (task.status === 'queued') {
      this.update(task, { status: 'paused' });
      return task;
    }
    if (task.status !== 'running') throw new AppError({ code: 'TASK_INVALID_STATE', operation: 'tasks.pause', message: `Task is ${task.status}` });
    const running = this.running.get(taskId);
    if (!task.pausable || !running) throw new AppError({ code: 'TASK_NOT_PAUSABLE', operation: 'tasks.pause', message: `Task ${task.kind} does not support pausing`, details: { kind: task.kind } });
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    running.pauseGate = { promise, resolve };
    this.update(task, { status: 'paused' });
    try {
      await running.pauseHandlers?.pause();
    } catch (err) {
      this.logger.warn({ module: 'tasks', taskId, err }, 'pause handler failed');
    }
    return task;
  }

  async resume(taskId: string): Promise<TaskInfo> {
    const task = this.require(taskId);
    if (task.status !== 'paused') throw new AppError({ code: 'TASK_INVALID_STATE', operation: 'tasks.resume', message: `Task is ${task.status}` });
    const running = this.running.get(taskId);
    if (!running) {
      this.update(task, { status: 'queued' });
      this.schedule();
      return task;
    }
    this.update(task, { status: 'running' });
    try {
      await running.pauseHandlers?.resume();
    } catch (err) {
      this.logger.warn({ module: 'tasks', taskId, err }, 'resume handler failed');
    }
    running.pauseGate?.resolve();
    running.pauseGate = null;
    return task;
  }

  retry(taskId: string): TaskInfo {
    const task = this.require(taskId);
    if (!isFinal(task.status) || task.status === 'done') throw new AppError({ code: 'TASK_INVALID_STATE', operation: 'tasks.retry', message: `Task is ${task.status}` });
    if (!this.kinds.has(task.kind)) throw new AppError({ code: 'TASK_KIND_UNKNOWN', operation: 'tasks.retry', message: `Unknown task kind ${task.kind}` });
    this.update(task, { status: 'queued', progress: 0, progressMessage: null, etaMs: null, error: null, result: null, startedAt: null, finishedAt: null });
    this.schedule();
    return task;
  }

  setPriority(taskId: string, priority: number): TaskInfo {
    const task = this.require(taskId);
    this.update(task, { priority });
    this.schedule();
    return task;
  }

  clearFinished(): number {
    let removed = 0;
    for (const [id, t] of this.tasks) {
      if (isFinal(t.status)) {
        this.tasks.delete(id);
        removed++;
      }
    }
    this.repo.clearFinished();
    return removed;
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    const ids = [...this.running.keys()];
    for (const id of ids) {
      const t = this.tasks.get(id);
      if (t && t.cancellable) {
        try {
          await this.cancel(id);
        } catch {
          /* ignore */
        }
      }
    }
    await Promise.allSettled([...this.running.values()].map((r) => r.promise));
  }

  private require(taskId: string): TaskInfo {
    const t = this.tasks.get(taskId);
    if (!t) throw new AppError({ code: 'TASK_NOT_FOUND', operation: 'tasks', message: `Task ${taskId} not found` });
    return t;
  }

  private update(task: TaskInfo, patch: Partial<TaskInfo>): void {
    Object.assign(task, patch);
    this.persist(task);
    this.bus.emit('task.updated', { ...task });
  }

  private persist(task: TaskInfo): void {
    try {
      this.repo.upsert(task);
    } catch (err) {
      this.logger.error({ module: 'tasks', taskId: task.id, err }, 'failed to persist task');
    }
  }

  private laneOf(kind: string): TaskLane {
    return this.kinds.get(kind)?.lane ?? 'default';
  }

  private schedule(): void {
    if (this.scheduling || this.stopped) return;
    this.scheduling = true;
    try {
      const runningByLane: Record<TaskLane, number> = { default: 0, render: 0, ai: 0, io: 0 };
      for (const id of this.running.keys()) {
        const t = this.tasks.get(id);
        if (t) runningByLane[this.laneOf(t.kind)]++;
      }
      const queued = [...this.tasks.values()]
        .filter((t) => t.status === 'queued')
        .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
      for (const task of queued) {
        const lane = this.laneOf(task.kind);
        if (runningByLane[lane] >= this.concurrency[lane]) continue;
        runningByLane[lane]++;
        this.start(task);
      }
    } finally {
      this.scheduling = false;
    }
  }

  private start(task: TaskInfo): void {
    const spec = this.kinds.get(task.kind)!;
    const controller = new AbortController();
    const state: Running = { controller, pauseHandlers: null, cancelHandler: null, pauseGate: null, promise: Promise.resolve(), lastPersist: 0, lastEmit: 0, startedAt: Date.now() };
    this.running.set(task.id, state);
    this.update(task, { status: 'running', startedAt: new Date().toISOString(), attempts: task.attempts + 1, error: null });
    const logger = this.logger.child({ module: 'tasks', taskId: task.id, operation: task.kind });
    const ctx: TaskContext<unknown> = {
      taskId: task.id,
      params: task.params,
      signal: controller.signal,
      logger,
      get isCancelled() {
        return controller.signal.aborted;
      },
      get isPaused() {
        return state.pauseGate != null;
      },
      progress: (value, message, etaMs) => {
        if (controller.signal.aborted) return;
        const p = Math.max(0, Math.min(1, value));
        task.progress = p;
        if (message !== undefined) task.progressMessage = message;
        const elapsed = Date.now() - state.startedAt;
        task.etaMs = etaMs !== undefined && etaMs !== null ? etaMs : p > 0.05 ? Math.round((elapsed * (1 - p)) / p) : null;
        const now = Date.now();
        if (now - state.lastEmit > 250) {
          state.lastEmit = now;
          this.bus.emit('task.progress', { taskId: task.id, progress: p, message: task.progressMessage, etaMs: task.etaMs });
        }
        if (now - state.lastPersist > 1000) {
          state.lastPersist = now;
          this.persist(task);
        }
      },
      checkpoint: async () => {
        if (controller.signal.aborted) throw controller.signal.reason ?? new AppError({ code: 'TASK_CANCELLED', operation: task.kind, message: 'cancelled' });
        if (state.pauseGate) await state.pauseGate.promise;
        if (controller.signal.aborted) throw controller.signal.reason ?? new AppError({ code: 'TASK_CANCELLED', operation: task.kind, message: 'cancelled' });
      },
      setPauseHandlers: (handlers) => {
        state.pauseHandlers = handlers;
      },
      setCancelHandler: (handler) => {
        state.cancelHandler = handler;
      },
      runChild: (opts) => this.run({ ...opts, parentTaskId: task.id, projectId: opts.projectId ?? task.projectId }),
    };
    state.promise = (async () => {
      const t0 = Date.now();
      try {
        const result = await spec.run(ctx as never);
        if (task.status === 'cancelled') return;
        this.update(task, { status: 'done', progress: 1, result: result ?? null, finishedAt: new Date().toISOString(), etaMs: null });
        logger.info({ durationMs: Date.now() - t0, status: 'done' }, 'task done');
      } catch (err) {
        if (task.status === 'cancelled' || controller.signal.aborted) {
          if (task.status !== 'cancelled') this.update(task, { status: 'cancelled', finishedAt: new Date().toISOString() });
          logger.info({ durationMs: Date.now() - t0, status: 'cancelled' }, 'task cancelled');
          return;
        }
        const appErr = AppError.from(err, { code: 'UNKNOWN', operation: task.kind });
        appErr.info.logRef = task.id;
        this.update(task, { status: 'failed', error: appErr.info, finishedAt: new Date().toISOString(), etaMs: null });
        logger.error({ err: appErr.info, errorId: appErr.info.errorId, durationMs: Date.now() - t0, status: 'failed' }, 'task failed');
        this.bus.emit('error', appErr.info);
      } finally {
        this.running.delete(task.id);
        this.settleWaiters(task);
        this.schedule();
      }
    })();
  }

  private settleWaiters(task: TaskInfo): void {
    const list = this.waiters.get(task.id);
    if (!list) return;
    this.waiters.delete(task.id);
    for (const w of list) w.resolve({ ...task });
  }
}

export function isFinal(status: TaskStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled' || status === 'interrupted';
}
