import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { AppErrorInfo } from '@sevenvid/core';
import { useAppStore } from '@/store/appStore';
import { useSyncedState } from '@/hooks/useSyncedState';
import { Input } from '@/components/ui/Input';
import { Progress } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mt-4 mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-faint">{children}</h3>;
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[12.5px] leading-relaxed text-muted">{children}</p>;
}

/** Progress line for a running task, or its failure with a link to the error dialog. */
export function TaskStatus({ running, progress, message, error, doneLabel }: { running: boolean; progress: number; message: string | null; error: AppErrorInfo | null; doneLabel?: string | null }) {
  const { t } = useTranslation();
  const showError = useAppStore((s) => s.showError);
  if (running) {
    return (
      <div className="my-2" data-testid="task-status-running">
        <div className="mb-1 flex items-center gap-2 text-[12.5px] text-muted"><Loader2 className="size-3.5 animate-spin" />{message ?? t('tools.running')}<span className="ms-auto font-mono text-[11px]">{Math.round(progress * 100)}%</span></div>
        <Progress value={progress} />
      </div>
    );
  }
  if (error) {
    return (
      <button type="button" data-action="task.showError" onClick={() => showError(error)} className="my-2 flex w-full items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-start text-[12.5px] text-text" data-testid="task-status-error">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
        <span>{t(error.userMessageKey, { ...error.userMessageParams, defaultValue: error.message })}<span className="block text-[11.5px] text-muted">{error.message}</span></span>
      </button>
    );
  }
  if (doneLabel) {
    return <div className="my-2 flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[12.5px] text-text" data-testid="task-status-done"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /><span>{doneLabel}</span></div>;
  }
  return null;
}

export function NumberField({ value, onCommit, min, max, step = 1, action, className, suffix }: { value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; action: string; className?: string; suffix?: string }) {
  const [draft, setDraft] = useSyncedState(String(value));
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n === value) return setDraft(String(value));
    onCommit(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)));
  };
  return (
    <div className="flex items-center gap-1">
      <Input type="number" step={step} min={min} max={max} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} className={className ?? 'w-24'} data-action={action} dir="ltr" />
      {suffix ? <span className="text-[11.5px] text-faint">{suffix}</span> : null}
    </div>
  );
}

export function RangeField({ label, value, min, max, step, onCommit, action, format }: { label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void; action: string; format?: (v: number) => string }) {
  const [draft, setDraft] = useSyncedState(value);
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-center justify-between text-[12.5px]"><span className="text-muted">{label}</span><span className="font-mono text-[11.5px]" dir="ltr">{format ? format(draft) : draft}</span></div>
      <input type="range" min={min} max={max} step={step} value={draft} data-action={action} onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={() => draft !== value && onCommit(draft)} onKeyUp={() => draft !== value && onCommit(draft)} onBlur={() => draft !== value && onCommit(draft)} className="w-full accent-[var(--accent)]" dir="ltr" />
    </div>
  );
}

export function ChoiceRow<T extends string>({ value, options, onChange, action }: { value: T; options: Array<{ id: T; label: string }>; onChange: (v: T) => void; action: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup">
      {options.map((o) => (
        <Button key={o.id} action={`${action}.${o.id}`} size="sm" variant={value === o.id ? 'primary' : 'outline'} onClick={() => onChange(o.id)} role="radio" aria-checked={value === o.id}>{o.label}</Button>
      ))}
    </div>
  );
}

export function fmtSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
