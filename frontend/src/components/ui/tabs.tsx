import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  disabled?: boolean;
}

/** Pill tabs on a raised track. */
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
    <div role="tablist" aria-label={label} className={cn('flex min-w-0 max-w-full items-center gap-1 overflow-x-auto rounded-full bg-surface-2 p-1', className)}>
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          type="button"
          aria-selected={value === it.id}
          disabled={it.disabled}
          onClick={() => onChange(it.id)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium text-muted transition-colors hover:text-fg disabled:opacity-40',
            size === 'sm' ? 'h-7 px-3 text-[12px]' : 'h-8 px-4 text-[13px]',
            value === it.id && 'bg-surface font-semibold text-fg shadow-[0_1px_2px_rgba(22,21,28,0.08)]',
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-surface-2 p-1">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="radio"
          aria-checked={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium text-muted transition-colors hover:text-fg [&_svg]:size-4',
            value === it.id && 'bg-surface font-semibold text-fg shadow-[0_1px_2px_rgba(22,21,28,0.08)]',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
