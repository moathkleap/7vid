import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppErrorInfo } from '@sevenvid/core';
import type { TaskInfo } from '@sevenvid/ipc';
import { useEvent } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';

export interface TaskRunner<T> {
  /** Starts a task through the given API call and follows it until it finishes. */
  run: (start: () => Promise<TaskInfo>) => Promise<void>;
  running: boolean;
  progress: number;
  message: string | null;
  result: T | null;
  error: AppErrorInfo | null;
  task: TaskInfo | undefined;
  reset: () => void;
}

/** Follows one engine task at a time: progress from task events, typed result when done, error when failed. */
export function useTaskRunner<T>(onDone?: (result: T) => void): TaskRunner<T> {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<AppErrorInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const idRef = useRef<string | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  const task = useAppStore((s) => (taskId ? s.tasks[taskId] : undefined));
  useEvent(
    'task.updated',
    useCallback((t: TaskInfo) => {
      if (t.id !== idRef.current) return;
      if (t.status === 'done') {
        setResult(t.result as T);
        onDoneRef.current?.(t.result as T);
      } else if (t.status === 'failed' || t.status === 'cancelled' || t.status === 'interrupted') {
        setError(t.error ?? { errorId: '', code: t.status.toUpperCase(), module: 'tasks', operation: t.kind, message: t.status, userMessageKey: `errors.task${t.status[0]!.toUpperCase()}${t.status.slice(1)}`, userMessageParams: {}, retryable: true, recovery: [], logRef: null, cause: null, details: {}, at: new Date().toISOString() });
      }
    }, []),
  );
  const run = useCallback(async (start: () => Promise<TaskInfo>) => {
    setResult(null);
    setError(null);
    setStarting(true);
    try {
      const t = await start();
      idRef.current = t.id;
      setTaskId(t.id);
      if (t.status === 'done') {
        setResult(t.result as T);
        onDoneRef.current?.(t.result as T);
      } else if (t.status === 'failed') setError(t.error);
    } catch (err) {
      useAppStore.getState().reportError(err);
    } finally {
      setStarting(false);
    }
  }, []);
  const reset = useCallback(() => {
    idRef.current = null;
    setTaskId(null);
    setResult(null);
    setError(null);
  }, []);
  const running = starting || Boolean(task && (task.status === 'queued' || task.status === 'running' || task.status === 'paused'));
  return { run, running, progress: task?.progress ?? 0, message: task?.progressMessage ?? null, result, error, task, reset };
}
