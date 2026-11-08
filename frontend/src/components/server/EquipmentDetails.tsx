/**
 * Equipment inspector: identity, state, power, components, ports, BMC SEL.
 * Health shown to the learner comes from the BMC channel (or front LEDs when
 * the BMC is unreachable). Developer mode adds ground truth.
 */
import { Cpu, HardDrive, Lightbulb, LogOut, Power, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { FaultInjectorPanel } from '@/components/diagnostics/FaultInjectorPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AccuracyBadge, Callout, Mono } from '@/components/ui/misc';
import { EmptyState, KV, Meter, Panel } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { Tabs } from '@/components/ui/tabs';
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { installedComponents, isHost, isMainPowerOn, locationLabel, peerPort } from '@/simulation/core/SimulationState';
import { channelStatus, componentHealthVia, conditionsVia, displayedHealth } from '@/simulation/diagnostics/DiagnosticEngine';
import { bootPhaseLabel, bootRemainingS } from '@/simulation/hardware/Server';
import { bmcReachability, peerLabel } from '@/simulation/networking/NetworkTopology';
import { useAct, useDevMode, useEquipment } from '@/stores/hardwareStore';
import { useSim } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import type { WorkloadProfile } from '@/types/catalog';
import type { Condition, Equipment, Id, SimulationState } from '@/types/simulation';
import { cn } from '@/utils/cn';
import { formatClock, formatSpeed, formatTemp, formatW, HEALTH_TEXT, healthTone, PORT_STATE_TEXT, portTone, POWER_TEXT, powerTone, severityTone, STATE_TEXT, stateTone } from '@/utils/format';

type TabId = 'overview' | 'components' | 'ports' | 'power' | 'sel' | 'truth';

export function EquipmentDetails({ equipmentId, onClose, onSelectPort }: { equipmentId: Id; onClose?: () => void; onSelectPort?: (id: Id) => void }) {
  const eq = useEquipment(equipmentId);
  const s = useSim((st) => st);
  const devMode = useDevMode();
  const [tab, setTab] = useState<TabId>('overview');
  if (!eq) return <EmptyState title="Equipment not found" />;
  const model = getEquipmentModel(eq.modelId);
  const host = isHost(eq);
  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(model.slots.length ? [{ id: 'components' as const, label: 'Components' }] : []),
    ...(eq.portIds.length ? [{ id: 'ports' as const, label: 'Ports' }] : []),
    { id: 'power', label: 'Power' },
    ...(host ? [{ id: 'sel' as const, label: 'SEL' }] : []),
    ...(devMode ? [{ id: 'truth' as const, label: 'Ground truth' }] : []),
  ];
  const active = tabs.some((t) => t.id === tab) ? tab : 'overview';
  const health = displayedHealth(s, eq, devMode);
  const bmc = host ? bmcReachability(s, eq.id) : null;

  return (
    <Panel
      title={eq.kind.replace('_', ' ')}
      subtitle={locationLabel(s, eq)}
      actions={
        onClose && (
          <Button size="icon" variant="ghost" aria-label="Close equipment details" onClick={onClose}>
            <X />
          </Button>
        )
      }
      bodyClassName="p-0"
    >
      <div className="space-y-2.5 border-b border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Mono className="text-[13px] font-semibold text-fg">{eq.hostname}</Mono>
          <span className="text-[12px] text-muted">{model.name}</span>
          <AccuracyBadge accuracy={model.accuracy} note={model.note} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {host && <Badge tone={stateTone(eq.state)}>{STATE_TEXT[eq.state]}</Badge>}
          {eq.powerStatus !== 'not_applicable' && <Badge tone={powerTone(eq.powerStatus)}>Power: {POWER_TEXT[eq.powerStatus]}</Badge>}
          <Badge tone={healthTone(health)} title={devMode ? 'Ground truth (developer mode)' : 'As reported by the BMC, or by front-panel LEDs if the BMC is unreachable'}>
            Health: {HEALTH_TEXT[health]}
          </Badge>
          {bmc && eq.kind !== 'switch' && <Badge tone={bmc.reachable ? 'ok' : 'crit'} title={bmc.reason}>BMC {bmc.reachable ? 'reachable' : 'unreachable'}</Badge>}
          {eq.uidLed && <Badge tone="info">UID on</Badge>}
          {eq.chassisOpen && <Badge tone="warn">Lid open</Badge>}
        </div>
        {(eq.state === 'powered_on' || eq.state === 'booting') && (
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-muted">
              <span>{bootPhaseLabel(eq)}</span>
              <span className="tabular">{bootRemainingS(eq)} s remaining</span>
            </div>
            <Meter value={eq.bootElapsedMs} max={model.bootTimeMs} tone="info" label="Boot progress" />
          </div>
        )}
        {bmc && !bmc.reachable && eq.kind !== 'switch' && eq.location.kind === 'rack' && <Callout tone="warn">BMC unreachable: {bmc.reason}. Remote health data is unavailable; inspect the hardware physically.</Callout>}
        {host && eq.location.kind === 'rack' && <HostActions eq={eq} />}
      </div>
      <div className="border-b border-border px-3 py-1.5">
        <Tabs items={tabs} value={active} onChange={setTab} size="sm" label="Equipment details" />
      </div>
      <div className="p-3">
        {active === 'overview' && <Overview s={s} eq={eq} />}
        {active === 'components' && <ComponentsTab s={s} eq={eq} devMode={devMode} />}
        {active === 'ports' && <PortsTab s={s} eq={eq} onSelectPort={onSelectPort} />}
        {active === 'power' && <PowerTab s={s} eq={eq} />}
        {active === 'sel' && <SelTab s={s} eq={eq} />}
        {active === 'truth' && <TruthTab s={s} eq={eq} />}
      </div>
    </Panel>
  );
}

