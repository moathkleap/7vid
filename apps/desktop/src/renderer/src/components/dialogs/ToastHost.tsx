import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/cn';

const icons = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };
const tones = { info: 'border-info/40', success: 'border-success/40', warning: 'border-warning/40', error: 'border-danger/40' };

export function ToastHost() {
  const { t } = useTranslation();
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);
  const showError = useAppStore((s) => s.showError);
  const errors = useAppStore((s) => s.errors);
  return (
    <div className="pointer-events-none fixed bottom-10 end-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = icons[toast.level];
        const err = toast.errorId ? errors.find((e) => e.errorId === toast.errorId) : null;
        return (
          <div key={toast.id} className={cn('pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface p-3 shadow-[var(--shadow)] animate-fade-in', tones[toast.level])} role="status" data-testid={`toast-${toast.level}`}>
            <Icon className={cn('mt-0.5 size-4 shrink-0', toast.level === 'error' ? 'text-danger' : toast.level === 'warning' ? 'text-warning' : toast.level === 'success' ? 'text-success' : 'text-info')} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-text">{t(toast.titleKey, toast.params)}</div>
              {toast.messageKey ? <div className="mt-0.5 text-[12.5px] text-muted">{t(toast.messageKey, toast.params)}</div> : null}
              {err ? (
                <button type="button" data-action="toast.details" className="mt-1 text-[12px] text-accent hover:underline" onClick={() => showError(err)}>
                  {t('errors.technicalDetails')}
                </button>
              ) : null}
            </div>
            <button type="button" data-action="toast.dismiss" aria-label={t('common.close')} className="text-faint hover:text-text" onClick={() => dismiss(toast.id)}>
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
