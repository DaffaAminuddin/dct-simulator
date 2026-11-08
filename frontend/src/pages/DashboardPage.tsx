/**
 * Dashboard in the DESIGN.md layout: hero card, Facility Record stat cards,
 * Power Flow chart, rack shortcuts and work-order chips in the centre column;
 * Activity and Technician Kit on the right. All values come from the engine.
 */
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  ClipboardList,
  Droplets,
  FlaskConical,
  HardDrive,
  Laptop,
  Microchip,
  Network,
  Server,
  Thermometer,
  Wrench,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { LineChart, Sparkline } from '@/components/dashboard/charts';
import { Page } from '@/components/layout/AppShell';
import { StatusDot } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { MODULES } from '@/data/learning/modules';
import { WORK_ORDERS } from '@/data/workorders/workOrders';
import { worstHealth } from '@/simulation/core/util';
import { displayedHealth, monitoringAlerts, visibleEvents } from '@/simulation/diagnostics/DiagnosticEngine';
import { useDevMode } from '@/stores/hardwareStore';
import { effectiveStatus, skillLevel, useProgressStore } from '@/stores/progressStore';
import { useSim } from '@/stores/simulationStore';
import { type Sample, useTelemetryStore, windowed } from '@/stores/telemetryStore';
import { useUiStore } from '@/stores/uiStore';
import type { EventCategory, Severity } from '@/types/simulation';
import { cn } from '@/utils/cn';
import { formatClock, formatW, healthTone } from '@/utils/format';
import { STATUS_LABEL } from './WorkOrdersPage';

const WINDOWS = [
  { id: '300000', label: 'Last 5 min' },
  { id: '900000', label: 'Last 15 min' },
  { id: '3600000', label: 'Last hour' },
];

const PASTELS = ['#e7fbec', '#fdebe2', '#e8edfa', '#e5f4f2', '#f9e3ec', '#fbf3d9', '#ece8fb'];

const CATEGORY_ICON: Record<EventCategory, typeof Zap> = {
  power: Zap,
  thermal: Thermometer,
  network: Network,
  hardware: HardDrive,
  system: Server,
  gpu: Microchip,
  cooling: Droplets,
  procedure: Wrench,
  fault: FlaskConical,
};

function delta(now: number, then: number | undefined): number | null {
  if (then === undefined || then === 0) return null;
  return Math.round(((now - then) / then) * 100);
}

function Trend({ pct, good = 'up', className }: { pct: number | null; good?: 'up' | 'down'; className?: string }) {
  if (pct === null || pct === 0) return <span className={cn('text-[11px] font-semibold text-[#5f5e68]', className)}>±0%</span>;
  const up = pct > 0;
  const ok = (up && good === 'up') || (!up && good === 'down');
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-semibold', ok ? 'text-[#15805a]' : 'text-[#c2303a]', className)}>
      <Icon className="size-3.5" />
      {Math.abs(pct)}%
    </span>
  );
}

function metric(s: Sample, scope: string, key: 'powerW' | 'alerts' | 'healthy' | 'hosts'): number {
  if (scope === 'all') return key === 'powerW' ? s.itW : s[key];
  return s.racks[scope]?.[key] ?? 0;
}

