import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Switch as RadixSwitch } from 'radix-ui';
import { cn } from '@/lib/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn('focus-ring h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-text placeholder:text-faint disabled:opacity-50', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn('focus-ring h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-text disabled:opacity-50', className)} {...rest}>
      {children}
    </select>
  );
});

export function Switch({ checked, onCheckedChange, disabled, action, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; action: string; label?: string }) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      data-action={action}
      aria-label={label}
      className="focus-ring relative h-6 w-10 shrink-0 rounded-full bg-surface-3 transition-colors data-[state=checked]:bg-accent disabled:opacity-40"
    >
      <RadixSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px] rtl:data-[state=checked]:-translate-x-[18px] rtl:-translate-x-0.5" />
    </RadixSwitch.Root>
  );
}

export function Field({ label, hint, children, inline }: { label: ReactNode; hint?: ReactNode; children: ReactNode; inline?: boolean }) {
  if (inline) {
    return (
      <div className="flex items-center justify-between gap-6 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text">{label}</div>
          {hint ? <div className="mt-0.5 text-[12.5px] text-muted">{hint}</div> : null}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    );
  }
  return (
    <label className="block py-2">
      <div className="mb-1.5 text-[13px] font-medium text-text">{label}</div>
      {children}
      {hint ? <div className="mt-1 text-[12.5px] text-muted">{hint}</div> : null}
    </label>
  );
}

export function Progress({ value, className, tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'success' | 'danger' | 'warning' }) {
  const colors = { accent: 'bg-accent', success: 'bg-success', danger: 'bg-danger', warning: 'bg-warning' };
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-[width] duration-300', colors[tone])} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-border-strong bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] text-muted">{children}</kbd>;
}
