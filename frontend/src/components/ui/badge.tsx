import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import type { Tone } from '@/utils/format';

const TONES: Record<Tone, string> = {
  ok: 'border-ok/30 bg-ok/10 text-[#8fd46f]',
  warn: 'border-warn/30 bg-warn/10 text-[#efc15f]',
  crit: 'border-crit/35 bg-crit/10 text-[#f08a84]',
  info: 'border-info/30 bg-info/10 text-[#86c2ee]',
  muted: 'border-border-strong bg-surface-3 text-muted',
  accent: 'border-accent-dim bg-accent/10 text-accent-strong',
};

export function Badge({ tone = 'muted', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[4px] border px-1.5 text-[11px] font-medium leading-none', TONES[tone], className)}
    >
      {children}
    </span>
  );
}

const DOT: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  crit: 'bg-crit',
  info: 'bg-info',
  muted: 'bg-unknown',
  accent: 'bg-accent',
};

export function StatusDot({ tone, blink, className, label }: { tone: Tone; blink?: boolean; className?: string; label?: string }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      className={cn('inline-block size-2 shrink-0 rounded-full', DOT[tone], blink && 'animate-blink', className)}
    />
  );
}
