import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FlaskConical, HardDrive, Play, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import type { ModelStatusInfo, RuntimeStatus, TaskInfo } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useEvent } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { formatBytes } from '@/lib/format';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Progress } from '@/components/ui/Input';
import { PageHeader, StatRow, Tabs } from '@/components/ui/Misc';

type Filter = 'all' | 'installed' | 'recommended';

const STATUS_TONE: Record<ModelStatusInfo['status'], BadgeTone> = { installed: 'success', available: 'neutral', downloading: 'accent', broken: 'danger', partial: 'warning' };

export function ModelsScreen() {
  const { t, i18n } = useTranslation();
  const reportError = useAppStore((s) => s.reportError);
  const pushToast = useAppStore((s) => s.pushToast);
  const tasks = useAppStore((s) => s.tasks);
  const settings = useAppStore((s) => s.settings);
  const [models, setModels] = useState<ModelStatusInfo[] | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [extras, setExtras] = useState<string[]>(['vision', 'audio']);
  const [testing, setTesting] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ModelStatusInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const refresh = useCallback((probe = false) => {
    getApi().invoke('models.list').then(setModels).catch(reportError);
    getApi().invoke('runtime.status', { probe }).then(setRuntime).catch(reportError);
  }, [reportError]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEvent('models.changed', useCallback(() => refresh(), [refresh]));
  useEvent('task.updated', useCallback((task: TaskInfo) => {
    if ((task.kind === 'models.download' || task.kind === 'runtime.setup') && (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled')) refresh(task.kind === 'runtime.setup');
  }, [refresh]));

  const download = async (m: ModelStatusInfo) => {
    try {
      await getApi().invoke('models.download', { modelId: m.spec.id });
      refresh();
    } catch (err) {
      reportError(err);
    }
  };
  const remove = async (m: ModelStatusInfo) => {
    setConfirmRemove(null);
    try {
      await getApi().invoke('models.remove', { modelId: m.spec.id });
      refresh();
    } catch (err) {
      reportError(err);
    }
  };
  const test = async (m: ModelStatusInfo) => {
    setTesting(m.spec.id);
    try {
      const r = await getApi().invoke('models.test', { modelId: m.spec.id });
      pushToast({ level: r.ok ? 'success' : 'warning', titleKey: r.ok ? 'models.testOk' : 'models.testFailed', messageKey: null, params: { name: m.spec.name, message: r.message }, errorId: null, taskId: null });
      refresh();
    } catch (err) {
      reportError(err);
    } finally {
      setTesting(null);
    }
  };
  const setup = async () => {
    try {
      await getApi().invoke('runtime.setup', { extras });
      refresh();
    } catch (err) {
      reportError(err);
    }
  };
  const restart = async () => {
    setProbing(true);
    try {
      setRuntime(await getApi().invoke('runtime.restart'));
      refresh();
    } catch (err) {
      reportError(err);
    } finally {
      setProbing(false);
    }
  };
  const list = (models ?? []).filter((m) => (filter === 'installed' ? m.status === 'installed' || m.status === 'partial' || m.status === 'broken' : filter === 'recommended' ? m.spec.recommended === 'always' : true));
  const setupTask = runtime?.setupTaskId ? tasks[runtime.setupTaskId] : undefined;
  const downloadsAllowed = settings?.privacy.allowModelDownloads !== false;
  const l = i18n.language;
  return (
    <div className="mx-auto max-w-6xl px-8 py-8" data-testid="models-screen">
      <PageHeader title={t('models.title')} subtitle={t('models.subtitle')} actions={<Button action="models.refresh" icon={<RefreshCw />} onClick={() => refresh(true)}>{t('common.refresh')}</Button>} />
      <Card className="mb-6">
        <CardHeader title={<span className="flex items-center gap-2"><Terminal className="size-4" />{t('models.runtime.title')}</span>} actions={runtime?.worker ? <Badge tone="success" dot>{t('models.runtime.workerRunning')}</Badge> : <Badge tone={runtime?.python?.workerInstalled ? 'warning' : 'neutral'} dot>{t('models.runtime.workerStopped')}</Badge>} />
        <CardBody>
          <div className="grid gap-x-8 md:grid-cols-2" data-testid="runtime-card">
            <div>
              <StatRow label={t('models.runtime.python')} value={runtime?.python ? <span dir="ltr">{runtime.python.version} · {runtime.python.source}</span> : t('models.runtime.notFound')} mono />
              <StatRow label={t('models.runtime.venv')} value={<span dir="ltr" className="break-all">{runtime?.venvDir ?? '—'}</span>} mono />
              <StatRow label={t('models.runtime.workerDir')} value={<span dir="ltr" className="break-all">{runtime?.workerSourceDir ?? '—'}</span>} mono />
              <StatRow label={t('models.runtime.device')} value={runtime?.worker?.device ?? '—'} mono />
              {runtime?.lastError ? <StatRow label={t('models.runtime.lastError')} value={<span className="text-danger">{runtime.lastError}</span>} /> : null}
            </div>
            <div>
              <div className="mb-1 text-[13px] font-medium">{t('models.runtime.extras')}</div>
              <p className="mb-2 text-[12.5px] text-muted">{t('models.runtime.setupHint')}</p>
              <div className="flex flex-col gap-1">
                {(runtime?.extras ?? []).map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" data-action={`runtime.extra.${e.id}`} checked={extras.includes(e.id)} onChange={(ev) => setExtras((cur) => (ev.target.checked ? [...cur, e.id] : cur.filter((x) => x !== e.id)))} className="accent-[var(--accent)]" />
                    <span className="flex-1">{t(`models.runtime.extra.${e.id}`)}</span>
                    <span className="text-[11.5px] text-faint">{t('models.runtime.approx', { mb: e.approxMb })}</span>
                    <Badge tone={e.installed ? 'success' : 'neutral'}>{e.installed ? t('models.runtime.installed') : t('models.runtime.notInstalled')}</Badge>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button action="runtime.setup" variant="primary" icon={<Play />} disabled={Boolean(setupTask && (setupTask.status === 'running' || setupTask.status === 'queued'))} onClick={() => void setup()} data-testid="runtime-setup">{t('models.runtime.setup')}</Button>
                <Button action="runtime.restart" icon={<RefreshCw />} loading={probing} onClick={() => void restart()} data-testid="runtime-restart">{t('models.runtime.restart')}</Button>
              </div>
              {setupTask && (setupTask.status === 'running' || setupTask.status === 'queued') ? <div className="mt-2"><div className="mb-1 text-[12px] text-muted">{t('models.runtime.setupRunning')} {setupTask.progressMessage ?? ''}</div><Progress value={setupTask.progress} /></div> : null}
            </div>
          </div>
        </CardBody>
      </Card>
      {!downloadsAllowed ? <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">{t('models.downloadsDisabled')}</div> : null}
      <Tabs<Filter> tabs={[{ id: 'all', label: t('models.filterAll'), count: models?.length }, { id: 'installed', label: t('models.filterInstalled'), count: models?.filter((m) => m.status === 'installed').length }, { id: 'recommended', label: t('models.filterRecommended') }]} value={filter} onChange={setFilter} />
      <div className="mt-4 grid gap-3 md:grid-cols-2" data-testid="models-list">
        {list.map((m) => {
          const task = m.downloadTaskId ? tasks[m.downloadTaskId] : undefined;
          const desc = l.startsWith('ar') ? m.spec.descriptionAr : m.spec.description;
          return (
            <Card key={m.spec.id} data-testid="model-card" data-model-id={m.spec.id} data-status={m.status}>
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{m.spec.name}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-faint" dir="ltr">{m.spec.id}</div>
                  </div>
                  <Badge tone={STATUS_TONE[m.status]} dot>{t(`models.${m.status}`)}</Badge>
                </div>
                <p className="mt-2 text-[12.5px] text-muted">{desc}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px]">
                  <Badge><HardDrive className="me-1 size-3" />{formatBytes(m.spec.sizeBytes, l)}</Badge>
                  {m.spec.vramMb ? <Badge>{t('models.vram')} {m.spec.vramMb} MB</Badge> : null}
                  {m.spec.ramMb ? <Badge>{t('models.ram')} {m.spec.ramMb} MB</Badge> : null}
                  {m.spec.requiresGpu ? <Badge tone="info">{t('models.requiresGpu')}</Badge> : null}
                  <Badge tone={m.spec.recommended === 'always' ? 'accent' : 'neutral'}>{t(`models.recommended${m.spec.recommended[0]!.toUpperCase()}${m.spec.recommended.slice(1)}`)}</Badge>
                  <Badge>{m.spec.license}</Badge>
                </div>
                <div className="mt-2 text-[12px]">
                  <span className={m.fit.ok ? 'text-success' : 'text-warning'}>{m.fit.ok ? t('models.fit.ok') : t(m.fit.reasonKey ?? 'models.fit.needsGpu', m.fit.params)}</span>
                </div>
                {task && (task.status === 'running' || task.status === 'queued') ? <div className="mt-2"><div className="mb-1 text-[12px] text-muted">{task.progressMessage ?? t('models.downloading')}</div><Progress value={task.progress} /></div> : null}
                {m.lastTest ? <div className={`mt-2 rounded-md px-2 py-1 text-[12px] ${m.lastTest.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`} data-testid="model-last-test">{m.lastTest.ok ? t('models.testOk') : t('models.testFailed')} · {m.lastTest.message} · {t('models.ms', { ms: m.lastTest.ms })}</div> : null}
                {!m.downloadable && m.status !== 'installed' ? <p className="mt-2 text-[12px] text-muted">{t('models.notDownloadableHint')}<br /><span className="font-mono text-[11px]" dir="ltr">{m.installPath}</span></p> : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m.status !== 'installed' && m.downloadable ? <Button action="models.download" size="sm" variant="primary" icon={<Download />} disabled={!downloadsAllowed || Boolean(task && task.status !== 'failed' && task.status !== 'cancelled')} onClick={() => void download(m)} data-testid="model-download">{t('models.download')}</Button> : null}
                  {m.status === 'installed' ? <Button action="models.test" size="sm" icon={<FlaskConical />} loading={testing === m.spec.id} onClick={() => void test(m)} data-testid="model-test">{t('models.test')}</Button> : null}
                  {m.status !== 'available' ? <Button action="models.remove" size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setConfirmRemove(m)}>{t('models.remove')}</Button> : null}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
      <Dialog open={Boolean(confirmRemove)} onOpenChange={(o) => !o && setConfirmRemove(null)} title={t('models.remove')} description={confirmRemove ? t('models.confirmRemove', { name: confirmRemove.spec.name }) : ''} size="sm" footer={<><Button action="models.remove.cancel" onClick={() => setConfirmRemove(null)}>{t('common.cancel')}</Button><Button action="models.remove.confirm" variant="danger" onClick={() => confirmRemove && void remove(confirmRemove)}>{t('models.remove')}</Button></>} />
    </div>
  );
}
