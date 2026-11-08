/**
 * The technician laptop's screen: a desktop with network, diagnostic and
 * work-order tools. Opened from the top bar on any page.
 */
import { ArrowLeft, BatteryCharging, BatteryLow, BatteryMedium, ClipboardList, Globe, HardDrive, Microchip, Network, Radio, SquareTerminal, Terminal, X } from 'lucide-react';
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
import { BrowserApp, ConsoleApp, NetworkApp, PingApp, SshApp } from './LaptopApps';

const APPS: { id: Exclude<LaptopApp, 'home'>; label: string; icon: ComponentType<{ className?: string }>; component: ComponentType }[] = [
  { id: 'network', label: 'Network settings', icon: Network, component: NetworkApp },
  { id: 'ping', label: 'Ping', icon: Radio, component: PingApp },
  { id: 'ssh', label: 'SSH client', icon: SquareTerminal, component: SshApp },
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
    <div className="flex items-center gap-3 text-[11px] text-muted" aria-label="Laptop status">
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
      className="fixed top-12 right-0 bottom-0 z-40 flex w-[min(720px,100vw)] flex-col border-l border-border-strong bg-[#0a0d0f] shadow-2xl shadow-black/60"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <span className="text-[12px] font-semibold">tech-laptop</span>
        <span className="truncate text-[11px] text-subtle">
          Technician image (simulated) · cart at {cart?.kind === 'cart' ? `${cart.rackId} ${cart.side === 'front' ? 'cold aisle' : 'hot aisle'}` : '—'}
        </span>
        <Button size="icon" variant="ghost" className="ml-auto size-6" aria-label="Close laptop" onClick={() => setOpen(false)}>
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_30%_20%,#13201a_0%,#0a0d0f_60%)] p-4">
        {!poweredOn ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[12px] text-muted">
            <BatteryLow className="size-8 text-warn" />
            The laptop battery is empty. Plug the laptop power adapter (C14 → USB-C) into a live PDU outlet to power it on.
          </div>
        ) : current ? (
          <div className="rounded-md border border-border bg-surface/95">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <Button size="icon" variant="ghost" className="size-6" aria-label="Back to desktop" onClick={() => openApp('home')}>
                <ArrowLeft />
              </Button>
              <current.icon className="size-4 text-accent" />
              <span className="text-[12.5px] font-medium">{current.label}</span>
            </div>
            <div className="p-3">
              <current.component />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {APPS.map((a) => (
              <button key={a.id} type="button" onClick={() => openApp(a.id)} className="flex flex-col items-center gap-1.5 rounded-md p-3 text-[11.5px] text-fg/90 hover:bg-white/5">
                <span className="flex size-11 items-center justify-center rounded-lg border border-border-strong bg-surface-3">
                  <a.icon className="size-5 text-accent" />
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
                className="flex flex-col items-center gap-1.5 rounded-md p-3 text-[11.5px] text-fg/90 hover:bg-white/5"
              >
                <span className="flex size-11 items-center justify-center rounded-lg border border-border-strong bg-surface-3">
                  <sc.icon className="size-5 text-info" />
                </span>
                {sc.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <footer className="flex h-10 shrink-0 items-center gap-1 border-t border-border bg-surface px-2">
        {APPS.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-label={`Open ${a.label}`}
            title={a.label}
            onClick={() => openApp(a.id)}
            className={cn('flex size-7 items-center justify-center rounded-[4px] text-muted hover:bg-surface-3 hover:text-fg', app === a.id && 'bg-surface-3 text-accent')}
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
