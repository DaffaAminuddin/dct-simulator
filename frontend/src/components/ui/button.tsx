import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] border text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-border-strong bg-surface-3 text-fg hover:bg-[#262c30]',
        primary: 'border-accent-dim bg-accent/15 text-accent-strong hover:bg-accent/25',
        ghost: 'border-transparent bg-transparent text-muted hover:bg-surface-3 hover:text-fg',
        outline: 'border-border-strong bg-transparent text-fg hover:bg-surface-3',
        danger: 'border-crit/40 bg-crit/10 text-[#f08a84] hover:bg-crit/20',
      },
      size: {
        sm: 'h-7 px-2.5',
        md: 'h-8 px-3',
        xs: 'h-6 px-2 text-[11px]',
        icon: 'size-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'sm' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
