'use client';

import clsx from 'clsx';
import {
  useEffect,
  type ButtonHTMLAttributes,
  type ComponentPropsWithRef,
  type ReactNode,
} from 'react';

/** 通用界面元件。统一圆角、边框、过渡与荧光强调色。 */

type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-ink font-semibold hover:brightness-110 active:scale-[.98] shadow-[0_10px_30px_-16px_rgba(200,255,77,.9)]',
  outline: 'border border-line text-text hover:border-accent hover:text-accent bg-transparent',
  ghost: 'text-muted hover:text-text hover:bg-white/5',
  subtle: 'bg-surface-2 text-text hover:bg-line border border-line-soft',
  danger: 'border border-danger/60 text-danger hover:bg-danger/10',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-lg gap-1.5',
  md: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-12 px-6 text-base rounded-2xl gap-2',
  icon: 'h-9 w-9 rounded-xl justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  loading?: boolean;
}

export function Button({
  variant = 'subtle',
  size = 'md',
  icon,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex cursor-pointer items-center whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? (
        <i className="fa-solid fa-circle-notch fa-spin" aria-hidden />
      ) : icon ? (
        <i className={`fa-solid ${icon}`} aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={clsx(
        'rounded-3xl border border-line-soft bg-surface/80 shadow-soft backdrop-blur-sm',
        padded && 'p-5',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SectionTitle({
  title,
  hint,
  icon,
  actions,
}: {
  title: string;
  hint?: string;
  icon?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {icon ? <i className={`fa-solid ${icon} text-accent`} aria-hidden /> : null}
          <span className="truncate">{title}</span>
        </h2>
        {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx('flex flex-col gap-1.5', className)}>
      <span className="text-xs tracking-wide text-muted">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
    </label>
  );
}

const CONTROL =
  'w-full rounded-xl border border-line-soft bg-ink-soft/80 px-3 py-2 text-sm text-text placeholder:text-faint outline-none focus:border-accent/70 focus:ring-2 focus:ring-accent/20';

export function Input({ className, ...rest }: ComponentPropsWithRef<'input'>) {
  return <input {...rest} className={clsx(CONTROL, 'h-10', className)} />;
}

export function Textarea({ className, ...rest }: ComponentPropsWithRef<'textarea'>) {
  return <textarea {...rest} className={clsx(CONTROL, 'resize-y leading-relaxed', className)} />;
}

// 下拉选择统一使用 @/components/ui/Dropdown，这里不再提供原生 select，避免外观回退。

export function Badge({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode;
  tone?: 'default' | 'accent' | 'muted' | 'danger' | 'warn';
  className?: string;
}) {
  const tones = {
    default: 'border-line text-text',
    accent: 'border-accent/60 text-accent bg-accent/10',
    muted: 'border-line-soft text-muted',
    danger: 'border-danger/50 text-danger bg-danger/10',
    warn: 'border-warn/50 text-warn bg-warn/10',
  } as const;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] leading-5 whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex cursor-pointer items-center gap-2"
    >
      <span
        className={clsx(
          'relative h-5 w-9 rounded-full border transition',
          checked ? 'border-accent bg-accent/30' : 'border-line bg-surface-2',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all',
            checked ? 'left-4.5 bg-accent' : 'left-0.5 bg-faint',
          )}
        />
      </span>
      {label ? <span className="text-sm text-muted">{label}</span> : null}
    </button>
  );
}

export function Tabs<T extends string>({
  value,
  items,
  onChange,
  className,
}: {
  value: T;
  items: { value: T; label: string; icon?: string; count?: number }[];
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-wrap gap-1 rounded-2xl border border-line-soft bg-ink-soft/60 p-1', className)}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={clsx(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs',
            value === item.value ? 'bg-accent text-ink font-semibold' : 'text-muted hover:text-text',
          )}
        >
          {item.icon ? <i className={`fa-solid ${item.icon}`} aria-hidden /> : null}
          {item.label}
          {item.count !== undefined ? <span className="opacity-60">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon = 'fa-feather',
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <i className={`fa-solid ${icon} text-2xl text-faint`} aria-hidden />
      <p className="text-sm text-muted">{title}</p>
      {hint ? <p className="max-w-md text-xs text-faint">{hint}</p> : null}
      {action}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 'max-w-2xl',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-90 flex items-center justify-center p-4">
      <div className="fade-in absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className={clsx(
          'rise-in relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-soft',
          width,
        )}
        role="dialog"
        aria-modal
      >
        <header className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
            <i className="fa-solid fa-xmark" aria-hidden />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-line-soft px-5 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <i className={clsx('fa-solid fa-circle-notch fa-spin text-accent', className)} aria-hidden />;
}

export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-line-soft', className)}>
      <div
        className="h-full rounded-full bg-accent transition-all"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
