import { CheckCircle2, CircleDashed, Lightbulb, MapPin, Play, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout, Mono, PhaseNotice } from '@/components/ui/misc';
import { EmptyState, KV, Panel } from '@/components/ui/panel';
import { getWorkOrder, resolveSetup, type ResolutionCheck, WORK_ORDERS } from '@/data/workorders/workOrders';
import { effectiveStatus, SESSION_ID, useProgressStore, type WorkOrderStatus } from '@/stores/progressStore';
import { getSim, useSim, useSimulationStore } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { formatElapsed, type Tone } from '@/utils/format';

export const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  pending_validation: 'Pending validation',
  resolved: 'Resolved',
  closed: 'Closed',
};
export const STATUS_TONE: Record<WorkOrderStatus, Tone> = { open: 'muted', in_progress: 'info', pending_validation: 'warn', resolved: 'ok', closed: 'accent' };

export function WorkOrdersPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const runs = useProgressStore((s) => s.workOrders);
  const selected = getWorkOrder(id ?? '') ?? WORK_ORDERS[0];

  return (
    <Page>
      <div className="grid gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Panel title="Ticket queue" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {WORK_ORDERS.map((w) => {
              const st = effectiveStatus(runs[w.id]);
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/workorders/${w.id}`)}
                    aria-current={w.id === selected.id}
                    className={cn('w-full px-3 py-2 text-left hover:bg-surface-2', w.id === selected.id && 'bg-surface-2 shadow-[inset_2px_0_0_var(--color-accent)]')}
                  >
                    <div className="flex items-center gap-2">
                      <Mono className="text-muted">{w.id}</Mono>
                      <Badge tone={w.priority === 'P1' ? 'crit' : w.priority === 'P2' ? 'warn' : 'muted'}>{w.priority}</Badge>
                      <Badge tone={STATUS_TONE[st]} className="ml-auto">
                        {STATUS_LABEL[st]}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-[12.5px]">{w.title}</div>
                    <div className="text-[11px] text-subtle">
                      {w.location.rackId} / {w.location.u} · {w.difficulty}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
        <WorkOrderDetail key={selected.id} id={selected.id} />
      </div>
    </Page>
  );
}

function WorkOrderDetail({ id }: { id: string }) {
  const w = getWorkOrder(id);
  const navigate = useNavigate();
  const run = useProgressStore((s) => s.workOrders[id]);
  const setRun = useProgressStore((s) => s.setRun);
  const log = useProgressStore((s) => s.log);
  const mode = useUiStore((s) => s.trainingMode);
  const notify = useUiStore((s) => s.notify);
  const selectEquipment = useUiStore((s) => s.selectEquipment);
  const timeMs = useSim((s) => s.timeMs);
  const [checks, setChecks] = useState<ResolutionCheck[] | null>(null);
  const [showHint, setShowHint] = useState(false);
  if (!w) return <EmptyState title="Unknown work order" />;
  const status = effectiveStatus(run);
  const startedAt = run?.session === SESSION_ID ? run.startedAtSimMs : undefined;
  const live = status === 'in_progress' || status === 'pending_validation';
  const canStart = status === 'open' || status === 'closed' || status === 'resolved';

  const start = () => {
    const dispatch = useSimulationStore.getState().dispatch;
    for (const a of w.setup ?? []) {
      const resolved = resolveSetup(getSim(), a);
      if (!resolved) continue;
      const r = dispatch(resolved);
      if (!r.ok && r.code !== 'FAULT_EXISTS') {
        notify({ tone: 'crit', title: 'Scenario setup failed', detail: r.message });
        return;
      }
    }
    setRun(w.id, { status: 'in_progress', startedAtSimMs: getSim().timeMs, session: SESSION_ID, resolvedInMs: undefined });
    setChecks(null);
    log(`Started ${w.id}`);
    notify({ tone: 'info', title: `${w.id} assigned to you`, detail: 'The clock is running. Investigate before replacing anything.' });
    if (!useSimulationStore.getState().running) useSimulationStore.getState().setRunning(true);
  };

  const validate = () => {
    const result = w.validate(getSim());
    setChecks(result);
    const passed = result.every((c) => c.ok);
    const elapsed = startedAt !== undefined ? getSim().timeMs - startedAt : undefined;
    setRun(w.id, {
      status: passed ? 'resolved' : 'pending_validation',
      validations: (run?.validations ?? 0) + 1,
      session: SESSION_ID,
      ...(passed ? { resolvedInMs: elapsed } : {}),
    });
    if (passed) log(`Resolved ${w.id}${elapsed !== undefined ? ` in ${formatElapsed(elapsed)}` : ''}`);
    notify(passed ? { tone: 'ok', title: `${w.id} validated`, detail: 'All resolution criteria pass.' } : { tone: 'warn', title: 'Validation failed', detail: `${result.filter((c) => !c.ok).length} criteria not met.` });
  };

  const goLocation = () => {
    if (w.location.equipmentId) selectEquipment(w.location.equipmentId, w.location.rackId);
    else useUiStore.getState().selectRack(w.location.rackId);
    navigate(`/racks/${w.location.rackId}`);
  };

  return (
    <Panel
      title={`Work order #${w.id}`}
      subtitle={w.title}
      actions={
        <>
          <Badge tone={w.priority === 'P1' ? 'crit' : w.priority === 'P2' ? 'warn' : 'muted'}>Priority {w.priority}</Badge>
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
        </>
      }
    >
      <div className="space-y-4">
        <KV
          rows={[
            ['Location', <button key="l" type="button" onClick={goLocation} className="inline-flex items-center gap-1 text-accent-strong hover:underline"><MapPin className="size-3.5" /> Data Hall 01 / Rack {w.location.rackId} / {w.location.u}</button>],
            ['Issue', w.issue],
            ['Objective', w.objective],
            ['Difficulty', w.difficulty],
            ...(startedAt !== undefined && live ? ([['Elapsed (sim)', formatElapsed(timeMs - startedAt)]] as [string, string][]) : []),
            ...(run?.resolvedInMs !== undefined && status === 'resolved' ? ([['Resolved in', `${formatElapsed(run.resolvedInMs)} (target ${Math.round(w.targetTimeS / 60)} min)`]] as [string, string][]) : []),
          ]}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Symptoms</div>
            <ul className="list-disc space-y-0.5 pl-4 text-[12px]">
              {w.symptoms.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Required tasks</div>
            <ol className="list-decimal space-y-0.5 pl-4 text-[12px]">
              {w.tasks.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!w.seeded && canStart && (
            <Button variant="primary" onClick={start}>
              <Play /> {status === 'open' ? 'Accept & start' : 'Restart scenario'}
            </Button>
          )}
          {(w.seeded || live) && (
            <Button variant={w.seeded && !live ? 'primary' : 'outline'} onClick={validate}>
              <ShieldCheck /> Run validation
            </Button>
          )}
          {status === 'resolved' && (
            <Button variant="outline" onClick={() => setRun(w.id, { status: 'closed' })}>
              Close ticket
            </Button>
          )}
          {mode !== 'incident' && (
            <Button variant="ghost" onClick={() => setShowHint((v) => !v)}>
              <Lightbulb /> {showHint ? 'Hide hint' : 'Hint'}
            </Button>
          )}
        </div>
        {!w.seeded && status === 'open' && <Callout tone="info">Starting this ticket injects its hidden fault into the live simulation. In Practice and Incident modes the root cause is never shown: diagnose it.</Callout>}
        {w.seeded && <Callout tone="info">This issue already exists in the data hall. Investigate and fix it, then run validation.</Callout>}
        {showHint && mode !== 'incident' && <Callout tone="warn" title="Hint">{w.hint}</Callout>}
        {mode === 'incident' && <Callout tone="crit">Incident mode: no hints. Validate before closing the ticket.</Callout>}

        {checks && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Resolution criteria (evaluated against the simulation)</div>
            <ul className="space-y-1">
              {checks.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-[12px]">
                  {c.ok ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-crit" />}
                  {c.label}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!checks && live && (
          <div className="flex items-center gap-2 text-[12px] text-subtle">
            <CircleDashed className="size-4" /> Validation not run yet.
          </div>
        )}
        <PhaseNotice phase={6} title="Full ticket lifecycle and scoring">
          Assigned / Pending Parts states, action-sequence tracking, command accuracy and penalties for unnecessary replacements are scheduled for Phase 6. See the <Link className="text-accent-strong hover:underline" to="/learn/incident-management">Incident Management</Link> module.
        </PhaseNotice>
      </div>
    </Panel>
  );
}
