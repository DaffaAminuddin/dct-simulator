import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AccuracyBadge, PhaseNotice } from '@/components/ui/misc';
import { Meter, Panel } from '@/components/ui/panel';
import { MODULES } from '@/data/learning/modules';
import { getWorkOrder } from '@/data/workorders/workOrders';
import { useProgressStore } from '@/stores/progressStore';
import { cn } from '@/utils/cn';

export function LearningCenterPage() {
  const { moduleId } = useParams();
  const navigate = useNavigate();
  const done = useProgressStore((s) => s.modulesCompleted);
  const toggle = useProgressStore((s) => s.toggleModule);
  const m = MODULES.find((x) => x.id === moduleId) ?? MODULES[0];

  return (
    <Page>
      <div className="mb-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Meter value={done.length} max={MODULES.length} label="Modules completed" />
        </div>
        <span className="text-[12px] text-muted tabular">
          {done.length}/{MODULES.length} modules completed
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Panel title="Modules" bodyClassName="p-1.5">
          <ul className="space-y-0.5">
            {MODULES.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/learn/${x.id}`)}
                  aria-current={x.id === m.id}
                  className={cn('flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-3', x.id === m.id && 'bg-surface-3')}
                >
                  {done.includes(x.id) ? <CheckCircle2 className="size-4 shrink-0 text-ok" /> : <Circle className="size-4 shrink-0 text-subtle" />}
                  <span className="w-5 text-right font-mono text-[11px] text-subtle">{x.number}</span>
                  <span className="truncate">{x.title}</span>
                  {x.labs.length === 0 && <Badge className="ml-auto">Phase 3</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel
          title={`Module ${m.number}`}
          subtitle={m.title}
          actions={
            <Button size="xs" variant={done.includes(m.id) ? 'outline' : 'primary'} onClick={() => toggle(m.id)}>
              {done.includes(m.id) ? 'Mark as not complete' : 'Mark as complete'}
            </Button>
          }
        >
          <div className="space-y-4">
            <p className="text-[13px] text-fg/90">{m.summary}</p>
            <section>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Learning objectives</h3>
              <ul className="list-disc space-y-0.5 pl-4 text-[12.5px]">
                {m.objectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Theory</h3>
              <p className="max-w-3xl text-[12.5px] leading-relaxed text-muted">{m.theory}</p>
            </section>
            <section>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Key facts</h3>
              <ul className="space-y-1.5">
                {m.facts.map((f) => (
                  <li key={f.text} className="flex flex-wrap items-start gap-2 text-[12.5px]">
                    <AccuracyBadge accuracy={f.accuracy} />
                    <span className="min-w-0 flex-1">{f.text}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="grid gap-3 md:grid-cols-2">
              <div>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Hands-on labs</h3>
                {m.labs.length === 0 ? (
                  <div className="text-[12px] text-subtle">Arrives with the virtual terminal (Phase 3).</div>
                ) : (
                  <ul className="space-y-1">
                    {m.labs.map((l) => (
                      <li key={l.to}>
                        <Link to={l.to} className="inline-flex items-center gap-1.5 text-[12.5px] text-accent-strong hover:underline">
                          <ExternalLink className="size-3.5" /> {l.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Practice work orders</h3>
                {m.workOrders.length === 0 ? (
                  <div className="text-[12px] text-subtle">None yet.</div>
                ) : (
                  <ul className="space-y-1">
                    {m.workOrders.map((id) => (
                      <li key={id}>
                        <Link to={`/workorders/${id}`} className="text-[12.5px] text-accent-strong hover:underline">
                          {id}: {getWorkOrder(id)?.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
            <PhaseNotice phase={6} title="Quizzes, guided steps and visual explanations">
              Interactive quizzes, step highlighting in Guided mode and per-module assessments are scheduled for Phase 6. Completion is self-reported for now and stored locally.
            </PhaseNotice>
          </div>
        </Panel>
      </div>
    </Page>
  );
}
