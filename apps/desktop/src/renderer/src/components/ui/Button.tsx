import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
  /** Stable identifier used by the UI audit script to verify every control is wired. */
  action: string;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]',
  secondary: 'bg-surface-2 text-text hover:bg-surface-3 border border-border',
  ghost: 'bg-transparent text-muted hover:text-text hover:bg-surface-2',
  danger: 'bg-danger/90 text-white hover:bg-danger',
  outline: 'bg-transparent border border-border-strong text-text hover:bg-surface-2',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', icon, loading, action, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-action={action}
      disabled={disabled || loading}
      className={cn('focus-ring inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed select-none', variants[variant], sizes[size], className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon ? <span className="inline-flex shrink-0 [&>svg]:size-4">{icon}</span> : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  action: string;
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ action, label, size = 'md', active, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-action={action}
      aria-label={label}
      title={label}
      className={cn('focus-ring inline-flex items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40 disabled:cursor-not-allowed', size === 'sm' ? 'size-7 [&>svg]:size-4' : 'size-9 [&>svg]:size-[18px]', active && 'bg-accent-soft text-accent', className)}
      {...rest}
    >
      {children}
    </button>
  );
});
