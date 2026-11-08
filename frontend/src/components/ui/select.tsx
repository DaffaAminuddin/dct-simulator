import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

const CARET =
  "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0h10L5 6z' fill='%238E8D96'/%3E%3C/svg%3E\")] bg-[length:8px_5px] bg-[right_14px_center] bg-no-repeat";

/** Pill dropdown (DESIGN.md §6.10): 36px, 1px border, solid caret. */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn('h-9 min-w-0 appearance-none rounded-full border border-border bg-surface py-0 pr-9 pl-4 text-[13px] font-medium text-fg outline-none focus:border-accent', CARET, className)}
      {...props}
    >
      {children}
    </select>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn('h-9 min-w-0 rounded-full border border-border bg-surface px-4 text-[13px] text-fg outline-none placeholder:text-subtle focus:border-accent disabled:opacity-50', className)}
      {...props}
    />
  );
}
