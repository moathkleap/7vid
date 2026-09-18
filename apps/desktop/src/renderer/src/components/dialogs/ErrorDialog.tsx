import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { StatRow } from '../ui/Misc';

export function ErrorDialog() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const info = useAppStore((s) => s.errorDialog);
  const showError = useAppStore((s) => s.showError);
  const pushToast = useAppStore((s) => s.pushToast);
  const [copied, setCopied] = useState(false);
  if (!info) return null;
  const copy = async () => {
    await navigator.clipboard?.writeText(JSON.stringify(info, null, 2)).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const act = async (kind: string, target: string | null) => {
    showError(null);
    switch (kind) {
      case 'retry': {
        const taskId = typeof info.details.taskId === 'string' ? info.details.taskId : info.logRef;
        if (taskId) {
          try {
            await getApi().invoke('tasks.retry', { taskId });
            pushToast({ level: 'info', titleKey: 'tasks.retry', messageKey: null, params: {}, errorId: null, taskId });
          } catch (err) {
            useAppStore.getState().reportError(err);
          }
        }
        return;
      }
      case 'open-settings':
        navigate(`/settings/${target ?? 'general'}`);
        return;
      case 'open-models':
        navigate('/models');
        return;
      case 'check-logs':
        navigate('/diagnostics');
        return;
      case 'setup-runtime':
      case 'use-cpu':
      case 'reduce-quality':
        navigate('/system');
        return;
      case 'enable-provider':
        navigate('/settings/providers');
        return;
      case 'free-disk':
        navigate('/settings/storage');
        return;
      default:
        return;
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && showError(null)} title={t('errors.dialogTitle')} description={t(info.userMessageKey, info.userMessageParams)} size="md"
      footer={
        <>
          {info.recovery.map((r) => (
            <Button key={r.kind} action={`error.recovery.${r.kind}`} variant={r.kind === 'retry' ? 'primary' : 'outline'} onClick={() => void act(r.kind, r.target)}>
              {t(r.labelKey)}
            </Button>
          ))}
          <Button action="error.copy" variant="ghost" onClick={() => void copy()}>{copied ? t('common.copied') : t('errors.copyDetails')}</Button>
          <Button action="error.close" onClick={() => showError(null)}>{t('errors.close')}</Button>
        </>
      }
    >
      <div className="rounded-lg border border-border bg-surface-2 px-4 py-2">
        <StatRow label={t('errors.errorId')} value={info.errorId} mono />
        <StatRow label={t('errors.module')} value={info.module} mono />
        <StatRow label={t('errors.operation')} value={info.operation} mono />
        <StatRow label="Code" value={info.code} mono />
        {info.cause ? <StatRow label={t('errors.cause')} value={info.cause} mono /> : null}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[13px] text-muted">{t('errors.technicalDetails')}</summary>
        <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed text-muted select-text" dir="ltr">{info.message}{Object.keys(info.details).length ? `\n\n${JSON.stringify(info.details, null, 2)}` : ''}</pre>
      </details>
    </Dialog>
  );
}
