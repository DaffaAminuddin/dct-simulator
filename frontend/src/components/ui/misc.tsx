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
  reference: { label: 'Reference model', tone: 'accent', desc: 'Generic educational reference design, not an OEM layout' },
};

export function AccuracyBadge({ accuracy, note }: { accuracy: Accuracy; note?: string }) {
  const a = ACCURACY[accuracy];
  return (
    <Badge tone={a.tone} title={note ? `${a.desc}. ${note}` : a.desc}>
      {a.label}
    </Badge>
  );
}

export function Callout({ tone = 'info', title, children, className }: { tone?: 'info' | 'warn' | 'crit' | 'ok'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const Icon = tone === 'crit' ? CircleAlert : tone === 'warn' ? TriangleAlert : tone === 'ok' ? CircleCheck : Info;
  const color = {
    info: 'border-info/25 bg-info/5 text-info',
    warn: 'border-warn/25 bg-warn/5 text-warn',
    crit: 'border-crit/30 bg-crit/5 text-crit',
    ok: 'border-ok/25 bg-ok/5 text-ok',
  }[tone];
  return (
    <div className={cn('flex gap-2 rounded-md border px-3 py-2 text-[12px]', color, className)}>
      <Icon className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0">
        {title && <div className="font-medium text-fg">{title}</div>}
        {children && <div className="text-muted">{children}</div>}
      </div>
    </div>
  );
}

export function PhaseNotice({ phase, title, children }: { phase: number; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border-strong bg-surface-2/50 px-4 py-3">
      <div className="flex items-center gap-2">
        <Badge tone="muted">Phase {phase}</Badge>
        <span className="text-[12.5px] font-medium">{title}</span>
      </div>
      {children && <div className="mt-1.5 text-[12px] text-muted">{children}</div>}
    </div>
  );
}

export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-3 bottom-3 z-50 flex w-[min(380px,calc(100vw-24px))] flex-col gap-2">
      {toasts.map((t) => {
        const Icon = t.tone === 'crit' ? CircleAlert : t.tone === 'warn' ? TriangleAlert : t.tone === 'ok' ? CircleCheck : Info;
        const color = { crit: 'text-crit', warn: 'text-warn', ok: 'text-ok', info: 'text-info' }[t.tone];
        return (
          <div key={t.id} role="status" className="pointer-events-auto flex gap-2 rounded-md border border-border-strong bg-surface-2 px-3 py-2 shadow-lg shadow-black/40">
            <Icon className={cn('mt-0.5 size-4 shrink-0', color)} />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium">{t.title}</div>
              {t.detail && <div className="text-[12px] text-muted">{t.detail}</div>}
            </div>
            <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="text-subtle hover:text-fg">
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[11.5px] tabular', className)}>{children}</span>;
}
