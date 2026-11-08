import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  disabled?: boolean;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  size = 'md',
  label,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  size?: 'sm' | 'md';
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex min-w-0 items-center gap-0.5 overflow-x-auto', className)}>
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          type="button"
          aria-selected={value === it.id}
          disabled={it.disabled}
          onClick={() => onChange(it.id)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-[4px] border border-transparent font-medium text-muted transition-colors hover:text-fg disabled:opacity-40',
            size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-[12px]',
            value === it.id && 'border-border-strong bg-surface-3 text-fg',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ items, value, onChange, label }: { items: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[5px] border border-border-strong bg-surface-2 p-0.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="radio"
          aria-checked={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-[3px] px-2 text-[11px] font-medium text-muted hover:text-fg [&_svg]:size-3.5',
            value === it.id && 'bg-surface-3 text-fg shadow-[inset_0_0_0_1px_var(--color-border-strong)]',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
