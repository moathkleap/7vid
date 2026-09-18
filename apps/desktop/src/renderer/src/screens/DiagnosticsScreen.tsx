import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive } from 'lucide-react';
import type { LogEntry, NetworkLogEntry } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useEvent } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { formatBytes, formatDate } from '@/lib/format';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { EmptyState, PageHeader, Tabs } from '@/components/ui/Misc';
import { TaskRow } from '@/components/dialogs/TasksPanel';
import { cn } from '@/lib/cn';

type Tab = 'logs' | 'errors' | 'tasks' | 'network';
const levelTone: Record<string, BadgeTone> = { trace: 'neutral', debug: 'neutral', info: 'info', warn: 'warning', error: 'danger', fatal: 'danger' };

export function DiagnosticsScreen() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('logs');
  const [level, setLevel] = useState('info');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [network, setNetwork] = useState<NetworkLogEntry[]>([]);
  const [bundle, setBundle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errors = useAppStore((s) => s.errors);
  const tasks = useAppStore((s) => s.tasks);
  const showError = useAppStore((s) => s.showError);
  const reportError = useAppStore((s) => s.reportError);
  useEffect(() => {
    getApi().invoke('logs.tail', { limit: 400, level }).then(setLogs).catch(reportError);
  }, [level, reportError]);
  useEffect(() => {
    if (tab === 'network') getApi().invoke('network.recent', { limit: 300 }).then(setNetwork).catch(reportError);
  }, [tab, reportError]);
  useEvent('log', (entry) => {
    const min = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].indexOf(level);
    if (['trace', 'debug', 'info', 'warn', 'error', 'fatal'].indexOf(entry.level) < min) return;
    setLogs((prev) => [...prev.slice(-599), entry]);
  });
  const exportBundle = async () => {
    setBusy(true);
    try {
      const r = await getApi().invoke('diagnostics.exportBundle', {});
      setBundle(r.path);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  const taskList = Object.values(tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('diagnostics.title')} subtitle={t('diagnostics.subtitle')} actions={<Button action="diagnostics.exportBundle" icon={<Archive />} loading={busy} onClick={() => void exportBundle()}>{t('diagnostics.exportBundle')}</Button>} />
      {bundle ? <div className="mb-4 rounded-lg border border-success/40 bg-success/10 px-4 py-2 text-[13px]" data-testid="diagnostics-bundle-path" dir="ltr">{t('diagnostics.bundleSaved', { path: bundle })}</div> : null}
      <Tabs tabs={[{ id: 'logs', label: t('diagnostics.logs') }, { id: 'errors', label: t('diagnostics.errors'), count: errors.length }, { id: 'tasks', label: t('diagnostics.tasks'), count: taskList.length }, { id: 'network', label: t('diagnostics.network') }]} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'logs' ? (
          <>
            <div className="mb-3 flex items-center gap-3">
              <span className="text-[13px] text-muted">{t('diagnostics.level')}</span>
              <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-32" data-testid="diagnostics-level">{['debug', 'info', 'warn', 'error'].map((l) => <option key={l} value={l}>{l}</option>)}</Select>
              <Badge tone="success" dot>{t('diagnostics.live')}</Badge>
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-border bg-surface font-mono text-[12px]" dir="ltr" data-testid="diagnostics-logs">
              {logs.length === 0 ? <EmptyState title={t('diagnostics.empty')} className="m-4" /> : logs.map((e, i) => (
                <div key={`${e.time}-${i}`} className={cn('flex gap-3 border-b border-border px-3 py-1.5', e.level === 'error' && 'bg-danger/5')}>
                  <span className="shrink-0 text-faint">{e.time.slice(11, 23)}</span>
                  <Badge tone={levelTone[e.level] ?? 'neutral'} className="shrink-0">{e.level}</Badge>
                  <span className="shrink-0 text-accent">{e.module ?? '-'}</span>
                  <span className="min-w-0 flex-1 truncate text-text" title={e.msg}>{e.operation ? `${e.operation} · ` : ''}{e.msg}{e.durationMs != null ? ` (${e.durationMs} ms)` : ''}</span>
                  {e.errorId ? <span className="shrink-0 text-danger">{e.errorId}</span> : null}
                </div>
              ))}
            </div>
          </>
        ) : null}
        {tab === 'errors' ? (
          errors.length === 0 ? <EmptyState title={t('diagnostics.empty')} /> : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface" data-testid="diagnostics-errors">
              {errors.map((e) => (
                <li key={e.errorId}>
                  <button type="button" data-action="diagnostics.error" className="focus-ring flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-surface-2" onClick={() => showError(e)}>
                    <Badge tone="danger">{e.code}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm">{t(e.userMessageKey, e.userMessageParams)} — <span className="text-muted">{e.message}</span></span>
                    <span className="shrink-0 font-mono text-[11.5px] text-faint">{e.errorId}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {tab === 'tasks' ? (taskList.length === 0 ? <EmptyState title={t('diagnostics.empty')} /> : <ul className="flex flex-col gap-2">{taskList.map((task) => <TaskRow key={task.id} task={task} />)}</ul>) : null}
        {tab === 'network' ? (
          network.length === 0 ? <EmptyState title={t('diagnostics.noNetwork')} /> : (
            <table className="w-full rounded-xl border border-border bg-surface text-[13px]" data-testid="diagnostics-network">
              <thead className="text-[12px] uppercase tracking-wide text-faint"><tr><th className="px-3 py-2 text-start">Time</th><th className="px-3 py-2 text-start">Host</th><th className="px-3 py-2 text-start">Purpose</th><th className="px-3 py-2 text-start">Provider</th><th className="px-3 py-2 text-end">In / Out</th><th className="px-3 py-2 text-start">Status</th></tr></thead>
              <tbody className="divide-y divide-border">
                {network.map((n) => (
                  <tr key={n.id}><td className="px-3 py-1.5 text-muted">{formatDate(n.ts, i18n.language)}</td><td className="px-3 py-1.5 font-mono" dir="ltr">{n.host}</td><td className="px-3 py-1.5">{n.purpose}</td><td className="px-3 py-1.5">{n.providerId ?? '—'}</td><td className="px-3 py-1.5 text-end">{formatBytes(n.bytesIn)} / {formatBytes(n.bytesOut)}</td><td className="px-3 py-1.5">{n.status}</td></tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
      </div>
    </div>
  );
}
