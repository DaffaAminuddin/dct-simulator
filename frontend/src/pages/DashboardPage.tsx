import { ArrowRight, BookOpen, ClipboardList, FlaskConical } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Mono } from '@/components/ui/misc';
import { EmptyState, Meter, Panel, Stat } from '@/components/ui/panel';
import { MODULES } from '@/data/learning/modules';
import { WORK_ORDERS } from '@/data/workorders/workOrders';
import { isHost } from '@/simulation/core/SimulationState';
import { displayedHealth, monitoringAlerts, visibleEvents } from '@/simulation/diagnostics/DiagnosticEngine';
import { worstHealth } from '@/simulation/core/util';
import { useDevMode } from '@/stores/hardwareStore';
import { effectiveStatus, skillLevel, useProgressStore } from '@/stores/progressStore';
import { useSim } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import { formatClock, formatTemp, formatW, healthTone, severityTone } from '@/utils/format';
import { STATUS_LABEL, STATUS_TONE } from './WorkOrdersPage';

export function DashboardPage() {
  const s = useSim((st) => st);
  const devMode = useDevMode();
  const navigate = useNavigate();
  const selectEquipment = useUiStore((st) => st.selectEquipment);
  const progress = useProgressStore();

  const hosts = useMemo(() => Object.values(s.equipment).filter((e) => isHost(e) && e.location.kind === 'rack'), [s.equipment]);
  const alerts = useMemo(() => monitoringAlerts(s, devMode), [s, devMode]);
  const events = useMemo(() => visibleEvents(s.events, devMode).slice(-14).reverse(), [s.events, devMode]);
  const resolved = WORK_ORDERS.filter((w) => ['resolved', 'closed'].includes(effectiveStatus(progress.workOrders[w.id]))).length;
  const activeWos = WORK_ORDERS.filter((w) => !['resolved', 'closed'].includes(effectiveStatus(progress.workOrders[w.id])));
  const skill = skillLevel(progress.modulesCompleted.length, resolved);
  const nextModule = MODULES.find((m) => !progress.modulesCompleted.includes(m.id) && m.labs.length > 0) ?? MODULES.find((m) => !progress.modulesCompleted.includes(m.id));
  const running = hosts.filter((h) => h.state === 'os_running').length;
  const load = s.facility.feeds.A.loadW + s.facility.feeds.B.loadW;
  const crit = alerts.filter((a) => a.severity === 'critical').length;

  const openAlert = (equipmentId: string, rackId?: string) => {
    selectEquipment(equipmentId, rackId);
    navigate(rackId ? `/racks/${rackId}` : '/racks');
  };

  return (
    <Page className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Training progress" value={`${Math.round((progress.modulesCompleted.length / MODULES.length) * 100)}%`} sub={`${progress.modulesCompleted.length} of ${MODULES.length} modules`} />
        <Stat label="Skill level" value={skill.title} sub={`${skill.points} pts${skill.next > skill.points ? ` · next at ${skill.next}` : ''}`} />
        <Stat label="Active work orders" value={activeWos.length} sub={`${resolved} resolved`} />
        <Stat label="Hosts healthy" value={`${running}/${hosts.length}`} sub="OS running, no degradation" tone={running < hosts.length ? 'warn' : undefined} />
        <Stat label="IT load" value={formatW(load)} sub={`Feed A ${formatW(s.facility.feeds.A.loadW)} · B ${formatW(s.facility.feeds.B.loadW)}`} />
        <Stat label="Active alerts" value={alerts.length} sub={`${crit} critical`} tone={crit ? 'crit' : alerts.length ? 'warn' : undefined} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="Hardware health overview" subtitle={devMode ? 'Ground truth (developer mode)' : 'Monitoring view (BMC / device management)'}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Object.values(s.racks).map((r) => {
              const eqs = Object.values(s.equipment).filter((e) => e.location.kind === 'rack' && e.location.rackId === r.id);
              const rh = eqs.filter(isHost);
              const health = worstHealth(eqs.map((e) => displayedHealth(s, e, devMode)));
              return (
                <Link key={r.id} to={`/racks/${r.id}`} className="rounded-[5px] border border-border bg-surface-2 p-2.5 hover:border-border-strong">
                  <div className="flex items-center gap-2">
                    <StatusDot tone={healthTone(health)} />
                    <Mono className="text-[12.5px] text-fg">{r.id}</Mono>
                    <span className="truncate text-[11px] text-muted">{r.name.split('·')[1]?.trim()}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-[11px]">
                    <div>
                      <div className="text-subtle">Hosts</div>
                      <div className="tabular">{rh.length ? `${rh.filter((h) => h.state === 'os_running').length}/${rh.length}` : '—'}</div>
                    </div>
                    <div>
                      <div className="text-subtle">Load</div>
                      <div className="tabular">{formatW(r.powerW)}</div>
                    </div>
                    <div>
                      <div className="text-subtle">Inlet</div>
                      <div className="tabular">{formatTemp(r.inletC)}</div>
                    </div>
                  </div>
                  <Meter className="mt-2" value={r.powerW} max={r.maxPowerW} tone={r.powerW > r.maxPowerW * 0.8 ? 'warn' : 'ok'} label={`${r.id} power`} />
                </Link>
              );
            })}
          </div>
        </Panel>

        <Panel title="Active alerts" subtitle={`${alerts.length} open`} bodyClassName="p-0">
          {alerts.length === 0 ? (
            <EmptyState title="No active alerts">Monitoring reports every device healthy.</EmptyState>
          ) : (
            <ul className="max-h-[300px] divide-y divide-border overflow-y-auto">
              {alerts.map((a) => (
                <li key={a.key}>
                  <button type="button" onClick={() => openAlert(a.equipmentId, a.rackId)} className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-surface-2">
                    <Badge tone={a.severity === 'critical' ? 'crit' : 'warn'} className="mt-px">
                      {a.severity === 'critical' ? 'CRIT' : 'WARN'}
                    </Badge>
                    <span className="min-w-0 text-[12px]">
                      <Mono className="text-muted">{a.hostname}</Mono> <span>{a.message}</span>
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[10.5px] text-subtle">{a.rackId}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel
          title="Work orders"
          actions={
            <Button size="xs" variant="ghost" onClick={() => navigate('/workorders')}>
              All <ArrowRight />
            </Button>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {WORK_ORDERS.slice(0, 6).map((w) => {
              const st = effectiveStatus(progress.workOrders[w.id]);
              return (
                <li key={w.id}>
                  <Link to={`/workorders/${w.id}`} className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-2">
                    <ClipboardList className="size-3.5 shrink-0 text-subtle" />
                    <Mono className="text-muted">{w.id}</Mono>
                    <Badge tone={w.priority === 'P1' ? 'crit' : w.priority === 'P2' ? 'warn' : 'muted'}>{w.priority}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[12px]">{w.title}</span>
                    <Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Recommended next module">
          {nextModule ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <BookOpen className="size-4 text-accent" />
                <span className="text-[13px] font-medium">
                  {nextModule.number}. {nextModule.title}
                </span>
              </div>
              <p className="text-[12px] text-muted">{nextModule.summary}</p>
              <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-muted">
                {nextModule.objectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="xs" variant="primary" onClick={() => navigate(`/learn/${nextModule.id}`)}>
                  Open module
                </Button>
                {nextModule.labs.slice(0, 1).map((l) => (
                  <Button key={l.to} size="xs" variant="outline" onClick={() => navigate(l.to)}>
                    {l.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState title="All modules complete" />
          )}
        </Panel>

        <Panel title="Available labs" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {[
              { to: '/datacenter', label: 'Walk the data hall (3D)', ready: true },
              { to: '/racks/R05', label: 'Inspect a GB200 NVL72 reference rack', ready: true },
              { to: '/hardware/srv-r03-g01', label: 'Open an 8-GPU server chassis', ready: true },
              { to: '/workorders/DCT-0002', label: 'Restore A+B power redundancy', ready: true },
              { to: '/workorders/DCT-0008', label: 'Onboard the technician laptop (cabling, DHCP, SSH)', ready: true },
              { to: '/workorders/DCT-0007', label: 'BMC unreachable with a green link LED', ready: true },
              { to: '/settings', label: 'Fault injection (developer mode)', ready: true, icon: true },
              { to: '/terminal', label: 'Linux & NVIDIA terminal', ready: false },
            ].map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-surface-2">
                  {l.icon ? <FlaskConical className="size-3.5 text-warn" /> : <ArrowRight className="size-3.5 text-subtle" />}
                  <span className="flex-1">{l.label}</span>
                  {!l.ready && <Badge>Phase 3</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Recent activity" subtitle="Simulation events visible to monitoring" bodyClassName="p-0">
        {events.length === 0 ? (
          <EmptyState title="No activity yet">Actions you take and state changes in the hall will appear here. Start the clock with ▶ in the top bar.</EmptyState>
        ) : (
          <ul className="divide-y divide-border font-mono text-[11.5px]">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-2 px-3 py-1">
                <span className="shrink-0 text-subtle tabular">{formatClock(s.startedAt, e.timeMs)}</span>
                <Badge tone={severityTone(e.severity)} className="h-4 shrink-0 text-[10px]">
                  {e.category}
                </Badge>
                <span className={e.devOnly ? 'text-warn' : 'text-fg/90'}>{e.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Page>
  );
}
