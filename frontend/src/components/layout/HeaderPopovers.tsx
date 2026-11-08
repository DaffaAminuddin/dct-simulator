/** Header search (jump to rack / host / IP / ticket) and alerts popovers. */
import { Bell, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Mono } from '@/components/ui/misc';
import { WORK_ORDERS } from '@/data/workorders/workOrders';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { monitoringAlerts } from '@/simulation/diagnostics/DiagnosticEngine';
import { useDevMode } from '@/stores/hardwareStore';
import { getSim, useSim } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

interface Hit {
  key: string;
  label: string;
  detail: string;
  go: () => void;
}

export function HeaderSearch() {
  const { open, setOpen, ref } = usePopover();
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const ui = useUiStore.getState;

  const hits = useMemo<Hit[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const s = getSim();
    const out: Hit[] = [];
    const openEq = (id: string) => {
      const eq = s.equipment[id];
      if (eq.kind === 'laptop') return ui().openLaptopApp('home');
      if (eq.location.kind === 'rack') {
        ui().selectEquipment(id, eq.location.rackId);
        navigate(`/racks/${eq.location.rackId}`);
      } else if (eq.location.kind === 'inventory') navigate('/inventory');
      else navigate('/facility');
    };
    for (const r of Object.values(s.racks)) {
      if (`${r.id} ${r.name}`.toLowerCase().includes(term)) out.push({ key: r.id, label: r.id, detail: r.name, go: () => navigate(`/racks/${r.id}`) });
    }
    for (const e of Object.values(s.equipment)) {
      if (e.kind === 'blank') continue;
      if (`${e.hostname} ${e.serial} ${e.assetTag}`.toLowerCase().includes(term)) {
        const loc = e.location.kind === 'rack' ? e.location.rackId : e.location.kind;
        out.push({ key: e.id, label: e.hostname, detail: `${getEquipmentModel(e.modelId).shortName} · ${loc}`, go: () => openEq(e.id) });
      }
    }
    for (const p of Object.values(s.ports)) {
      if (p.ip && p.ip.address.startsWith(term)) out.push({ key: p.id, label: p.ip.address, detail: `${s.equipment[p.equipmentId].hostname} · ${p.label}`, go: () => openEq(p.equipmentId) });
    }
    for (const w of WORK_ORDERS) {
      if (`${w.id} ${w.title}`.toLowerCase().includes(term)) out.push({ key: w.id, label: w.id, detail: w.title, go: () => navigate(`/workorders/${w.id}`) });
    }
    return out.slice(0, 8);
  }, [q, navigate, ui]);

  const pick = (h: Hit) => {
    h.go();
    setOpen(false);
    setQ('');
  };

  return (
    <div className="relative" ref={ref}>
      <Button size="icon-lg" aria-label="Search" title="Search racks, hosts, IPs and tickets" onClick={() => setOpen(!open)}>
        <Search />
      </Button>
      {open && (
        <div className="absolute top-12 right-0 z-50 w-[min(380px,calc(100vw-32px))] rounded-card border border-border bg-surface p-2 shadow-[0_16px_40px_rgba(22,21,28,0.14)]">
          <input
            autoFocus
            aria-label="Search the data hall"
            placeholder="Rack, hostname, serial, IP or ticket…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && hits[0] && pick(hits[0])}
            className="h-10 w-full rounded-full bg-surface-2 px-4 text-[14px] outline-none placeholder:text-subtle"
          />
          <ul className="mt-1 max-h-80 overflow-y-auto">
            {q && hits.length === 0 && <li className="px-3 py-3 text-[13px] text-muted">No matches</li>}
            {hits.map((h) => (
              <li key={h.key}>
                <button type="button" onClick={() => pick(h)} className="flex w-full items-baseline gap-2 rounded-chip px-3 py-2 text-left hover:bg-surface-2">
                  <Mono className="shrink-0 text-[13px] text-fg">{h.label}</Mono>
                  <span className="truncate text-[12px] text-muted">{h.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function HeaderAlerts() {
  const { open, setOpen, ref } = usePopover();
  const devMode = useDevMode();
  const equipment = useSim((s) => s.equipment);
  const components = useSim((s) => s.components);
  const navigate = useNavigate();
  const alerts = useMemo(() => monitoringAlerts(getSim(), devMode), [equipment, components, devMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const crit = alerts.filter((a) => a.severity === 'critical').length;

  return (
    <div className="relative" ref={ref}>
      <Button size="icon-lg" aria-label={`Alerts (${alerts.length})`} title="Active alerts" onClick={() => setOpen(!open)}>
        <Bell />
      </Button>
      {alerts.length > 0 && <span className={cn('pointer-events-none absolute top-2 right-2.5 size-2 rounded-full ring-2 ring-bg', crit ? 'bg-crit' : 'bg-warn')} />}
      {open && (
        <div className="absolute top-12 right-0 z-50 w-[min(400px,calc(100vw-32px))] rounded-card border border-border bg-surface p-2 shadow-[0_16px_40px_rgba(22,21,28,0.14)]">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[15px] font-semibold">Active alerts</span>
            <span className="text-[12px] text-muted">{alerts.length} open</span>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {alerts.length === 0 && <li className="px-3 py-3 text-[13px] text-muted">Monitoring reports every device healthy.</li>}
            {alerts.slice(0, 10).map((a) => (
              <li key={a.key}>
                <button
                  type="button"
                  onClick={() => {
                    useUiStore.getState().selectEquipment(a.equipmentId, a.rackId);
                    navigate(a.rackId ? `/racks/${a.rackId}` : '/');
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 rounded-chip px-3 py-2 text-left hover:bg-surface-2"
                >
                  <Badge tone={a.severity === 'critical' ? 'crit' : 'warn'} className="mt-0.5 shrink-0">
                    {a.severity === 'critical' ? 'Critical' : 'Warning'}
                  </Badge>
                  <span className="min-w-0 text-[13px]">
                    <span className="font-medium">{a.hostname.replace('dh1-', '')}</span> <span className="text-muted">{a.message}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
