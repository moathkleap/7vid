import { useTranslation } from 'react-i18next';
import { Pause, Play, RotateCcw, Trash2, X, XCircle } from 'lucide-react';
import type { TaskInfo } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { formatEta } from '@/lib/format';
import { Badge, type BadgeTone } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { Progress } from '../ui/Input';
import { EmptyState } from '../ui/Misc';

const tone: Record<TaskInfo['status'], BadgeTone> = { queued: 'neutral', running: 'accent', paused: 'warning', done: 'success', failed: 'danger', cancelled: 'neutral', interrupted: 'warning' };

export function TaskRow({ task }: { task: TaskInfo }) {
  const { t } = useTranslation();
  const reportError = useAppStore((s) => s.reportError);
  const showError = useAppStore((s) => s.showError);
  const call = async (channel: 'tasks.cancel' | 'tasks.pause' | 'tasks.resume' | 'tasks.retry') => {
    try {
      await getApi().invoke(channel, { taskId: task.id });
    } catch (err) {
      reportError(err);
    }
  };
  const active = task.status === 'running' || task.status === 'queued' || task.status === 'paused';
  return (
    <li className="rounded-lg border border-border bg-surface-2 p-3" data-testid="task-row" data-task-status={task.status}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-text">{task.title}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted">
            <Badge tone={tone[task.status]} dot>{t(`tasks.status.${task.status}`)}</Badge>
            {task.progressMessage ? <span className="truncate">{task.progressMessage}</span> : null}
            {task.status === 'running' && task.etaMs != null ? <span>{t('tasks.eta', { eta: formatEta(task.etaMs) })}</span> : null}
          </div>
        </div>
        {task.status === 'running' && task.pausable ? <IconButton size="sm" action="task.pause" label={t('tasks.pause')} onClick={() => void call('tasks.pause')}><Pause /></IconButton> : null}
        {task.status === 'paused' ? <IconButton size="sm" action="task.resume" label={t('tasks.resume')} onClick={() => void call('tasks.resume')}><Play /></IconButton> : null}
        {active && task.cancellable ? <IconButton size="sm" action="task.cancel" label={t('tasks.cancel')} onClick={() => void call('tasks.cancel')}><XCircle /></IconButton> : null}
        {(task.status === 'failed' || task.status === 'cancelled' || task.status === 'interrupted') ? <IconButton size="sm" action="task.retry" label={t('tasks.retry')} onClick={() => void call('tasks.retry')}><RotateCcw /></IconButton> : null}
      </div>
      {active ? <Progress value={task.progress} className="mt-2" tone={task.status === 'paused' ? 'warning' : 'accent'} /> : null}
      {task.error ? (
        <button type="button" data-action="task.error" className="mt-2 text-start text-[12px] text-danger hover:underline" onClick={() => showError(task.error)}>
          {t(task.error.userMessageKey, task.error.userMessageParams)} · {task.error.errorId}
        </button>
      ) : null}
    </li>
  );
}

export function TasksPanel() {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.tasksPanelOpen);
  const setOpen = useAppStore((s) => s.setTasksPanelOpen);
  const tasks = useAppStore((s) => s.tasks);
  const reportError = useAppStore((s) => s.reportError);
  if (!open) return null;
  const list = Object.values(tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const clear = async () => {
    try {
      await getApi().invoke('tasks.clearFinished');
      useAppStore.setState((s) => ({ tasks: Object.fromEntries(Object.entries(s.tasks).filter(([, x]) => x.status === 'running' || x.status === 'queued' || x.status === 'paused')) }));
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <aside className="fixed bottom-8 end-0 top-14 z-30 flex w-96 flex-col border-s border-border bg-surface shadow-[var(--shadow)] animate-fade-in" data-testid="tasks-panel">
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold">{t('tasks.title')}</h2>
        <div className="flex items-center gap-1">
          <Button action="tasks.clear" size="sm" variant="ghost" icon={<Trash2 />} onClick={() => void clear()}>{t('tasks.clear')}</Button>
          <IconButton action="tasks.close" label={t('common.close')} size="sm" onClick={() => setOpen(false)}><X /></IconButton>
        </div>
      </div>
      <ul className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {list.length === 0 ? <EmptyState title={t('tasks.empty')} /> : list.map((task) => <TaskRow key={task.id} task={task} />)}
      </ul>
    </aside>
  );
}
