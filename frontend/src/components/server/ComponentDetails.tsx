import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { CopyButton } from '@/components/device/DeviceInfoCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AccuracyBadge, Callout, Mono } from '@/components/ui/misc';
import { EmptyState, KV, Panel } from '@/components/ui/panel';
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getSlotDef } from '@/data/hardware/equipmentCatalog';
import { channelStatus, componentHealthVia, componentLed, conditionsVia, hasPhysicalLed } from '@/simulation/diagnostics/DiagnosticEngine';
import { compatibleSpares } from '@/simulation/hardware/Compatibility';
import { componentPartNumber } from '@/simulation/inventory/DeviceInfo';
import { useAct } from '@/stores/hardwareStore';
import type { Equipment, SimulationState } from '@/types/simulation';
import { formatTemp, formatW, HEALTH_TEXT, healthTone, severityTone } from '@/utils/format';

function CopyValue({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Mono>{value}</Mono>
      <CopyButton value={value} label={label} />
    </span>
  );
}

function specLabel(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const LED_TEXT = { off: 'Off', green: 'Green', amber: 'Amber (fault)', blue: 'Blue', 'blink-green': 'Blinking green', 'blink-amber': 'Blinking amber' } as const;

export function ComponentDetails({ s, eq, slotId, devMode }: { s: SimulationState; eq: Equipment; slotId: string | null; devMode: boolean }) {
  const act = useAct();
  if (!slotId) {
    return (
      <Panel title="Component">
        <EmptyState title="Select a slot">Click a component or an empty slot in the chassis view to inspect it.</EmptyState>
      </Panel>
    );
  }
  const slot = getSlotDef(eq.modelId, slotId);
  if (!slot) return null;
  const cid = eq.slots[slotId];
  const comp = cid ? s.components[cid] : undefined;

  if (!comp) {
    const spares = compatibleSpares(s, eq.id, slotId);
    return (
      <Panel title="Empty slot" subtitle={slot.label}>
        <div className="space-y-3">
          <KV
            rows={[
              ['Accepts', slot.accepts.join(', ')],
              ['Access', slot.access],
              ...(slot.dependsOn ? ([['Depends on', slot.dependsOn]] as [string, string][]) : []),
            ]}
          />
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Compatible spares in inventory</div>
          {spares.length === 0 ? (
            <div className="text-[12px] text-subtle">None. Parts with another form factor will not fit this slot.</div>
          ) : (
            <ul className="space-y-1">
              {spares.map((id) => {
                const c = s.components[id];
                return (
                  <li key={id} className="flex items-center gap-2 rounded-chip border border-border bg-surface-2 px-2 py-1 text-[12px]">
                    <span className="min-w-0 flex-1 truncate">
                      {getComponentModel(c.modelId).name} <Mono className="text-subtle">PN {componentPartNumber(c.modelId)} · SN {c.serial}</Mono>
                    </span>
                    <Button size="xs" variant="primary" onClick={() => act({ type: 'component/install', componentId: id, equipmentId: eq.id, slotId }, `Installed in ${slot.label}`)}>
                      <ArrowDownToLine /> Install
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Panel>
    );
  }

  const m = getComponentModel(comp.modelId);
  const bmcUp = channelStatus(s, eq, 'bmc').available;
  const bmcHealth = componentHealthVia(s, comp, 'bmc');
  const led = componentLed(s, comp);
  const visible = devMode ? comp.conditions : conditionsVia(comp.conditions, 'bmc');
  const showReadings = devMode || bmcUp;
  const g = comp.gpu;

  const rows: [string, React.ReactNode][] = [
    ['Model', m.name],
    ['Part number', <CopyValue key="pn" value={componentPartNumber(comp.modelId)} label="Part number" />],
    ['Serial (SN)', <CopyValue key="sn" value={comp.serial} label="Serial" />],
    ['Component ID', <Mono key="id">{comp.id}</Mono>],
    ['Manufacturer', m.manufacturer],
    ['Form factor', m.formFactor],
    ['Installation', `Installed · ${slot.label} (${slot.access} access)`],
    ['Power', comp.powered ? 'Energised' : 'No power'],
    ['Status LED', hasPhysicalLed(comp.category) ? LED_TEXT[led] : 'None on this part (use BMC / driver data)'],
    ['Temperature', showReadings ? formatTemp(comp.temperatureC) : 'unavailable (BMC down)'],
    ['Power draw', showReadings ? formatW(comp.powerW) : '—'],
  ];
  if (comp.category === 'fan' && showReadings) rows.push(['Fan speed', `${comp.rpm ?? 0} RPM (${comp.dutyPct ?? 0} %)`]);
  if (comp.category === 'psu' && showReadings) rows.push(['AC input', comp.inputLive ? 'Present' : 'Lost'], ['Output', comp.delivering ? 'Delivering' : 'Off'], ['Rating', `${m.ratingW} W`]);
  if (g && devMode) rows.push(['GPU lifecycle', g.lifecycle], ['NVLink', `${g.nvlinkActive}/${g.nvlinkTotal}`]);

  return (
    <Panel title={m.category.toUpperCase()} subtitle={slot.label}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={healthTone(devMode ? comp.health : bmcHealth)} title={devMode ? 'Ground truth' : 'BMC-reported health'}>
            {devMode ? 'Truth' : 'BMC'}: {HEALTH_TEXT[devMode ? comp.health : bmcHealth]}
          </Badge>
          <Badge tone={m.hotSwap ? 'info' : 'muted'}>{m.hotSwap ? 'Hot-swap' : 'Cold-swap'}</Badge>
          <Badge tone={m.fieldReplaceable ? 'muted' : 'warn'}>{m.fieldReplaceable ? 'FRU' : 'Not field-replaceable'}</Badge>
          <AccuracyBadge accuracy={m.accuracy} note={m.note} />
        </div>
        <KV rows={rows} />
        {visible.length > 0 && (
          <ul className="space-y-1">
            {visible.map((c) => (
              <li key={c.code + c.message} className="flex items-start gap-1.5 text-[12px]">
                <Badge tone={severityTone(c.severity)}>{c.severity}</Badge>
                <span>{c.message}</span>
              </li>
            ))}
          </ul>
        )}
        {comp.category === 'gpu' && !devMode && <Callout tone="info">GPU-level telemetry (utilization, ECC, XID, NVLink) comes from the driver: see GPU Diagnostics.</Callout>}
        <div className="rounded-chip border border-border bg-surface-2 p-2">
          <div className="mb-1 text-[11px] text-subtle">Specifications</div>
          <KV rows={Object.entries(m.specs).map(([k, v]) => [specLabel(k), String(v)])} />
          {m.note && <p className="mt-2 text-[11px] text-subtle">{m.note}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => act({ type: 'component/remove', componentId: comp.id }, `Removed ${slot.label} to inventory`)}>
            <ArrowUpFromLine /> Remove
          </Button>
        </div>
      </div>
    </Panel>
  );
}