function HostActions({ eq }: { eq: Equipment }) {
  const act = useAct();
  const navigate = useNavigate();
  const selectEquipment = useUiStore((st) => st.selectEquipment);
  const on = eq.desiredPower === 'on' && eq.state !== 'standby' && eq.state !== 'powered_off';
  return (
    <div className="flex flex-wrap gap-1.5">
      {on ? (
        <Button size="xs" variant="outline" onClick={() => act({ type: 'equipment/power', equipmentId: eq.id, power: 'off' }, `${eq.hostname} powering off`)}>
          <Power /> Power off
        </Button>
      ) : (
        <Button size="xs" variant="primary" onClick={() => act({ type: 'equipment/power', equipmentId: eq.id, power: 'on' }, `${eq.hostname} powering on`)}>
          <Power /> Power on
        </Button>
      )}
      <Button size="xs" variant="outline" disabled={!on} onClick={() => act({ type: 'equipment/powerCycle', equipmentId: eq.id }, `${eq.hostname} power cycled`)}>
        <RotateCcw /> Power cycle
      </Button>
      <Button size="xs" variant={eq.uidLed ? 'primary' : 'outline'} onClick={() => act({ type: 'equipment/setUid', equipmentId: eq.id, on: !eq.uidLed })}>
        <Lightbulb /> UID {eq.uidLed ? 'off' : 'on'}
      </Button>
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          selectEquipment(eq.id, eq.location.kind === 'rack' ? eq.location.rackId : undefined);
          navigate(`/hardware/${eq.id}`);
        }}
      >
        <HardDrive /> Hardware Lab
      </Button>
      <Button size="xs" variant="ghost" disabled={isMainPowerOn(eq)} title={isMainPowerOn(eq) ? 'Power off first' : undefined} onClick={() => act({ type: 'equipment/unmount', equipmentId: eq.id }, `${eq.hostname} removed to inventory`)}>
        <LogOut /> Remove from rack
      </Button>
    </div>
  );
}

