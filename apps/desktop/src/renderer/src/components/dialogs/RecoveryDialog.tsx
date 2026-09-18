import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { History } from 'lucide-react';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import { formatDate } from '@/lib/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

export function RecoveryDialog() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const recovery = useAppStore((s) => s.recovery);
  const setRecovery = useAppStore((s) => s.setRecovery);
  const reportError = useAppStore((s) => s.reportError);
  const [busy, setBusy] = useState<string | null>(null);
  if (recovery.length === 0) return null;
  const act = async (projectId: string, discard: boolean) => {
    setBusy(projectId);
    try {
      const state = await getApi().invoke('projects.recovery.apply', { projectId, discard });
      setRecovery(recovery.filter((r) => r.projectId !== projectId));
      if (!discard && state) {
        await useSessionStore.getState().open(projectId);
        navigate(`/editor/${projectId}`);
      }
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog open onOpenChange={() => undefined} title={t('recovery.title')} description={t('recovery.message')} size="md">
      <ul className="flex flex-col gap-2" data-testid="recovery-list">
        {recovery.map((r) => (
          <li key={r.projectId} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
            <History className="size-5 text-warning" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{r.projectName}</div>
              <div className="text-[12px] text-muted">{t('recovery.entries', { count: r.journalEntries })} · {formatDate(r.lastAutosaveAt, i18n.language)}</div>
            </div>
            <Button action="recovery.discard" size="sm" variant="ghost" disabled={busy != null} onClick={() => void act(r.projectId, true)}>{t('recovery.discard')}</Button>
            <Button action="recovery.restore" size="sm" variant="primary" loading={busy === r.projectId} disabled={busy != null} onClick={() => void act(r.projectId, false)}>{t('recovery.restore')}</Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
