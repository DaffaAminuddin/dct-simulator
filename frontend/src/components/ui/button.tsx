import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

/** Pill buttons (DESIGN.md §6.3 / §8): filled ink primary, outline, soft and ghost variants. */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border font-medium transition-[background-color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-surface-2 text-fg hover:bg-surface-3',
        primary: 'border-transparent bg-fg text-bg hover:opacity-90',
        ghost: 'border-transparent bg-transparent text-muted hover:bg-surface-2 hover:text-fg',
        outline: 'border-border-strong bg-transparent text-fg hover:bg-fg/[0.06]',
        danger: 'border-transparent bg-crit-soft text-crit-ink hover:bg-crit/20',
        accent: 'border-transparent bg-ok-soft text-ok-ink hover:bg-ok/25',
      },
      size: {
        sm: 'h-8 px-4 text-[13px] [&_svg]:size-4',
        md: 'h-[38px] px-5 text-[14px] [&_svg]:size-4',
        xs: 'h-7 px-3 text-[12px] [&_svg]:size-3.5',
        icon: 'size-8 [&_svg]:size-4',
        'icon-lg': 'size-10 [&_svg]:size-[18px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'sm' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
