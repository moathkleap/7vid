import { useTranslation } from 'react-i18next';
import { Cpu, HardDrive, ListChecks, MemoryStick, Radio } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { formatMb } from '@/lib/format';
import { cn } from '@/lib/cn';

export function StatusBar() {
  const { t, i18n } = useTranslation();
  const hardware = useAppStore((s) => s.hardware);
  const tasks = useAppStore((s) => s.tasks);
  const bridge = useAppStore((s) => s.bridge);
  const setTasksPanelOpen = useAppStore((s) => s.setTasksPanelOpen);
  const running = Object.values(tasks).filter((x) => x.status === 'running' || x.status === 'queued' || x.status === 'paused');
  const active = running.find((x) => x.status === 'running') ?? running[0];
  const gpu = hardware?.gpus[0];
  const locale = i18n.language;
  return (
    <footer className="flex h-8 shrink-0 items-center gap-5 border-t border-border bg-surface px-4 text-[12px] text-muted">
      <span className="flex items-center gap-1.5" title={t('statusbar.gpu')} data-testid="status-gpu">
        <Cpu className="size-3.5" />
        {gpu ? `${gpu.model}${gpu.vramMb ? ` · ${formatMb(gpu.vramUsedMb ?? 0, locale)} / ${formatMb(gpu.vramMb, locale)}` : ''}` : t('statusbar.cpuOnly')}
      </span>
      <span className="flex items-center gap-1.5" title={t('statusbar.ram')} data-testid="status-ram">
        <MemoryStick className="size-3.5" />
        {hardware ? `${formatMb(hardware.memory.usedMb, locale)} / ${formatMb(hardware.memory.totalMb, locale)}` : '—'}
      </span>
      <span className="flex items-center gap-1.5" title={t('statusbar.storage')} data-testid="status-storage">
        <HardDrive className="size-3.5" />
        {hardware?.dataDisk ? `${formatMb(hardware.dataDisk.availableMb, locale)} ${t('home.free')}` : '—'}
      </span>
      <button type="button" data-action="tasks.open" onClick={() => setTasksPanelOpen(true)} className="focus-ring flex min-w-0 items-center gap-1.5 rounded px-1 hover:text-text" data-testid="status-tasks">
        <ListChecks className="size-3.5" />
        {active ? (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{active.title}</span>
            <span className="h-1 w-24 overflow-hidden rounded-full bg-surface-3"><span className="block h-full bg-accent" style={{ width: `${Math.round(active.progress * 100)}%` }} /></span>
            <span>{t('statusbar.running', { count: running.length })}</span>
          </span>
        ) : (
          t('statusbar.idle')
        )}
      </button>
      <span className="ms-auto flex items-center gap-1.5" data-testid="status-bridge">
        <Radio className={cn('size-3.5', bridge === 'connected' || bridge === 'electron' ? 'text-success' : bridge === 'connecting' ? 'text-warning' : 'text-danger')} />
        {bridge === 'electron' ? 'Electron' : bridge === 'connected' ? t('statusbar.browserMode') : bridge === 'connecting' ? t('statusbar.bridgeConnecting') : t('statusbar.bridgeDisconnected')}
      </span>
    </footer>
  );
}
