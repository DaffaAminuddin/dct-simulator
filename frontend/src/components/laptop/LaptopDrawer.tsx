/**
 * The technician laptop's screen: a desktop with network, diagnostic and
 * work-order tools. Opened from the top bar on any page.
 */
import { ArrowLeft, BatteryCharging, BatteryLow, BatteryMedium, ClipboardList, Globe, HardDrive, KeyRound, Microchip, Network, Radio, SquareTerminal, Terminal, X } from 'lucide-react';
import type { ComponentType } from 'react';
import { useNavigate } from 'react-router';
import { StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Mono } from '@/components/ui/misc';
import { laptopPort } from '@/simulation/workstation/Workstation';
import { useSim } from '@/stores/simulationStore';
import { type LaptopApp, useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { formatClock } from '@/utils/format';
import { LaptopTerminalApp } from '@/components/terminal/TerminalPanel';
import { BrowserApp, ConsoleApp, NetworkApp, PingApp, SshApp } from './LaptopApps';

const APPS: { id: Exclude<LaptopApp, 'home'>; label: string; icon: ComponentType<{ className?: string }>; component: ComponentType }[] = [
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal, component: LaptopTerminalApp },
  { id: 'network', label: 'Network settings', icon: Network, component: NetworkApp },
  { id: 'ping', label: 'Ping', icon: Radio, component: PingApp },
  { id: 'ssh', label: 'SSH client', icon: KeyRound, component: SshApp },
  { id: 'browser', label: 'Browser', icon: Globe, component: BrowserApp },
  { id: 'console', label: 'Serial console', icon: Terminal, component: ConsoleApp },
];

const SHORTCUTS = [
  { to: '/workorders', label: 'Work orders', icon: ClipboardList },
  { to: '/inventory', label: 'Hardware inventory', icon: HardDrive },
  { to: '/gpu', label: 'Diagnostics dashboard', icon: Microchip },
];

function Tray() {
  const ws = useSim((s) => s.workstation);
  const eth = useSim((s) => laptopPort(s, 'eth0'));
  const time = useSim((s) => formatClock(s.startedAt, s.timeMs));
  const Battery = ws.onAc ? BatteryCharging : ws.batteryPct < 20 ? BatteryLow : BatteryMedium;
  const linkUp = eth?.state === 'link_up';
  return (
    <div className="flex items-center gap-3 text-[12px] text-muted" aria-label="Laptop status">
      <span className="flex items-center gap-1.5" title={linkUp ? 'eth0 link up' : 'eth0: no link'}>
        <StatusDot tone={linkUp ? (ws.effective.source === 'apipa' ? 'warn' : 'ok') : 'muted'} />
        <Mono>{linkUp ? ws.effective.address || 'no address' : 'eth0 down'}</Mono>
      </span>
      <span className={cn('flex items-center gap-1', !ws.onAc && ws.batteryPct < 20 && 'text-warn')} title={ws.onAc ? 'On AC power' : 'On battery'}>
        <Battery className="size-4" />
        <span className="tabular">{Math.round(ws.batteryPct)}%</span>
      </span>
      <Mono>{time}</Mono>
    </div>
  );
}

export function LaptopDrawer() {
  const open = useUiStore((s) => s.laptopOpen);
  const app = useUiStore((s) => s.laptopApp);
  const setOpen = useUiStore((s) => s.setLaptopOpen);
  const openApp = useUiStore((s) => s.openLaptopApp);
  const poweredOn = useSim((s) => s.workstation.poweredOn);
  const cart = useSim((s) => s.equipment[s.workstation.equipmentId]?.location);
  const navigate = useNavigate();
  if (!open) return null;
  const current = APPS.find((a) => a.id === app);

  return (
    <aside
      role="dialog"
      aria-label="Technician laptop"
      className="fixed top-3 right-3 bottom-3 z-40 flex w-[min(720px,calc(100vw-24px))] flex-col overflow-hidden rounded-box border border-border bg-surface shadow-[0_24px_60px_rgba(22,21,28,0.18)]"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-5">
        <span className="text-[15px] font-semibold">tech-laptop</span>
        <span className="truncate text-[12px] text-muted">
          Technician image (simulated) · cart at {cart?.kind === 'cart' ? `${cart.rackId} ${cart.side === 'front' ? 'cold aisle' : 'hot aisle'}` : '—'}
        </span>
        <Button size="icon" variant="ghost" className="ml-auto" aria-label="Close laptop" onClick={() => setOpen(false)}>
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 p-5">
        {!poweredOn ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[12px] text-muted">
            <BatteryLow className="size-8 text-warn" />
            The laptop battery is empty. Plug the laptop power adapter (C14 → USB-C) into a live PDU outlet to power it on.
          </div>
        ) : current ? (
          <div className="rounded-box border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <Button size="icon" variant="ghost" aria-label="Back to desktop" onClick={() => openApp('home')}>
                <ArrowLeft />
              </Button>
              <current.icon className="size-4 text-ok-ink" />
              <span className="text-[15px] font-semibold">{current.label}</span>
            </div>
            <div className="p-4">
              <current.component />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {APPS.map((a) => (
              <button key={a.id} type="button" onClick={() => openApp(a.id)} className="flex flex-col items-center gap-2 rounded-card p-3 text-[13px] font-medium text-fg hover:bg-surface">
                <span className="flex size-12 items-center justify-center rounded-chip bg-ok-soft">
                  <a.icon className="size-5 text-ok-ink" />
                </span>
                {a.label}
              </button>
            ))}
            {SHORTCUTS.map((sc) => (
              <button
                key={sc.to}
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate(sc.to);
                }}
                className="flex flex-col items-center gap-2 rounded-card p-3 text-[13px] font-medium text-fg hover:bg-surface"
              >
                <span className="flex size-12 items-center justify-center rounded-chip bg-info-soft">
                  <sc.icon className="size-5 text-info-ink" />
                </span>
                {sc.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <footer className="flex h-12 shrink-0 items-center gap-1 border-t border-border px-3">
        {APPS.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-label={`Open ${a.label}`}
            title={a.label}
            onClick={() => openApp(a.id)}
            className={cn('flex size-8 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg', app === a.id && 'bg-ok-soft text-ok-ink')}
          >
            <a.icon className="size-4" />
          </button>
        ))}
        <div className="ml-auto">
          <Tray />
        </div>
      </footer>
    </aside>
  );
}
