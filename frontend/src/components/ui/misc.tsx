import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useUiStore } from '@/stores/uiStore';
import type { Accuracy } from '@/types/catalog';
import { cn } from '@/utils/cn';
import { Badge } from './badge';

const ACCURACY: Record<Accuracy, { label: string; tone: 'ok' | 'info' | 'warn' | 'muted' | 'accent'; desc: string }> = {
  verified: { label: 'Verified spec', tone: 'ok', desc: 'Widely published vendor or standards specification' },
  industry: { label: 'Industry practice', tone: 'info', desc: 'General industry practice or standard behaviour' },
  simplified: { label: 'Simplified model', tone: 'warn', desc: 'Simplified simulation behaviour for teaching' },
  hypothetical: { label: 'Training scenario', tone: 'muted', desc: 'Hypothetical training content' },
  reference: { label: 'Reference model', tone: 'info', desc: 'Generic educational reference design, not an OEM layout' },
};

export function AccuracyBadge({ accuracy, note }: { accuracy: Accuracy; note?: string }) {
  const a = ACCURACY[accuracy];
  return (
    <Badge tone={a.tone} title={note ? `${a.desc}. ${note}` : a.desc}>
      {a.label}
    </Badge>
  );
}

const CALLOUT: Record<'info' | 'warn' | 'crit' | 'ok', { box: string; icon: string }> = {
  info: { box: 'bg-info-soft', icon: 'text-info-ink' },
  warn: { box: 'bg-warn-soft', icon: 'text-warn-ink' },
  crit: { box: 'bg-crit-soft', icon: 'text-crit-ink' },
  ok: { box: 'bg-ok-soft', icon: 'text-ok-ink' },
};

export function Callout({ tone = 'info', title, children, className }: { tone?: 'info' | 'warn' | 'crit' | 'ok'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const Icon = tone === 'crit' ? CircleAlert : tone === 'warn' ? TriangleAlert : tone === 'ok' ? CircleCheck : Info;
  const c = CALLOUT[tone];
  return (
    <div className={cn('flex gap-2.5 rounded-chip px-4 py-3 text-[13px]', c.box, className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', c.icon)} />
      <div className="min-w-0">
        {title && <div className="font-semibold text-fg">{title}</div>}
        {children && <div className="text-fg/75">{children}</div>}
      </div>
    </div>
  );
}

export function PhaseNotice({ phase, title, children }: { phase: number; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-box border border-dashed border-border-strong px-5 py-4">
      <div className="flex items-center gap-2">
        <Badge tone="muted">Phase {phase}</Badge>
        <span className="text-[14px] font-semibold">{title}</span>
      </div>
      {children && <div className="mt-1.5 text-[13px] text-muted">{children}</div>}
    </div>
  );
}

export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
      {toasts.map((t) => {
        const Icon = t.tone === 'crit' ? CircleAlert : t.tone === 'warn' ? TriangleAlert : t.tone === 'ok' ? CircleCheck : Info;
        const color = { crit: 'text-crit-ink', warn: 'text-warn-ink', ok: 'text-ok-ink', info: 'text-info-ink' }[t.tone];
        return (
          <div key={t.id} role="status" className="pointer-events-auto flex gap-2.5 rounded-card border border-border bg-surface px-4 py-3 shadow-[0_12px_32px_rgba(22,21,28,0.14)]">
            <Icon className={cn('mt-0.5 size-4 shrink-0', color)} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">{t.title}</div>
              {t.detail && <div className="text-[13px] text-muted">{t.detail}</div>}
            </div>
            <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="text-subtle hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12px] tabular', className)}>{children}</span>;
}
