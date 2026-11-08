import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn('h-7 min-w-0 rounded-[5px] border border-border-strong bg-surface-2 px-2 text-[12px] text-fg outline-none focus:border-accent-dim', className)}
      {...props}
    >
      {children}
    </select>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn('h-7 min-w-0 rounded-[5px] border border-border-strong bg-surface-2 px-2 text-[12px] text-fg outline-none placeholder:text-subtle focus:border-accent-dim', className)}
      {...props}
    />
  );
}
