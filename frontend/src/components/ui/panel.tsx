import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

/** Outlined card (DESIGN.md §5: radius 24, 1px border, no shadow). */
export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  subtitle,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('flex min-w-0 flex-col rounded-box border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            {title && <h2 className="truncate text-[17px] leading-6 font-semibold text-fg">{title}</h2>}
            {subtitle && <div className="truncate text-[12px] text-muted">{subtitle}</div>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1 p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function KV({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(104px,auto)_1fr] gap-x-4 gap-y-1.5 text-[13px]', className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ icon, title, children, className }: { icon?: ReactNode; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      {icon && <div className="text-subtle [&_svg]:size-6">{icon}</div>}
      <div className="text-[15px] font-semibold text-fg">{title}</div>
      {children && <div className="max-w-md text-[13px] text-muted">{children}</div>}
    </div>
  );
}

export function Meter({ value, max, tone = 'ok', className, label }: { value: number; max: number; tone?: 'ok' | 'warn' | 'crit' | 'info'; className?: string; label?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = { ok: 'bg-ok', warn: 'bg-warn', crit: 'bg-crit', info: 'bg-info' }[tone];
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-3', className)}
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-200', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export type StatVariant = 'plain' | 'income' | 'expense' | 'saving';

const STAT_BG: Record<StatVariant, string> = {
  plain: 'border border-border bg-surface',
  income: 'bg-[#e7fbec] text-[#16151c]',
  expense: 'bg-[#fdebe2] text-[#16151c]',
  saving: 'bg-[#e8edfa] text-[#16151c]',
};

/** Stat card (DESIGN.md §6.4): pastel fill, label, value (22/28 bold), optional footer. */
export function Stat({ label, value, sub, tone, variant = 'plain', children }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'crit'; variant?: StatVariant; children?: ReactNode }) {
  const color = tone === 'crit' ? 'text-crit-ink' : tone === 'warn' ? 'text-warn-ink' : '';
  const pastel = variant !== 'plain';
  return (
    <div className={cn('min-w-0 rounded-card p-5', STAT_BG[variant])}>
      <div className={cn('text-[12px] leading-4', pastel ? 'text-[#5f5e68]' : 'text-muted')}>{label}</div>
      {children}
      <div className={cn('mt-2 truncate text-[22px] leading-7 font-bold tabular', pastel ? '' : color)}>{value}</div>
      {sub && <div className={cn('mt-0.5 truncate text-[12px]', pastel ? 'text-[#5f5e68]' : 'text-muted')}>{sub}</div>}
    </div>
  );
}