function Overview({ s, eq }: { s: SimulationState; eq: Equipment }) {
  const act = useAct();
  const model = getEquipmentModel(eq.modelId);
  const host = isHost(eq);
  const rows: [string, React.ReactNode][] = [
    ['Serial', <Mono key="s">{eq.serial}</Mono>],
    ['Asset tag', <Mono key="a">{eq.assetTag}</Mono>],
    ['Model', model.name],
    ['Height', model.heightU ? `${model.heightU}U` : '0U'],
    ['Weight', `${model.weightKg} kg`],
    ['Cooling', model.cooling === 'liquid' ? 'Liquid (cold plates) + air' : 'Air'],
  ];
  if (host) {
    rows.push(['Operating system', eq.software.os]);
    rows.push([
      'Workload',
      <Select key="w" aria-label="Workload profile" value={eq.workload} onChange={(e) => act({ type: 'equipment/setWorkload', equipmentId: eq.id, workload: e.target.value as WorkloadProfile })} className="h-6">
        <option value="idle">Idle</option>
        <option value="light">Light</option>
        <option value="training">Training job</option>
      </Select>,
    ]);
    rows.push(['Inlet air', formatTemp(eq.inletC)]);
    rows.push(['Airflow', `${Math.round(eq.airflowFactor * 100)} % of required`]);
    rows.push(['Power draw', `${formatW(eq.powerDemandW)} of ${formatW(eq.powerCapacityW)} available`]);
  }
  if (eq.kind === 'pdu') rows.push(['Load', `${formatW(eq.powerDemandW)} / ${formatW(model.pdu?.ratingW ?? 0)}`], ['Feed', eq.feed ?? '—']);
  if (eq.kind === 'power_shelf') rows.push(['Feed', eq.feed ?? '—'], ['Capacity', formatW(eq.powerCapacityW)], ['Share of busbar load', formatW(eq.powerDemandW)]);
  if (eq.kind === 'cdu') {
    for (const rid of eq.servesRackIds ?? []) {
      const c = s.racks[rid]?.coolant;
      if (c) rows.push([`${rid} loop`, `${c.flowLpm} L/min (${c.flowPct} %) · supply ${c.supplyC} °C · return ${c.returnC} °C${c.leak ? ' · LEAK' : ''}`]);
    }
  }
  return (
    <div className="space-y-3">
      <KV rows={rows} />
      <p className="text-[11.5px] leading-relaxed text-subtle">{model.description}</p>
    </div>
  );
}

