import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { AlertTriangle, Construction } from 'lucide-react';
import type { CapabilityId, CapabilityInfo } from '@sevenvid/core';
import { useAppStore } from '@/store/appStore';
import { Badge, type BadgeTone } from './ui/Badge';
import { Button } from './ui/Button';

export function useCapability(id: CapabilityId): CapabilityInfo | null {
  return useAppStore((s) => s.capabilities?.[id] ?? null);
}

export function capabilityTone(status: CapabilityInfo['status'] | undefined): BadgeTone {
  switch (status) {
    case 'available':
      return 'success';
    case 'needs-model':
    case 'needs-provider':
    case 'needs-runtime':
      return 'warning';
    case 'needs-hardware':
      return 'info';
    default:
      return 'neutral';
  }
}

export function CapabilityBadge({ id }: { id: CapabilityId }) {
  const { t } = useTranslation();
  const info = useCapability(id);
  const status = info?.status ?? 'unavailable';
  return <Badge tone={capabilityTone(status)} dot>{t(`capabilities.status.${status}`)}</Badge>;
}

/** Renders children only when the capability is available; otherwise an honest explanation with a next step. */
export function CapabilityGate({ id, children, compact }: { id: CapabilityId; children: ReactNode; compact?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const info = useCapability(id);
  if (info?.status === 'available') return <>{children}</>;
  const status = info?.status ?? 'unavailable';
  const reason = info?.reasonKey ? t(info.reasonKey, info.reasonParams ?? {}) : t('capabilities.unavailable');
  const action = info?.action;
  const go = () => {
    if (!action) return;
    if (action.type === 'open-models') navigate('/models');
    else if (action.type === 'open-settings') navigate(`/settings/${action.target ?? 'general'}`);
    else if (action.type === 'open-providers') navigate('/settings/providers');
    else if (action.type === 'setup-runtime') navigate('/system');
  };
  return (
    <div className={compact ? 'flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2' : 'flex flex-col items-start gap-3 rounded-xl border border-border bg-surface-2 p-5'}>
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-warning" />
        <Badge tone={capabilityTone(status)}>{t(`capabilities.status.${status}`)}</Badge>
        <span className="text-[13px] text-muted">{reason}</span>
      </div>
      {action && action.type !== 'none' ? (
        <Button action={`capability.${id}.${action.type}`} size="sm" variant="outline" onClick={go}>
          {t(`capabilities.action.${action.type}`)}
        </Button>
      ) : null}
    </div>
  );
}

/** Explicit development-status notice for features scheduled in a later roadmap phase. */
export function PhaseNotice({ phase, feature }: { phase: number; feature: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed border-border-strong bg-surface-2 p-5" data-phase-notice={phase}>
      <Construction className="mt-0.5 size-5 shrink-0 text-warning" />
      <div>
        <div className="text-sm font-medium text-text">{t('common.phase', { phase })}</div>
        <p className="mt-1 text-[13px] text-muted">{t('capabilities.phaseNotice', { feature, phase })}</p>
      </div>
    </div>
  );
}
