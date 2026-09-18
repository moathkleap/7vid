import type { ReactNode } from 'react';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Tooltip({ content, children, side = 'bottom' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RadixTooltip.Provider delayDuration={400}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-text shadow-[var(--shadow)] animate-fade-in">
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-10 text-center', className)}>
      {icon ? <div className="mb-3 text-faint [&>svg]:size-8">{icon}</div> : null}
      <div className="text-sm font-medium text-text">{title}</div>
      {description ? <div className="mt-1 max-w-sm text-[13px] text-muted">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-muted', className)} />;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-text">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: ReactNode; count?: number }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1 border-b border-border" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          data-action={`tab.${t.id}`}
          onClick={() => onChange(t.id)}
          className={cn('focus-ring -mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors', value === t.id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text')}
        >
          {t.label}
          {t.count != null ? <span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-muted">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function StatRow({ label, value, mono }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className={cn('text-end text-text', mono && 'font-mono text-[12.5px]')}>{value}</span>
    </div>
  );
}
