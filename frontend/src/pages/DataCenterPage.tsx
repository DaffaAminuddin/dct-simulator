import { Box, Crosshair, Map as MapIcon, Rows3 } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { FloorPlan2D } from '@/components/datacenter/FloorPlan2D';
import { DeviceInfoCard } from '@/components/device/DeviceInfoCard';
import { usePageMemory } from '@/hooks/usePageMemory';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/misc';
import { KV, Panel } from '@/components/ui/panel';
import { Segmented } from '@/components/ui/tabs';
import { useWebGLAvailable } from '@/hooks/useWebGL';
import { isHost } from '@/simulation/core/SimulationState';
import { displayedHealth, monitoringAlerts } from '@/simulation/diagnostics/DiagnosticEngine';
import { worstHealth } from '@/simulation/core/util';
import { useDevMode } from '@/stores/hardwareStore';
import { useSim } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { formatTemp, formatW, healthTone } from '@/utils/format';
import type { CameraPreset } from '@/scenes/DataHallScene/DataHallScene';

const DataHallScene = lazy(() => import('@/scenes/DataHallScene/DataHallScene'));

const PRESETS: { id: CameraPreset; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'cold', label: 'Cold aisle' },
  { id: 'hotA', label: 'Hot aisle A' },
  { id: 'hotB', label: 'Hot aisle B' },
  { id: 'top', label: 'Top' },
];

/** Units in a rack (top of rack first) with the selected unit's device information. */
function RackUnits({ rackId }: { rackId: string }) {
  const navigate = useNavigate();
  const equipment = useSim((st) => st.equipment);
  const ports = useSim((st) => st.ports);
  const [unitId, setUnitId] = usePageMemory('dataHallUnitId');
  const units = useMemo(
    () =>
      Object.values(equipment)
        .filter((e) => e.location.kind === 'rack' && e.location.rackId === rackId && e.kind !== 'blank')
        .sort((a, b) => (b.location.kind === 'rack' ? (b.location.uStart ?? -1) : 0) - (a.location.kind === 'rack' ? (a.location.uStart ?? -1) : 0)),
    [equipment, rackId],
  );
  const selected = units.find((u) => u.id === unitId);
  const uLabel = (e: (typeof units)[number]) => (e.location.kind === 'rack' ? (e.location.uStart === null ? '0U' : `U${e.location.uStart}`) : '');
  const bmcIp = (e: (typeof units)[number]) => e.portIds.map((id) => ports[id]).find((p) => p?.role === 'bmc')?.ip?.address;
  return (
    <Panel title={`Units in ${rackId}`} subtitle="Select a unit for SN, PN and addresses" bodyClassName="p-1.5">
      {units.length === 0 ? (
        <div className="p-2 text-[12px] text-subtle">No equipment installed.</div>
      ) : (
        <ul className="max-h-[260px] space-y-0.5 overflow-y-auto" aria-label={`Units in ${rackId}`}>
          {units.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => setUnitId(u.id === unitId ? null : u.id)}
                aria-current={u.id === unitId}
                className={cn('flex w-full items-center gap-2 rounded-chip px-2 py-1 text-left hover:bg-surface-3', u.id === unitId && 'bg-surface-3 shadow-[inset_2px_0_0_var(--color-accent)]')}
              >
                <span className="w-9 shrink-0 font-mono text-[11px] text-subtle">{uLabel(u)}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{u.hostname}</span>
                <span className="font-mono text-[11px] text-muted">{bmcIp(u) ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="mt-2 space-y-3 border-t border-border px-2 pt-3 pb-1">
          <DeviceInfoCard equipmentId={selected.id} compact />
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              useUiStore.getState().selectEquipment(selected.id, rackId);
              navigate(`/racks/${rackId}`);
            }}
          >
            <Rows3 /> Show {selected.hostname} in Rack Explorer
          </Button>
        </div>
      )}
    </Panel>
  );
}

