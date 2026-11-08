/**
 * Header (DESIGN.md §6.2): greeting / page title, pill selector, simulation
 * clock pill and round icon buttons. Every control is functional.
 */
import { Cable, FastForward, Laptop, Menu, Pause, Play, Settings, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { getCableModel } from '@/data/cables/cableCatalog';
import { CABLE_MIME, setDrag, useCableActions } from '@/hooks/useCableActions';
import { SPEEDS, type ClockSpeed } from '@/simulation/core/SimulationClock';
import { CONNECTOR_LABEL } from '@/simulation/networking/Cable';
import { useProgressStore } from '@/stores/progressStore';
import { useSim, useSimulationStore } from '@/stores/simulationStore';
import { type TrainingMode, useUiStore } from '@/stores/uiStore';
import { formatSimTime } from '@/utils/format';
import { HeaderAlerts, HeaderSearch } from './HeaderPopovers';
import { NAV } from './nav';

const MODES: { id: TrainingMode; label: string }[] = [
  { id: 'guided', label: 'Guided Learning' },
  { id: 'practice', label: 'Practice Lab' },
  { id: 'incident', label: 'Incident Simulation' },
];

function SimClock() {
  const timeMs = useSim((s) => s.timeMs);
  const startedAt = useSim((s) => s.startedAt);
  const running = useSimulationStore((s) => s.running);
  const speed = useSimulationStore((s) => s.speed);
  const setRunning = useSimulationStore((s) => s.setRunning);
  const setSpeed = useSimulationStore((s) => s.setSpeed);
  const skip = useSimulationStore((s) => s.skip);
  const stamp = formatSimTime(startedAt, timeMs);
  return (
    <div className="flex h-10 items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-4">
      <span className="font-mono text-[13px] font-medium tabular" aria-label="Simulation time">
        <span className="hidden text-muted 2xl:inline">{stamp.slice(0, 11)}</span>
        {stamp.slice(11)}
      </span>
      <Button size="icon" variant={running ? 'primary' : 'ghost'} aria-label={running ? 'Pause simulation' : 'Run simulation'} onClick={() => setRunning(!running)}>
        {running ? <Pause /> : <Play />}
      </Button>
      <select
        aria-label="Simulation speed"
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value) as ClockSpeed)}
        className="h-8 rounded-full bg-transparent px-1 text-[13px] font-medium outline-none"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <Button size="icon" variant="ghost" aria-label="Skip 30 seconds" title="Skip 30 s" onClick={() => skip(30000)}>
        <FastForward />
      </Button>
    </div>
  );
}

export function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const inHand = useUiStore((s) => s.cableInHand);
  const setInHand = useUiStore((s) => s.setCableInHand);
  const cable = useSim((s) => (inHand ? s.cables[inHand.cableId] : undefined));
  const laptopOpen = useUiStore((s) => s.laptopOpen);
  const setLaptopOpen = useUiStore((s) => s.setLaptopOpen);
  const mode = useUiStore((s) => s.trainingMode);
  const setMode = useUiStore((s) => s.setTrainingMode);
  const name = useProgressStore((s) => s.learnerName);
  const { stow } = useCableActions();

  const current = NAV.filter((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to))).at(-1);
  const isHome = location.pathname === '/';
  const title = isHome ? `Hello, ${name.split(' ')[0]} 👋` : (current?.label ?? 'DCT Simulator');

  return (
    <header className="shrink-0 border-b border-border px-4 pt-5 pb-4 lg:px-10 lg:pt-8 lg:pb-5">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="text-muted hover:text-fg lg:hidden" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>
          <Menu className="size-6" />
        </button>
        <h1 className="min-w-0 truncate text-[24px] leading-8 font-bold tracking-tight lg:text-[30px] lg:leading-9">{title}</h1>

        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <Select aria-label="Training mode" value={mode} onChange={(e) => setMode(e.target.value as TrainingMode)} className="hidden h-10 w-[190px] border-transparent bg-surface-2 md:block">
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
          <SimClock />
          <HeaderSearch />
          <HeaderAlerts />
          <Button size="icon-lg" variant={laptopOpen ? 'primary' : 'default'} aria-label="Laptop" aria-pressed={laptopOpen} title="Technician laptop" onClick={() => setLaptopOpen(!laptopOpen)}>
            <Laptop />
          </Button>
          <Button size="icon-lg" className="hidden sm:inline-flex" aria-label="Settings" title="Settings" onClick={() => navigate('/settings')}>
            <Settings />
          </Button>
        </div>
      </div>

      {inHand && cable && (
        <div
          draggable
          onDragStart={(e) => {
            setDrag({ kind: 'cable', cableId: cable.id });
            e.dataTransfer.setData(CABLE_MIME, cable.id);
          }}
          onDragEnd={() => setDrag(null)}
          className="mt-3 inline-flex cursor-grab items-center gap-2 rounded-full bg-info-soft py-1.5 pr-2 pl-4 text-[13px] font-medium text-info-ink active:cursor-grabbing"
          role="status"
          title="Drag onto a port, or select a port and choose Plug in here"
          data-testid="cable-in-hand"
        >
          <Cable className="size-4" />
          In hand: {getCableModel(cable.modelId).shortName} ·{' '}
          {inHand.freeEnd === null ? 'both ends free' : `${CONNECTOR_LABEL[getCableModel(cable.modelId).ends[inHand.freeEnd]]} free`}
          <button
            type="button"
            aria-label="Put the cable back in the spares cage"
            title="Put back in the spares cage"
            className="flex size-6 items-center justify-center rounded-full hover:bg-info/20"
            onClick={() => (cable.ends[0].portId || cable.ends[1].portId ? setInHand(null) : stow(cable.id))}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </header>
  );
}
