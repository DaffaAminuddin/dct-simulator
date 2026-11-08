import { useMemo, useState } from 'react';
import { Page } from '@/components/layout/AppShell';
import { Badge } from '@/components/ui/badge';
import { Callout, Mono, PhaseNotice } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { XID_INFO } from '@/data/faults/faultCatalog';
import { channelStatus, hasGpus } from '@/simulation/diagnostics/DiagnosticEngine';
import { useDevMode } from '@/stores/hardwareStore';
import { useSim } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import type { Component, Equipment, SimulationState } from '@/types/simulation';
import { cn } from '@/utils/cn';

function gpusOf(s: SimulationState, eq: Equipment): Component[] {
  return getEquipmentModel(eq.modelId)
    .slots.filter((sl) => sl.category === 'gpu')
    .map((sl) => (eq.slots[sl.id] ? s.components[eq.slots[sl.id] as string] : undefined))
    .filter((c): c is Component => !!c);
}

export function GpuDiagnosticsPage() {
  const s = useSim((st) => st);
  const devMode = useDevMode();
  const lastEq = useUiStore((st) => st.selectedEquipmentId);
  const nodes = useMemo(() => Object.values(s.equipment).filter((e) => hasGpus(e) && e.location.kind === 'rack'), [s.equipment]);
  const [nodeId, setNodeId] = useState(() => (lastEq && nodes.some((n) => n.id === lastEq) ? lastEq : 'ct-r05-07'));
  const eq = s.equipment[nodeId] ?? nodes[0];
  const driver = channelStatus(s, eq, 'driver');
  const model = getEquipmentModel(eq.modelId);
  const expected = model.slots.filter((sl) => sl.category === 'gpu').length;
  const gpus = gpusOf(s, eq);
  const visible = gpus.filter((g) => g.gpu?.lifecycle === 'initialized');
  const rows = devMode ? gpus : visible;
  const rackId = eq.location.kind === 'rack' ? eq.location.rackId : '';
  const rack = s.racks[rackId];

  return (
    <Page className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="GPU node" value={eq.id} onChange={(e) => setNodeId(e.target.value)} className="max-w-[360px]">
          {['R03', 'R05', 'R06'].map((r) => (
            <optgroup key={r} label={r}>
              {nodes
                .filter((n) => n.location.kind === 'rack' && n.location.rackId === r)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.hostname}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
        <Badge tone={driver.available ? 'ok' : 'crit'}>Driver {driver.available ? 'loaded' : 'unavailable'}</Badge>
        <span className="text-[12px] text-muted">{model.name}</span>
      </div>

      {!driver.available ? (
        <Callout tone="crit" title="Cannot query GPUs">
          The NVIDIA driver is not reachable on {eq.hostname}: {driver.reason}. Fix the host first (power, POST, OS).
        </Callout>
      ) : visible.length < expected ? (
        <Callout tone="warn" title={`Driver reports ${visible.length} of ${expected} GPUs`}>
          The {model.shortName} specification lists {expected} GPUs. Missing devices have not been initialized by the driver. Check the kernel log for XID events and inspect the PCIe / host-link topology.
        </Callout>
      ) : null}

      <Panel title="GPU telemetry" subtitle={devMode ? 'Developer mode: includes devices the driver cannot see' : 'Driver channel (equivalent to nvidia-smi)'} bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[11.5px]">
            <thead className="text-left text-subtle">
              <tr className="border-b border-border">
                {['GPU', 'Bus ID', 'Name', 'Temp', 'Power / cap', 'Util', 'Memory', 'SM clock', 'ECC unc.', 'XID', 'Host link', 'NVLink', 'Throttle'].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {driver.available || devMode
                ? rows.map((c) => {
                    const g = c.gpu!;
                    const hidden = g.lifecycle !== 'initialized';
                    return (
                      <tr key={c.id} className={cn('border-b border-border/60 font-mono tabular', hidden && 'text-subtle')}>
                        <td className="px-2 py-1">{g.index}</td>
                        <td className="px-2 py-1">{g.busId}</td>
                        <td className="px-2 py-1 font-sans">{getComponentModel(c.modelId).name.replace(/ \(.*\)/, '')}</td>
                        <td className={cn('px-2 py-1', c.temperatureC >= 85 && 'text-warn')}>{hidden ? '—' : `${Math.round(c.temperatureC)} °C`}</td>
                        <td className="px-2 py-1">{hidden ? '—' : `${g.powerW} / ${g.powerLimitW} W`}</td>
                        <td className="px-2 py-1">{hidden ? '—' : `${g.utilizationPct} %`}</td>
                        <td className="px-2 py-1">{hidden ? '—' : `${g.memUsedGB.toFixed(0)} / ${g.memTotalGB} GB`}</td>
                        <td className="px-2 py-1">{hidden ? '—' : `${g.smClockMHz} MHz`}</td>
                        <td className={cn('px-2 py-1', g.eccUncorrectable > 0 && 'text-crit')}>{g.eccUncorrectable}</td>
                        <td className="px-2 py-1">{g.xids.length ? g.xids.map((x) => <span key={x} title={XID_INFO[x]?.name} className="mr-1 text-warn">{x}</span>) : '—'}</td>
                        <td className="px-2 py-1">{g.pcieWidth ? `Gen${g.pcieGen} x${g.pcieWidth}` : 'none'}</td>
                        <td className={cn('px-2 py-1', g.nvlinkActive < g.nvlinkTotal && 'text-warn')}>
                          {g.nvlinkActive}/{g.nvlinkTotal}
                        </td>
                        <td className="px-2 py-1 font-sans">{hidden ? <Badge tone="crit">{g.lifecycle}</Badge> : g.throttleReasons.length ? <Badge tone="warn">{g.throttleReasons.join(', ')}</Badge> : <span className="text-subtle">none</span>}</td>
                      </tr>
                    );
                  })
                : null}
            </tbody>
          </table>
        </div>
      </Panel>

      {rack?.type === 'mgx' && <NvlinkMatrix s={s} rackId={rackId} devMode={devMode} />}

      <PhaseNotice phase={4} title="DCGM health checks and diagnostics">
        <Mono>dcgmi discovery -l</Mono>, <Mono>dcgmi health -c</Mono> and <Mono>dcgmi diag -r 1|2|3</Mono> with run-time progression, plus XID timelines and per-GPU history charts. The engine already models XID, ECC, host-link, NVLink and throttling state shown above.
      </PhaseNotice>
    </Page>
  );
}

function NvlinkMatrix({ s, rackId, devMode }: { s: SimulationState; rackId: string; devMode: boolean }) {
  const trays = Object.values(s.equipment)
    .filter((e) => e.kind === 'compute_tray' && e.location.kind === 'rack' && e.location.rackId === rackId)
    .sort((a, b) => (a.location.kind === 'rack' && b.location.kind === 'rack' ? (b.location.uStart ?? 0) - (a.location.uStart ?? 0) : 0));
  return (
    <Panel title={`NVLink domain · ${rackId}`} subtitle="Active links per GPU (driver view): each switch tray contributes 2 of 18 links (simplified mapping)">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
        {trays.map((t) => {
          const driverOk = channelStatus(s, t, 'driver').available;
          return (
            <div key={t.id} className="rounded-chip border border-border bg-surface-2 p-1.5">
              <div className="mb-1 truncate font-mono text-[10.5px] text-muted">{t.hostname.replace(/^dh1-r0\d-/, '')}</div>
              <div className="grid grid-cols-4 gap-1">
                {gpusOf(s, t).map((g) => {
                  const tel = g.gpu!;
                  const known = driverOk && (tel.lifecycle === 'initialized' || devMode);
                  const ratio = tel.nvlinkTotal ? tel.nvlinkActive / tel.nvlinkTotal : 0;
                  const color = !known ? 'bg-surface-3 text-subtle' : ratio === 1 ? 'bg-ok-soft text-ok-ink' : ratio > 0 ? 'bg-warn-soft text-warn-ink' : 'bg-crit-soft text-crit-ink';
                  return (
                    <div key={g.id} title={`GPU ${tel.index}: ${known ? `${tel.nvlinkActive}/${tel.nvlinkTotal}` : 'not visible'}`} className={cn('rounded-[2px] py-0.5 text-center font-mono text-[10px]', color)}>
                      {known ? tel.nvlinkActive : '?'}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
