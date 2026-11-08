import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

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
    <section id={id} className={cn('flex min-w-0 flex-col rounded-md border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex min-h-9 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <div className="min-w-0">
            {title && <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</h2>}
            {subtitle && <div className="truncate text-[11px] text-subtle">{subtitle}</div>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1 p-3', bodyClassName)}>{children}</div>
    </section>
  );
}

export function KV({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(104px,auto)_1fr] gap-x-3 gap-y-1 text-[12px]', className)}>
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
      <div className="text-[13px] font-medium text-fg">{title}</div>
      {children && <div className="max-w-md text-[12px] text-muted">{children}</div>}
    </div>
  );
}

export function Meter({ value, max, tone = 'ok', className, label }: { value: number; max: number; tone?: 'ok' | 'warn' | 'crit' | 'info'; className?: string; label?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = { ok: 'bg-ok', warn: 'bg-warn', crit: 'bg-crit', info: 'bg-info' }[tone];
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'crit' }) {
  const color = tone === 'crit' ? 'text-[#f08a84]' : tone === 'warn' ? 'text-[#efc15f]' : 'text-fg';
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">{label}</div>
      <div className={cn('mt-1 truncate font-mono text-[20px] leading-6 tabular', color)}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