function ComponentsTab({ s, eq, devMode }: { s: SimulationState; eq: Equipment; devMode: boolean }) {
  const navigate = useNavigate();
  const selectComponent = useUiStore((st) => st.selectComponent);
  const model = getEquipmentModel(eq.modelId);
  const bmcUp = channelStatus(s, eq, 'bmc').available;
  return (
    <div className="space-y-2">
      {!bmcUp && !devMode && <Callout tone="warn">BMC data unavailable: component health shows as unknown.</Callout>}
      <div className="overflow-x-auto">
        <table className="w-full text-[11.5px]">
          <thead className="text-left text-subtle">
            <tr className="border-b border-border">
              <th className="py-1 pr-2 font-medium">Slot</th>
              <th className="py-1 pr-2 font-medium">Part</th>
              <th className="py-1 pr-2 font-medium">Status</th>
              <th className="py-1 pr-2 text-right font-medium">Temp</th>
              <th className="py-1 font-medium">Health</th>
            </tr>
          </thead>
          <tbody>
            {model.slots
              .filter((sl) => sl.category !== 'motherboard')
              .map((sl) => {
                const cid = eq.slots[sl.id];
                const c = cid ? s.components[cid] : undefined;
                const h = c ? (devMode ? c.health : componentHealthVia(s, c, 'bmc')) : 'unknown';
                return (
                  <tr
                    key={sl.id}
                    className="cursor-pointer border-b border-border/60 hover:bg-surface-2"
                    onClick={() => {
                      selectComponent(cid);
                      navigate(`/hardware/${eq.id}`);
                    }}
                  >
                    <td className="py-1 pr-2 text-muted">{sl.label}</td>
                    <td className="max-w-[200px] truncate py-1 pr-2">{c ? getComponentModel(c.modelId).name : <span className="text-subtle">empty</span>}</td>
                    <td className="py-1 pr-2 text-muted">{c ? (bmcUp || devMode ? c.status.replace('_', ' ') : '—') : ''}</td>
                    <td className="py-1 pr-2 text-right font-mono tabular">{c && (bmcUp || devMode) && c.powered ? c.temperatureC.toFixed(0) : ''}</td>
                    <td className="py-1">{c && <Badge tone={healthTone(h)}>{HEALTH_TEXT[h]}</Badge>}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PortsTab({ s, eq, onSelectPort }: { s: SimulationState; eq: Equipment; onSelectPort?: (id: Id) => void }) {
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-[11.5px]">
        <thead className="sticky top-0 bg-surface text-left text-subtle">
          <tr className="border-b border-border">
            <th className="py-1 pr-2 font-medium">Port</th>
            <th className="py-1 pr-2 font-medium">State</th>
            <th className="py-1 pr-2 font-medium">Speed</th>
            <th className="py-1 font-medium">Connected to</th>
          </tr>
        </thead>
        <tbody>
          {eq.portIds.map((pid) => {
            const p = s.ports[pid];
            const power = p.role === 'power_in' || p.role === 'power_out';
            return (
              <tr key={pid} className={cn('border-b border-border/60', onSelectPort && 'cursor-pointer hover:bg-surface-2')} onClick={() => onSelectPort?.(pid)}>
                <td className="py-1 pr-2">
                  {p.label} {p.osName && <span className="font-mono text-[10.5px] text-subtle">{p.osName}</span>}
                </td>
                <td className="py-1 pr-2">{power ? <span className="text-muted">{p.cableId ? 'cord in' : '—'}</span> : <Badge tone={portTone(p.state)}>{PORT_STATE_TEXT[p.state]}</Badge>}</td>
                <td className="py-1 pr-2 font-mono tabular">{power ? '' : formatSpeed(p.speedGbps)}</td>
                <td className="max-w-[200px] truncate py-1 text-muted">{peerLabel(s, p) ?? (p.cableId ? 'far end loose' : '')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PowerTab({ s, eq }: { s: SimulationState; eq: Equipment }) {
  const model = getEquipmentModel(eq.modelId);
  if (eq.kind === 'pdu') {
    const rating = model.pdu?.ratingW ?? 0;
    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex justify-between text-[12px]">
            <span className="text-muted">Load</span>
            <span className="tabular">
              {formatW(eq.powerDemandW)} / {formatW(rating)}
            </span>
          </div>
          <Meter value={eq.powerDemandW} max={rating} tone={eq.powerDemandW > rating * 0.8 ? 'warn' : 'ok'} label="PDU load" />
        </div>
        <table className="w-full text-[11.5px]">
          <tbody>
            {eq.portIds.map((pid) => {
              const p = s.ports[pid];
              const dev = peerPort(s, p);
              return (
                <tr key={pid} className="border-b border-border/60">
                  <td className="py-0.5 pr-2 text-muted">{p.label}</td>
                  <td className="py-0.5 pr-2">{p.live ? <Badge tone="ok">live</Badge> : <Badge tone="crit">dead</Badge>}</td>
                  <td className="truncate py-0.5 text-muted">{dev ? `${s.equipment[dev.equipmentId].hostname} · ${dev.label}` : p.cableId ? 'cord, device end loose' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  if (model.powerPath === 'busbar') {
    const rack = eq.location.kind === 'rack' ? s.racks[eq.location.rackId] : undefined;
    return rack?.busbar ? (
      <KV
        rows={[
          ['Power path', 'Rack busbar (power shelves)'],
          ['Busbar status', <Badge key="b" tone={powerTone(rack.busbar.status)}>{POWER_TEXT[rack.busbar.status]}</Badge>],
          ['Busbar capacity', formatW(rack.busbar.capacityW)],
          ['Rack demand', formatW(rack.busbar.demandW)],
          ['This tray', formatW(eq.powerDemandW)],
          ['Power brake', eq.powerBrake ? 'Active' : 'Inactive'],
        ]}
      />
    ) : (
      <Callout tone="warn">Not installed in an MGX rack: no busbar power.</Callout>
    );
  }
  const psuSlots = model.slots.filter((sl) => sl.category === 'psu');
  if (psuSlots.length === 0) return <div className="text-[12px] text-muted">{eq.kind === 'blank' ? 'Passive panel: no power.' : 'Hard-wired to facility feed ' + (eq.feed ?? '')}</div>;
  return (
    <div className="space-y-3">
      <table className="w-full text-[11.5px]">
        <thead className="text-left text-subtle">
          <tr className="border-b border-border">
            <th className="py-1 pr-2 font-medium">PSU</th>
            <th className="py-1 pr-2 font-medium">Input</th>
            <th className="py-1 pr-2 font-medium">Output</th>
            <th className="py-1 font-medium">Cord to</th>
          </tr>
        </thead>
        <tbody>
          {psuSlots.map((sl) => {
            const cid = eq.slots[sl.id];
            const c = cid ? s.components[cid] : undefined;
            const inlet = c ? eq.portIds.map((id) => s.ports[id]).find((p) => p.componentId === c.id && p.role === 'power_in') : undefined;
            const outlet = inlet ? peerPort(s, inlet) : undefined;
            const pdu = outlet ? s.equipment[outlet.equipmentId] : undefined;
            return (
              <tr key={sl.id} className="border-b border-border/60">
                <td className="py-1 pr-2">
                  {sl.label}
                  <div className="text-[10.5px] text-subtle">{c ? `${getComponentModel(c.modelId).ratingW} W` : 'empty slot'}</div>
                </td>
                <td className="py-1 pr-2">{c ? <Badge tone={c.inputLive ? 'ok' : 'crit'}>{c.inputLive ? 'AC OK' : 'No AC'}</Badge> : '—'}</td>
                <td className="py-1 pr-2">{c ? <Badge tone={c.delivering ? 'ok' : 'crit'}>{c.delivering ? 'OK' : 'Off'}</Badge> : '—'}</td>
                <td className="py-1 text-muted">{pdu && outlet ? `${pdu.hostname.replace('dh1-', '')} ${outlet.label.replace(/ \(.*\)/, '')} (feed ${pdu.feed})` : inlet?.cableId ? 'cord, PDU end loose' : 'no cord'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <KV
        rows={[
          ['Redundancy', <Badge key="r" tone={powerTone(eq.powerStatus)}>{POWER_TEXT[eq.powerStatus]}</Badge>],
          ['Delivering capacity', formatW(eq.powerCapacityW)],
          ['Current draw', formatW(eq.powerDemandW)],
        ]}
      />
    </div>
  );
}

function SelTab({ s, eq }: { s: SimulationState; eq: Equipment }) {
  const bmc = bmcReachability(s, eq.id);
  if (!bmc.reachable) return <Callout tone="warn" title="SEL unavailable">The BMC cannot be reached ({bmc.reason}). Restore management access to read the system event log.</Callout>;
  if (eq.sel.length === 0) return <div className="text-[12px] text-subtle">No SEL entries since the scenario started.</div>;
  return (
    <ul className="max-h-[360px] space-y-1 overflow-auto font-mono text-[11px]">
      {[...eq.sel].reverse().map((e) => (
        <li key={e.id} className="flex gap-2">
          <span className="shrink-0 text-subtle tabular">{formatClock(s.startedAt, e.timeMs)}</span>
          <Badge tone={severityTone(e.severity)} className="h-4 shrink-0 text-[10px]">
            {e.severity}
          </Badge>
          <span className="text-fg/90">{e.message}</span>
        </li>
      ))}
    </ul>
  );
}

function ConditionList({ title, conditions }: { title: string; conditions: Condition[] }) {
  if (conditions.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] text-subtle">{title}</div>
      <ul className="space-y-1">
        {conditions.map((c) => (
          <li key={c.code + c.message} className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <Badge tone={severityTone(c.severity)}>{c.code}</Badge>
            <span>{c.message}</span>
            <span className="text-subtle">via {c.channels.join(', ') || 'none'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TruthTab({ s, eq }: { s: SimulationState; eq: Equipment }) {
  const comps = installedComponents(s, eq).filter((c) => c.conditions.length > 0);
  const hiddenFromBmc = [...eq.conditions, ...comps.flatMap((c) => c.conditions)].filter((c) => conditionsVia([c], 'bmc').length === 0);
  return (
    <div className="space-y-3">
      <Callout tone="warn" title="Developer mode">
        Ground truth: these conditions include root causes that learners must discover through the right channel.
      </Callout>
      <ConditionList title="Equipment conditions" conditions={eq.conditions} />
      {comps.map((c) => (
        <ConditionList key={c.id} title={c.id} conditions={c.conditions} />
      ))}
      {hiddenFromBmc.length > 0 && <div className="text-[11.5px] text-warn">{hiddenFromBmc.length} condition(s) are not visible to the BMC.</div>}
      <div className="border-t border-border pt-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">
          <Cpu className="size-3.5" /> Fault injection
        </div>
        <FaultInjectorPanel equipmentId={eq.id} />
      </div>
    </div>
  );
}
