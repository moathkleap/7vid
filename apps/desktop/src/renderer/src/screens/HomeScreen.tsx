import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Clapperboard, Cpu, FolderOpen, HardDrive, Plus, Sparkles, Upload, Brain, ArrowRight } from 'lucide-react';
import type { ProjectSummary } from '@sevenvid/ipc';
import { CAPABILITY_IDS } from '@sevenvid/core';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import { formatDuration, formatMb, formatRelative } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, StatRow } from '@/components/ui/Misc';
import { CreateProjectDialog } from './ProjectsScreen';

export function HomeScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const hardware = useAppStore((s) => s.hardware);
  const capabilities = useAppStore((s) => s.capabilities);
  const projects = useAppStore((s) => s.projects);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => {
    getApi().invoke('projects.recent', { limit: 6 }).then(setRecent).catch(() => setRecent([]));
  }, [projects]);
  const ready = capabilities ? Object.values(capabilities).filter((c) => c.status === 'available').length : 0;
  const gpu = hardware?.gpus[0];
  const openProject = async (id: string) => {
    await useSessionStore.getState().open(id);
    navigate(`/editor/${id}`);
  };
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-tight">{t('home.title')}</h1>
        <p className="mt-1 text-muted">{t('home.subtitle')}</p>
      </div>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <QuickAction icon={<Plus />} label={t('home.newProject')} action="home.newProject" onClick={() => setCreateOpen(true)} primary />
        <QuickAction icon={<FolderOpen />} label={t('home.openProject')} action="home.openProject" onClick={() => navigate('/projects')} />
        <QuickAction icon={<Upload />} label={t('home.importVideo')} action="home.importVideo" onClick={() => navigate('/media')} />
        <QuickAction icon={<Brain />} label={t('nav.models')} action="home.models" onClick={() => navigate('/models')} />
      </div>
      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <ModuleCard icon={<Clapperboard />} title={t('home.aiEditor')} hint={t('home.aiEditorHint')} action="home.aiEditor" onClick={() => navigate('/editor')} />
        <ModuleCard icon={<Sparkles />} title={t('home.aiCreator')} hint={t('home.aiCreatorHint')} action="home.aiCreator" onClick={() => navigate('/creator')} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('home.recentProjects')} actions={<Button action="home.viewProjects" size="sm" variant="ghost" icon={<ArrowRight className="rtl:rotate-180" />} onClick={() => navigate('/projects')}>{t('home.viewAll')}</Button>} />
          <CardBody>
            {recent.length === 0 ? (
              <EmptyState title={t('home.noRecentProjects')} action={<Button action="home.createFirst" variant="primary" icon={<Plus />} onClick={() => setCreateOpen(true)}>{t('home.newProject')}</Button>} />
            ) : (
              <ul className="divide-y divide-border" data-testid="recent-projects">
                {recent.map((p) => (
                  <li key={p.id}>
                    <button type="button" data-action="home.openRecent" className="focus-ring flex w-full items-center gap-4 rounded-lg px-2 py-2.5 text-start hover:bg-surface-2" onClick={() => void openProject(p.id)}>
                      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-faint"><Clapperboard className="size-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="text-[12px] text-muted">{p.width}×{p.height} · {formatDuration(p.durationMs)} · {formatRelative(p.lastOpenedAt ?? p.updatedAt, i18n.language)}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={t('home.modelStatus')} />
            <CardBody>
              <StatRow label={t('home.capabilitiesReady', { ready, total: CAPABILITY_IDS.length })} value={<Button action="home.modelsLink" size="sm" variant="ghost" onClick={() => navigate('/models')}>{t('home.viewAll')}</Button>} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('home.gpuStatus')} />
            <CardBody>
              <div className="flex items-center gap-3 text-sm">
                <Cpu className="size-4 text-muted" />
                <span>{gpu ? gpu.model : t('statusbar.noGpu')}</span>
              </div>
              {gpu?.vramMb ? <StatRow label={t('system.vram')} value={`${formatMb(gpu.vramUsedMb ?? 0, i18n.language)} / ${formatMb(gpu.vramMb, i18n.language)}`} /> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('home.storageStatus')} />
            <CardBody>
              <div className="flex items-center gap-3 text-sm">
                <HardDrive className="size-4 text-muted" />
                <span>{hardware?.dataDisk ? `${formatMb(hardware.dataDisk.availableMb, i18n.language)} ${t('home.free')} / ${formatMb(hardware.dataDisk.sizeMb, i18n.language)}` : '—'}</span>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('home.recentExports')} />
            <CardBody><EmptyState title={t('home.noRecentExports')} className="py-5" /></CardBody>
          </Card>
        </div>
      </div>
      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function QuickAction({ icon, label, action, onClick, primary }: { icon: React.ReactNode; label: string; action: string; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" data-action={action} onClick={onClick} className={`focus-ring flex h-24 flex-col items-start justify-between rounded-xl border p-4 text-start transition-colors ${primary ? 'border-accent/40 bg-accent-soft hover:bg-accent/20' : 'border-border bg-surface hover:bg-surface-2'}`}>
      <span className={`[&>svg]:size-5 ${primary ? 'text-accent' : 'text-muted'}`}>{icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function ModuleCard({ icon, title, hint, action, onClick }: { icon: React.ReactNode; title: string; hint: string; action: string; onClick: () => void }) {
  return (
    <button type="button" data-action={action} onClick={onClick} className="focus-ring flex items-center gap-4 rounded-xl border border-border bg-surface p-5 text-start transition-colors hover:border-border-strong hover:bg-surface-2">
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent [&>svg]:size-6">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block text-[13px] text-muted">{hint}</span>
      </span>
      <ArrowRight className="ms-auto size-4 text-faint rtl:rotate-180" />
    </button>
  );
}
