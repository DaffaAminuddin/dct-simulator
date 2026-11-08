import { Cable, FastForward, Menu, Pause, Play, X } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { getCableModel } from '@/data/cables/cableCatalog';
import { isHost } from '@/simulation/core/SimulationState';
import { SPEEDS, type ClockSpeed } from '@/simulation/core/SimulationClock';
import { monitoringAlerts } from '@/simulation/diagnostics/DiagnosticEngine';
import { useSim, useSimulationStore } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import { formatSimTime, formatW } from '@/utils/format';
import { NAV } from './nav';

function useFacilitySummary() {
  const equipment = useSim((s) => s.equipment);
  const components = useSim((s) => s.components);
  const facility = useSim((s) => s.facility);
  const devMode = useUiStore((s) => s.devMode);
  return useMemo(() => {
    const s = useSimulationStore.getState().state;
    const hosts = Object.values(equipment).filter((e) => isHost(e) && e.location.kind === 'rack');
    const running = hosts.filter((h) => h.state === 'os_running').length;
    const alerts = monitoringAlerts(s, devMode);
    const load = facility.feeds.A.loadW + facility.feeds.B.loadW;
    return {
      hosts: hosts.length,
      running,
      crit: alerts.filter((a) => a.severity === 'critical').length,
      warn: alerts.filter((a) => a.severity === 'warning').length,
      load,
    };
  }, [equipment, components, facility, devMode]);
}

export function TopBar() {
  const location = useLocation();
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const timeMs = useSim((s) => s.timeMs);
  const startedAt = useSim((s) => s.startedAt);
  const running = useSimulationStore((s) => s.running);
  const speed = useSimulationStore((s) => s.speed);
  const setRunning = useSimulationStore((s) => s.setRunning);
  const setSpeed = useSimulationStore((s) => s.setSpeed);
  const skip = useSimulationStore((s) => s.skip);
  const sum = useFacilitySummary();
  const feeds = useSim((s) => s.facility.feeds);
  const inHand = useUiStore((s) => s.cableInHand);
  const setInHand = useUiStore((s) => s.setCableInHand);
  const cable = useSim((s) => (inHand ? s.cables[inHand.cableId] : undefined));

  const current = NAV.filter((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to))).at(-1);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <button type="button" className="text-muted hover:text-fg lg:hidden" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>
        <Menu className="size-5" />
      </button>
      <h1 className="truncate text-[13px] font-semibold">{current?.label ?? 'DCT Simulator'}</h1>

      {inHand && cable && (
        <div className="hidden items-center gap-1.5 rounded-[5px] border border-info/40 bg-info/10 px-2 py-1 text-[11.5px] text-[#9fd0f3] md:flex" role="status">
          <Cable className="size-3.5" />
          In hand: {getCableModel(cable.modelId).shortName} · end {inHand.freeEnd === 0 ? 'A' : 'B'} free. Select a port to plug it in
          <button type="button" aria-label="Put the cable down" className="ml-1 hover:text-fg" onClick={() => setInHand(null)}>
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Link to="/" className="hidden items-center gap-3 text-[11.5px] text-muted xl:flex" title="Facility summary (monitoring view)">
          <span className="flex items-center gap-1.5">
            <StatusDot tone={sum.running === sum.hosts ? 'ok' : 'warn'} />
            <span className="tabular">
              {sum.running}/{sum.hosts}
            </span>
            hosts healthy
          </span>
          {sum.crit > 0 && <Badge tone="crit">{sum.crit} critical</Badge>}
          {sum.warn > 0 && <Badge tone="warn">{sum.warn} warning</Badge>}
          <span className="flex items-center gap-1">
            Feeds
            <StatusDot tone={feeds.A.up ? 'ok' : 'crit'} label={`Feed A ${feeds.A.up ? 'up' : 'down'}`} />
            <StatusDot tone={feeds.B.up ? 'ok' : 'crit'} label={`Feed B ${feeds.B.up ? 'up' : 'down'}`} />
          </span>
          <span className="tabular">IT {formatW(sum.load)}</span>
        </Link>

        <div className="flex items-center gap-1 rounded-[5px] border border-border-strong bg-surface-2 py-0.5 pr-0.5 pl-2">
          <span className="font-mono text-[11.5px] tabular text-fg" aria-label="Simulation time">
            <span className="hidden sm:inline">{formatSimTime(startedAt, timeMs).slice(0, 11)}</span>
            {formatSimTime(startedAt, timeMs).slice(11)}
          </span>
          <Button size="icon" variant={running ? 'primary' : 'ghost'} aria-label={running ? 'Pause simulation' : 'Run simulation'} onClick={() => setRunning(!running)} className="size-6">
            {running ? <Pause /> : <Play />}
          </Button>
          <Select aria-label="Simulation speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value) as ClockSpeed)} className="h-6 border-transparent bg-transparent px-1">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </Select>
          <Button size="icon" variant="ghost" className="size-6" aria-label="Skip 30 seconds" title="Skip 30 s" onClick={() => skip(30000)}>
            <FastForward />
          </Button>
        </div>
      </div>
    </header>
  );
}