export function DashboardPage() {
  const s = useSim((st) => st);
  const devMode = useDevMode();
  const navigate = useNavigate();
  const samples = useTelemetryStore((st) => st.samples);
  const progress = useProgressStore();
  const [scope, setScope] = useState('all');
  const [win, setWin] = useState('900000');
  const [feed, setFeed] = useState<'alerts' | 'activity'>('activity');

  const series = useMemo(() => windowed(samples, Number(win)), [samples, win]);
  const first = series[0];
  const last = series.at(-1) as Sample;
  const alerts = useMemo(() => monitoringAlerts(s, devMode), [s, devMode]);
  const events = useMemo(() => visibleEvents(s.events, devMode).slice(-8).reverse(), [s.events, devMode]);
  const resolved = WORK_ORDERS.filter((w) => ['resolved', 'closed'].includes(effectiveStatus(progress.workOrders[w.id]))).length;
  const skill = skillLevel(progress.modulesCompleted.length, resolved);
  const nextModule = MODULES.find((m) => !progress.modulesCompleted.includes(m.id));
  const crit = alerts.filter((a) => a.severity === 'critical').length;
  const laptopEth = s.equipment[s.workstation.equipmentId]?.portIds.map((id) => s.ports[id]).find((p) => p?.defId === 'eth0');
  const cart = s.equipment[s.workstation.equipmentId]?.location;

  const hosts = metric(last, scope, 'hosts');
  const healthy = metric(last, scope, 'healthy');
  const scoped = (k: 'powerW' | 'alerts' | 'healthy') => series.map((x) => metric(x, scope, k));
  const labels = series.map((x) => formatClock(s.startedAt, x.t).slice(0, 5));

  const openAlert = (equipmentId: string, rackId?: string) => {
    useUiStore.getState().selectEquipment(equipmentId, rackId);
    navigate(rackId ? `/racks/${rackId}` : '/racks');
  };

  return (
    <Page>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* ------------------------------------------------ centre column */}
        <div className="min-w-0 space-y-8">
          {/* Hero card (inverse contrast) */}
          <section className="relative flex min-h-[154px] flex-wrap items-end justify-between gap-5 rounded-card bg-hero p-6 text-hero-fg" aria-label="Data hall status">
            <div className="space-y-6">
              <div className="text-[20px] leading-7 font-semibold">{s.facility.name}</div>
              <div>
                <div className="text-[32px] leading-10 font-bold tabular">{formatW(last.itW)}</div>
                <div className="text-[13px] opacity-70">
                  IT load · {last.healthy}/{last.hosts} hosts healthy · {crit} critical alert{crit === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-5">
              <div className="flex items-center gap-2">
                <Trend pct={delta(last.itW, first?.itW)} good="down" className="!text-trend" />
                <Sparkline values={series.map((x) => x.itW)} color="#22b07d" width={120} height={40} />
              </div>
              <div className="flex flex-wrap gap-2.5">
                <button type="button" onClick={() => navigate('/datacenter')} className="inline-flex h-[38px] items-center gap-2 whitespace-nowrap rounded-full bg-hero-fg px-5 text-[14px] font-medium text-hero transition-opacity hover:opacity-90">
                  <Building2 className="size-4" /> Open data hall
                </button>
                <button type="button" onClick={() => navigate('/workorders')} className="inline-flex h-[38px] items-center gap-2 whitespace-nowrap rounded-full border border-hero-fg/80 px-5 text-[14px] font-medium transition-colors hover:bg-hero-fg/10">
                  <ClipboardList className="size-4" /> Work orders
                </button>
              </div>
            </div>
          </section>

          {/* Facility Record */}
          <section>
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="h2 whitespace-nowrap">Facility Record</h2>
              <Select aria-label="Scope" className="w-[190px] shrink-0" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">All racks</option>
                {Object.values(s.racks).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} · {r.name.split('·')[1]?.trim()}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-6 sm:grid-cols-3">
              {[
                { label: 'Hosts healthy', value: hosts ? `${healthy}/${hosts}` : '—', values: scoped('healthy'), pct: delta(healthy, first ? metric(first, scope, 'healthy') : undefined), good: 'up' as const, bg: 'bg-[#e7fbec]', color: '#4cc38a', to: scope === 'all' ? '/racks' : `/racks/${scope}` },
                { label: 'Active alerts', value: String(metric(last, scope, 'alerts')), values: scoped('alerts'), pct: delta(metric(last, scope, 'alerts'), first ? metric(first, scope, 'alerts') : undefined), good: 'down' as const, bg: 'bg-[#fdebe2]', color: '#ee9f7e', to: scope === 'all' ? '/racks' : `/racks/${scope}` },
                { label: 'Power draw', value: formatW(metric(last, scope, 'powerW')), values: scoped('powerW'), pct: delta(metric(last, scope, 'powerW'), first ? metric(first, scope, 'powerW') : undefined), good: 'down' as const, bg: 'bg-[#e8edfa]', color: '#9aaae0', to: '/facility' },
              ].map((c) => (
                <Link key={c.label} to={c.to} className={cn('flex min-h-[152px] flex-col rounded-card p-5 text-[#16151c] transition-transform hover:-translate-y-0.5', c.bg)}>
                  <div className="flex items-center justify-between text-[12px] text-[#5f5e68]">
                    {c.label}
                    <ArrowUpRight className="size-4 opacity-60" />
                  </div>
                  <Sparkline values={c.values} color={c.color} width={110} height={36} className="my-auto" />
                  <div className="flex items-end justify-between gap-2">
                    <span className="text-[22px] leading-7 font-bold tabular">{c.value}</span>
                    <Trend pct={c.pct} good={c.good} />
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* Power Flow */}
          <section>
            <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2">
              <h2 className="h2">Power Flow</h2>
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                <span className="size-2 rounded-full bg-chart" /> Feed A
              </span>
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                <span className="size-2 rounded-full bg-warn" /> Feed B
              </span>
              <Select aria-label="Time window" value={win} onChange={(e) => setWin(e.target.value)} className="ml-auto">
                {WINDOWS.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </Select>
            </div>
            <LineChart
              series={[
                { name: 'Feed A', values: series.map((x) => x.feedA / 1000), color: 'var(--chart-main)' },
                { name: 'Feed B', values: series.map((x) => x.feedB / 1000), color: '#ee9f7e', dashed: true },
              ]}
              labels={labels}
              format={(v) => `${Math.round(v)} kW`}
            />
            {series.length < 3 && <p className="mt-1 text-[12px] text-muted">The chart fills in as simulated time passes (one sample every 5 s). Use ▶ or the skip button in the header.</p>}
          </section>

          {/* Jump to rack + Work orders */}
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-box border border-border p-5">
              <h2 className="mb-4 text-[17px] font-semibold">Jump to Rack</h2>
              <div className="flex flex-wrap gap-3.5">
                <button type="button" onClick={() => navigate('/datacenter')} aria-label="Open the 3D data hall" title="3D data hall" className="flex size-11 items-center justify-center rounded-full bg-fg text-bg">
                  <Building2 className="size-5" />
                </button>
                {Object.values(s.racks).map((r, i) => {
                  const h = worstHealth(Object.values(s.equipment).filter((e) => e.location.kind === 'rack' && e.location.rackId === r.id).map((e) => displayedHealth(s, e, devMode)));
                  return (
                    <Link key={r.id} to={`/racks/${r.id}`} title={r.name} className="relative flex size-11 items-center justify-center rounded-full text-[12px] font-bold text-[#16151c]" style={{ background: PASTELS[i % PASTELS.length] }}>
                      {r.id}
                      <StatusDot tone={healthTone(h)} className="absolute -right-0.5 -bottom-0.5 size-3 ring-2 ring-bg" />
                    </Link>
                  );
                })}
              </div>
            </section>
            <section className="rounded-box border border-border p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[17px] font-semibold">Work Orders</h2>
                <Link to="/workorders" className="text-[12px] font-medium text-muted hover:text-fg">
                  View all
                </Link>
              </div>
              <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                {WORK_ORDERS.map((w) => {
                  const st = effectiveStatus(progress.workOrders[w.id]);
                  return (
                    <Link key={w.id} to={`/workorders/${w.id}`} className="flex h-16 w-[112px] shrink-0 flex-col justify-center rounded-chip bg-surface-2 px-3 hover:bg-surface-3">
                      <span className="text-[12px] text-muted">
                        {w.id} · {w.priority}
                      </span>
                      <span className="truncate text-[14px] font-semibold">{STATUS_LABEL[st]}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          </div>
        </div>

        {/* ------------------------------------------------ right column */}
        <div className="min-w-0 space-y-6">
          <section className="rounded-box border border-border">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-[17px] font-semibold">{feed === 'alerts' ? 'Active Alerts' : 'Activity'}</h2>
              <Select aria-label="Feed" value={feed} onChange={(e) => setFeed(e.target.value as 'alerts' | 'activity')}>
                <option value="activity">Activity</option>
                <option value="alerts">Alerts ({alerts.length})</option>
              </Select>
            </div>
            <ul className="p-2">
              {feed === 'alerts' &&
                (alerts.length === 0 ? (
                  <li className="px-3 py-6 text-center text-[13px] text-muted">No active alerts.</li>
                ) : (
                  alerts.slice(0, 7).map((a) => (
                    <li key={a.key}>
                      <FeedItem severity={a.severity} title={a.hostname.replace('dh1-', '')} detail={a.message} right={a.rackId ?? ''} icon={Server} onClick={() => openAlert(a.equipmentId, a.rackId)} />
                    </li>
                  ))
                ))}
              {feed === 'activity' &&
                (events.length === 0 ? (
                  <li className="px-3 py-6 text-center text-[13px] text-muted">No activity yet. Start the clock with ▶ in the header.</li>
                ) : (
                  events.map((e) => (
                    <li key={e.id}>
                      <FeedItem severity={e.severity} title={e.message} detail={formatClock(s.startedAt, e.timeMs)} right={e.category} icon={CATEGORY_ICON[e.category]} onClick={e.equipmentId ? () => openAlert(e.equipmentId as string, (() => { const loc = s.equipment[e.equipmentId as string]?.location; return loc?.kind === 'rack' ? loc.rackId : undefined; })()) : undefined} />
                    </li>
                  ))
                ))}
            </ul>
          </section>

          <section className="rounded-box border border-border p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold">Technician Kit</h2>
              <Link to="/progress" className="text-[12px] font-medium text-muted hover:text-fg">
                View all
              </Link>
            </div>
            <div className="space-y-4">
              <button type="button" onClick={() => useUiStore.getState().openLaptopApp('home')} className="block w-full rounded-card bg-[#e5f4f2] p-5 text-left text-[#16151c] transition-transform hover:-translate-y-0.5">
                <div className="flex items-start justify-between">
                  <span className="text-[15px] font-bold">Technician laptop</span>
                  <Laptop className="size-5 opacity-70" />
                </div>
                <div className="mt-5 flex items-end justify-between gap-3 text-[12px]">
                  <div>
                    <div className="text-[#5f5e68]">eth0 address</div>
                    <div className="font-mono text-[13px] font-semibold">{laptopEth?.state === 'link_up' ? s.workstation.effective.address || 'no address' : 'not connected'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[#5f5e68]">{s.workstation.onAc ? 'AC' : 'Battery'}</div>
                    <div className="font-semibold tabular">{Math.round(s.workstation.batteryPct)}%</div>
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-[#5f5e68]">Cart at {cart?.kind === 'cart' ? `${cart.rackId} · ${cart.side === 'front' ? 'cold aisle' : 'hot aisle'}` : '—'}</div>
              </button>
              <Link to={nextModule ? `/learn/${nextModule.id}` : '/learn'} className="block rounded-card bg-[#e8edfa] p-5 text-[#16151c] transition-transform hover:-translate-y-0.5">
                <div className="flex items-start justify-between">
                  <span className="text-[15px] font-bold">{skill.title}</span>
                  <span className="text-[12px] font-semibold tabular">{skill.points} pts</span>
                </div>
                <div className="mt-5 text-[12px] text-[#5f5e68]">Next module</div>
                <div className="truncate text-[13px] font-semibold">{nextModule ? `${nextModule.number}. ${nextModule.title}` : 'All modules complete'}</div>
                <div className="mt-1 text-[11px] text-[#5f5e68]">
                  {progress.modulesCompleted.length}/{MODULES.length} modules · {resolved}/{WORK_ORDERS.length} tickets resolved
                </div>
              </Link>
            </div>
          </section>
        </div>
      </div>
    </Page>
  );
}

function FeedItem({ severity, title, detail, right, icon: Icon, onClick }: { severity: Severity; title: string; detail: string; right: string; icon: typeof Zap; onClick?: () => void }) {
  const color = severity === 'critical' ? 'text-crit' : severity === 'warning' ? 'text-warn' : 'text-ok';
  const content = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-chip bg-surface-2">
        <Icon className={cn('size-[18px]', color)} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{title}</span>
        <span className="block truncate text-[12px] text-muted">{detail}</span>
      </span>
      <span className="shrink-0 text-[12px] text-muted capitalize">{right}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex min-h-[58px] w-full items-center gap-3 rounded-chip px-3 text-left hover:bg-surface-2">
      {content}
    </button>
  ) : (
    <div className="flex min-h-[58px] items-center gap-3 px-3">{content}</div>
  );
}

