/**
 * Simulated BMC web interface (Redfish-style), reached from the laptop
 * browser. Shows exactly what the BMC channel can observe, and its power
 * controls dispatch real engine actions.
 */
import { Lightbulb, Power, RefreshCw, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Mono } from '@/components/ui/misc';
import { KV } from '@/components/ui/panel';
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { installedComponents, isMainPowerOn } from '@/simulation/core/SimulationState';
import { channelStatus, conditionsVia, equipmentHealthVia } from '@/simulation/diagnostics/DiagnosticEngine';
import { useAct } from '@/stores/hardwareStore';
import { useSim } from '@/stores/simulationStore';
import { formatClock, HEALTH_TEXT, healthTone, severityTone } from '@/utils/format';

export function BmcWebUi({ equipmentId, address, onRefresh }: { equipmentId: string; address: string; onRefresh: () => void }) {
  const s = useSim((st) => st);
  const act = useAct();
  const eq = s.equipment[equipmentId];
  if (!eq) return null;
  const bmcUp = channelStatus(s, eq, 'bmc').available || eq.bmcAlive;
  if (!eq.bmcAlive) {
    return (
      <div className="rounded-[5px] border border-border bg-surface-2 p-6 text-center text-[12px] text-muted">
        The BMC at {address} stopped responding. <Button size="xs" variant="outline" onClick={onRefresh}>Reload</Button>
      </div>
    );
  }
  const model = getEquipmentModel(eq.modelId);
  const health = equipmentHealthVia(s, eq, 'bmc');
  const comps = installedComponents(s, eq);
  const psus = comps.filter((c) => c.category === 'psu');
  const fans = comps.filter((c) => c.category === 'fan');
  const temps = comps.filter((c) => (c.category === 'cpu' || c.category === 'gpu') && c.powered);
  const alerts = [...conditionsVia(eq.conditions, 'bmc'), ...comps.flatMap((c) => conditionsVia(c.conditions, 'bmc'))];
  const on = isMainPowerOn(eq);

  return (
    <div className="overflow-hidden rounded-[5px] border border-[#2c3a4a] bg-[#0f141a]" data-testid="bmc-web-ui">
      <div className="flex items-center gap-2 border-b border-[#2c3a4a] bg-[#152030] px-3 py-2">
        <span className="text-[12.5px] font-semibold text-[#cfe1f5]">{eq.hostname}</span>
        <span className="text-[11px] text-[#7d93ab]">Baseboard Management Controller · Redfish (simulated)</span>
        <Button size="icon" variant="ghost" className="ml-auto size-6" aria-label="Refresh BMC page" onClick={onRefresh}>
          <RefreshCw />
        </Button>
      </div>
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={on ? 'ok' : 'muted'}>Host power: {on ? 'On' : 'Off'}</Badge>
          <Badge tone={healthTone(health)}>System health: {HEALTH_TEXT[health]}</Badge>
          {eq.uidLed && <Badge tone="info">Locator LED on</Badge>}
        </div>
        <KV
          rows={[
            ['Model', model.name],
            ['Serial number', <Mono key="s">{eq.serial}</Mono>],
            ['Asset tag', <Mono key="a">{eq.assetTag}</Mono>],
            ['BMC address', <Mono key="ip">{address}</Mono>],
            ['Host state', eq.state.replace('_', ' ')],
          ]}
        />
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant={on ? 'outline' : 'primary'} onClick={() => act({ type: 'equipment/power', equipmentId: eq.id, power: on ? 'off' : 'on' }, `Redfish: power ${on ? 'off' : 'on'} sent to ${eq.hostname}`)}>
            <Power /> {on ? 'Power off' : 'Power on'}
          </Button>
          <Button size="xs" variant="outline" disabled={!on} onClick={() => act({ type: 'equipment/powerCycle', equipmentId: eq.id }, `Redfish: power cycle sent to ${eq.hostname}`)}>
            <RotateCcw /> Power cycle
          </Button>
          <Button size="xs" variant="outline" onClick={() => act({ type: 'equipment/setUid', equipmentId: eq.id, on: !eq.uidLed })}>
            <Lightbulb /> Locator {eq.uidLed ? 'off' : 'on'}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Power supplies</div>
            <ul className="space-y-0.5 text-[11.5px]">
              {psus.length === 0 && <li className="text-subtle">Busbar-powered (see rack power shelves)</li>}
              {psus.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span className="text-muted">{p.id.split('/')[1].toUpperCase()}</span>
                  <span>{p.delivering ? 'OK' : p.inputLive ? 'Failed' : 'No AC input'}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Fans</div>
            <ul className="space-y-0.5 text-[11.5px]">
              {fans.map((f) => (
                <li key={f.id} className="flex justify-between gap-2">
                  <span className="text-muted">{f.id.split('/')[1]}</span>
                  <Mono>{f.rpm ?? 0} RPM</Mono>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Temperatures</div>
            <ul className="space-y-0.5 text-[11.5px]">
              <li className="flex justify-between">
                <span className="text-muted">Inlet</span>
                <Mono>{eq.inletC.toFixed(1)} °C</Mono>
              </li>
              {temps.map((c) => (
                <li key={c.id} className="flex justify-between gap-2">
                  <span className="truncate text-muted">{c.id.split('/')[1]}</span>
                  <Mono>{c.temperatureC.toFixed(0)} °C</Mono>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Active alerts</div>
          {alerts.length === 0 ? (
            <div className="text-[11.5px] text-ok">None</div>
          ) : (
            <ul className="space-y-0.5 text-[11.5px]">
              {alerts.map((a) => (
                <li key={a.code + a.message} className="flex gap-1.5">
                  <Badge tone={severityTone(a.severity)}>{a.severity}</Badge> {a.message}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">System event log</div>
          <ul className="max-h-[140px] space-y-0.5 overflow-auto font-mono text-[11px]">
            {eq.sel.length === 0 && <li className="text-subtle">Empty</li>}
            {[...eq.sel].reverse().slice(0, 30).map((e) => (
              <li key={e.id}>
                <span className="text-subtle">{formatClock(s.startedAt, e.timeMs)}</span> {e.message}
              </li>
            ))}
          </ul>
        </div>
        {!bmcUp && <div className="text-[11px] text-subtle">Partial data</div>}
        {comps.length > 0 && <div className="text-[10.5px] text-subtle">Inventory: {comps.length} components ({[...new Set(comps.map((c) => getComponentModel(c.modelId).category))].join(', ')})</div>}
      </div>
    </div>
  );
}
