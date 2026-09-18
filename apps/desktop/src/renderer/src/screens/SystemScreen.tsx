import { useTranslation } from 'react-i18next';
import { Cpu, HardDrive, MemoryStick, Monitor, RefreshCw, Terminal, Zap } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { formatMb } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader, StatRow } from '@/components/ui/Misc';
import { Progress } from '@/components/ui/Input';

export function SystemScreen() {
  const { t, i18n } = useTranslation();
  const hw = useAppStore((s) => s.hardware);
  const refresh = useAppStore((s) => s.refreshHardware);
  const l = i18n.language;
  if (!hw) return null;
  const memPct = hw.memory.totalMb ? hw.memory.usedMb / hw.memory.totalMb : 0;
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('system.title')} subtitle={t('system.subtitle')} actions={<Button action="system.refresh" icon={<RefreshCw />} onClick={() => void refresh()}>{t('system.refresh')}</Button>} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Cpu className="size-4" />{t('system.cpu')}</span>} />
          <CardBody>
            <StatRow label={t('system.cpu')} value={hw.cpu.brand} />
            <StatRow label={t('system.cores', { cores: hw.cpu.cores, physical: hw.cpu.physicalCores })} value={hw.cpu.speedGhz ? `${hw.cpu.speedGhz} GHz` : '—'} />
            <StatRow label={t('system.load')} value={hw.cpu.loadPercent != null ? `${hw.cpu.loadPercent}%` : '—'} />
            {hw.cpu.loadPercent != null ? <Progress value={hw.cpu.loadPercent / 100} className="mt-2" /> : null}
            <StatRow label="OS" value={`${hw.os.distro || hw.os.platform} ${hw.os.release} (${hw.os.arch})`} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><MemoryStick className="size-4" />{t('system.memory')}</span>} />
          <CardBody>
            <StatRow label={t('system.total')} value={formatMb(hw.memory.totalMb, l)} />
            <StatRow label={t('system.used')} value={formatMb(hw.memory.usedMb, l)} />
            <StatRow label={t('system.available')} value={formatMb(hw.memory.availableMb, l)} />
            <Progress value={memPct} className="mt-2" tone={memPct > 0.9 ? 'danger' : 'accent'} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Monitor className="size-4" />{t('system.gpu')}</span>} />
          <CardBody>
            {hw.gpus.length === 0 ? <p className="text-[13px] text-muted">{t('system.noGpu')}</p> : hw.gpus.map((g, i) => (
              <div key={i} className="mb-3 last:mb-0">
                <div className="mb-1 flex items-center gap-2 text-sm font-medium">{g.model} <Badge tone={g.supportsCuda ? 'success' : 'neutral'}>{g.kind.toUpperCase()}{g.supportsCuda ? ` · ${t('system.cuda')}` : ''}</Badge></div>
                <StatRow label={t('system.vram')} value={g.vramMb ? `${formatMb(g.vramUsedMb ?? 0, l)} / ${formatMb(g.vramMb, l)}` : '—'} />
                {g.vramMb && g.vramUsedMb != null ? <Progress value={g.vramUsedMb / g.vramMb} className="mb-2" /> : null}
                <StatRow label={t('system.utilization')} value={g.utilizationPercent != null ? `${g.utilizationPercent}%` : '—'} />
                <StatRow label={t('system.driver')} value={g.driver ?? '—'} />
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><HardDrive className="size-4" />{t('system.disks')}</span>} />
          <CardBody>
            {hw.dataDisk ? <StatRow label={t('system.dataDisk')} value={`${formatMb(hw.dataDisk.availableMb, l)} ${t('system.available')} / ${formatMb(hw.dataDisk.sizeMb, l)}`} /> : null}
            {hw.disks.slice(0, 6).map((d) => (
              <div key={d.mount} className="py-1">
                <StatRow label={<span className="font-mono text-[12px]" dir="ltr">{d.mount}</span>} value={`${formatMb(d.availableMb, l)} / ${formatMb(d.sizeMb, l)}`} />
                <Progress value={d.sizeMb ? d.usedMb / d.sizeMb : 0} tone={d.sizeMb && d.usedMb / d.sizeMb > 0.92 ? 'danger' : 'accent'} />
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Zap className="size-4" />{t('system.ffmpeg')}</span>} actions={<Badge tone={hw.ffmpeg.available ? 'success' : 'danger'} dot>{hw.ffmpeg.available ? t('system.found') : t('system.notFound')}</Badge>} />
          <CardBody>
            <StatRow label={t('system.version')} value={hw.ffmpeg.version ?? '—'} mono />
            <StatRow label={t('system.source')} value={<span dir="ltr">{hw.ffmpeg.path ?? '—'}</span>} mono />
            <div className="mt-2 text-[13px] text-muted">{t('system.hwEncoders')}</div>
            <div className="mt-1 flex flex-wrap gap-1.5" data-testid="system-hw-encoders">
              {hw.ffmpeg.hwEncoders.length === 0 ? <Badge>{t('system.none')}</Badge> : hw.ffmpeg.hwEncoders.map((e) => <Badge key={e} tone="info">{e}</Badge>)}
            </div>
            <p className="mt-2 text-[12px] text-faint">{t('system.notVerified')}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Terminal className="size-4" />{t('system.python')}</span>} actions={<Badge tone={hw.python.venvReady ? 'success' : 'warning'} dot>{hw.python.venvReady ? t('system.found') : t('system.notFound')}</Badge>} />
          <CardBody>
            {hw.python.venvReady ? (
              <>
                <StatRow label={t('system.version')} value={hw.python.version ?? '—'} mono />
                <StatRow label={t('system.source')} value={<span dir="ltr">{hw.python.path ?? '—'}</span>} mono />
                <StatRow label={t('system.device')} value={hw.python.device ?? '—'} mono />
              </>
            ) : (
              <p className="text-[13px] text-muted">{t('system.pythonMissing')}</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
