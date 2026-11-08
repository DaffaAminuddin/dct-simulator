import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import type { Tone } from '@/utils/format';

const TONES: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok-ink',
  warn: 'bg-warn-soft text-warn-ink',
  crit: 'bg-crit-soft text-crit-ink',
  info: 'bg-info-soft text-info-ink',
  muted: 'bg-surface-2 text-muted',
  accent: 'bg-ok-soft text-ok-ink',
};

/** Pill status badge (DESIGN.md micro/caption type). */
export function Badge({ tone = 'muted', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium leading-none', TONES[tone], className)}>
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