export function DataCenterPage() {
  const navigate = useNavigate();
  const s = useSim((st) => st);
  const devMode = useDevMode();
  const webgl = useWebGLAvailable();
  const view = useUiStore((st) => st.dataHallView);
  const setView = useUiStore((st) => st.setDataHallView);
  // The data hall remembers its own rack; Rack Explorer only follows when a rack is opened there.
  const explorerRackId = useUiStore((st) => st.selectedRackId);
  const [hallRackId, setHallRackId] = usePageMemory('dataHallRackId');
  const selectedRackId = hallRackId ?? explorerRackId;
  const [presetMem, setPreset] = usePageMemory('dataHallPreset');
  const preset = (PRESETS.some((x) => x.id === presetMem) ? presetMem : 'overview') as CameraPreset;
  const [focusSeq, setFocusSeq] = useState(0);
  const effectiveView = webgl ? view : '2d';

  const rackRows = useMemo(
    () =>
      Object.values(s.racks).map((r) => {
        const eqs = Object.values(s.equipment).filter((e) => e.location.kind === 'rack' && e.location.rackId === r.id);
        const hosts = eqs.filter(isHost);
        return { rack: r, hosts: hosts.length, running: hosts.filter((h) => h.state === 'os_running').length, health: worstHealth(eqs.map((e) => displayedHealth(s, e, devMode))) };
      }),
    [s, devMode],
  );
  const sel = rackRows.find((r) => r.rack.id === selectedRackId) ?? rackRows[0];
  const alerts = monitoringAlerts(s, devMode).filter((a) => a.rackId === sel.rack.id);
  const open = (id: string) => {
    useUiStore.getState().selectRack(id);
    navigate(`/racks/${id}`);
  };
  const select = (id: string) => {
    setHallRackId(id);
    setFocusSeq((n) => n + 1);
  };

  return (
    <div className="flex h-full min-h-[560px] flex-col lg:flex-row">
      <div className="relative min-h-[420px] flex-1 border-b border-border lg:border-r lg:border-b-0">
        <div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-2">
          <Segmented
            label="View"
            items={[
              { id: '3d', label: <><Box /> 3D hall</> },
              { id: '2d', label: <><MapIcon /> 2D plan</> },
            ]}
            value={effectiveView}
            onChange={(v) => webgl && setView(v)}
          />
          {effectiveView === '3d' && (
            <div className="flex flex-wrap gap-1 rounded-chip border border-border-strong bg-surface-2/90 p-0.5">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" onClick={() => setPreset(p.id)} className={cn('h-6 rounded-[3px] px-2 text-[11px] text-muted hover:text-fg', preset === p.id && 'bg-surface-3 text-fg')}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {!webgl && (
          <div className="absolute right-2 bottom-2 z-10 max-w-sm">
            <Callout tone="warn">WebGL is not available in this browser, so the data hall is shown as a 2D floor plan. All rack navigation still works.</Callout>
          </div>
        )}
        <div className="absolute inset-0">
          {effectiveView === '3d' ? (
            <ErrorBoundary
              fallback={(err) => (
                <div className="relative h-full">
                  <FloorPlan2D selectedRackId={sel.rack.id} devMode={devMode} onSelect={select} onOpen={open} />
                  <div className="absolute right-2 bottom-2 max-w-sm">
                    <Callout tone="warn" title="3D view unavailable">
                      {err.message}. Showing the 2D plan instead.
                    </Callout>
                  </div>
                </div>
              )}
            >
              <Suspense fallback={<div className="flex h-full items-center justify-center text-[12px] text-muted">Loading 3D data hall…</div>}>
                <DataHallScene selectedRackId={sel.rack.id} preset={preset} focusSeq={focusSeq} devMode={devMode} onSelect={select} onOpen={open} />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <FloorPlan2D selectedRackId={sel.rack.id} devMode={devMode} onSelect={select} onOpen={open} />
          )}
        </div>
        <div className="pointer-events-none absolute bottom-2 left-2 hidden text-[11px] text-subtle md:block">
          {effectiveView === '3d' ? 'Drag to orbit · right-drag to pan · scroll to zoom · double-click a rack to open it' : ''}
        </div>
      </div>

      <aside className="w-full shrink-0 space-y-3 overflow-y-auto p-3 lg:w-[340px]">
        <Panel title={`${s.facility.name} · racks`} bodyClassName="p-1.5">
          <ul className="space-y-0.5" aria-label="Racks">
            {rackRows.map(({ rack, hosts, running, health }) => (
              <li key={rack.id}>
                <button
                  type="button"
                  onClick={() => select(rack.id)}
                  onDoubleClick={() => open(rack.id)}
                  aria-current={rack.id === sel.rack.id}
                  className={cn('flex w-full items-center gap-2 rounded-chip px-2 py-1.5 text-left hover:bg-surface-3', rack.id === sel.rack.id && 'bg-surface-3 shadow-[inset_2px_0_0_var(--color-accent)]')}
                >
                  <StatusDot tone={healthTone(health)} />
                  <span className="font-mono text-[12px]">{rack.id}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{rack.name.split('·')[1]?.trim()}</span>
                  <span className="text-[11px] text-subtle tabular">{hosts ? `${running}/${hosts}` : '—'}</span>
                  <span className="w-14 text-right text-[11px] text-muted tabular">{formatW(rack.powerW)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title={`Selected · ${sel.rack.id}`}
          subtitle={sel.rack.name}
          actions={
            effectiveView === '3d' && (
              <Button size="icon" variant="ghost" aria-label="Focus camera on rack" title="Focus camera" onClick={() => setFocusSeq((n) => n + 1)}>
                <Crosshair />
              </Button>
            )
          }
        >
          <div className="space-y-3">
            <KV
              rows={[
                ['Type', `${sel.rack.type === 'mgx' ? 'MGX-style' : 'Standard'} ${sel.rack.heightU}U, ${sel.rack.cooling}-cooled`],
                ['Hosts running', sel.hosts ? `${sel.running} of ${sel.hosts}` : 'none installed'],
                ['IT load', `${formatW(sel.rack.powerW)} (design ${formatW(sel.rack.maxPowerW)})`],
                ['Inlet', formatTemp(sel.rack.inletC)],
                ...(sel.rack.coolant ? ([['Coolant', `${sel.rack.coolant.flowPct} % flow, return ${sel.rack.coolant.returnC} °C`]] as [string, string][]) : []),
              ]}
            />
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Alerts in this rack</div>
              {alerts.length === 0 ? (
                <div className="text-[12px] text-ok">None reported by monitoring.</div>
              ) : (
                <ul className="space-y-1">
                  {alerts.slice(0, 6).map((a) => (
                    <li key={a.key} className="flex items-start gap-1.5 text-[12px]">
                      <Badge tone={a.severity === 'critical' ? 'crit' : 'warn'}>{a.severity === 'critical' ? 'CRIT' : 'WARN'}</Badge>
                      <span className="min-w-0">
                        <span className="font-mono text-[11px] text-muted">{a.hostname.replace('dh1-', '')}</span> {a.message}
                      </span>
                    </li>
                  ))}
                  {alerts.length > 6 && <li className="text-[11px] text-subtle">+{alerts.length - 6} more</li>}
                </ul>
              )}
            </div>
            <Button variant="primary" className="w-full" onClick={() => open(sel.rack.id)}>
              <Rows3 /> Open in Rack Explorer
            </Button>
          </div>
        </Panel>

        <RackUnits rackId={sel.rack.id} />
      </aside>
    </div>
  );
}
