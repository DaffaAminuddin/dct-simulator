import { ArrowDownToLine, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/misc';
import { KV, Meter, Panel } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { equipmentInRack, isHost } from '@/simulation/core/SimulationState';
import { freeUnits, placementChecks } from '@/simulation/hardware/Rack';
import { EQUIPMENT_MIME, setDrag } from '@/hooks/useCableActions';
import { useAct } from '@/stores/hardwareStore';
import { useSim } from '@/stores/simulationStore';
import type { Id } from '@/types/simulation';
import { formatTemp, formatW, HEALTH_TEXT, healthTone, POWER_TEXT, powerTone } from '@/utils/format';

export function RackSummary({ rackId, preselectU }: { rackId: Id; preselectU?: number | null }) {
  const s = useSim((st) => st);
  const act = useAct();
  const rack = s.racks[rackId];
  const inRack = equipmentInRack(s, rackId);
  const hosts = inRack.filter(isHost);
  const weight = inRack.reduce((w, e) => w + getEquipmentModel(e.modelId).weightKg, 0);
  const issues = placementChecks(s, rackId);
  const pdus = inRack.filter((e) => e.kind === 'pdu');

  const inventory = useMemo(
    () => Object.values(s.equipment).filter((e) => e.location.kind === 'inventory' && getEquipmentModel(e.modelId).heightU > 0 && getEquipmentModel(e.modelId).rackTypes.includes(rack.type)),
    [s.equipment, rack.type],
  );
  const [eqId, setEqId] = useState('');
  const chosen = inventory.find((e) => e.id === eqId) ?? inventory[0];
  const h = chosen ? getEquipmentModel(chosen.modelId).heightU : 1;
  const free = freeUnits(s, rackId);
  const fits = free.filter((u) => Array.from({ length: h }, (_, i) => u + i).every((x) => free.includes(x)));
  const [u, setU] = useState<number | ''>('');
  useEffect(() => {
    if (preselectU) setU(preselectU);
  }, [preselectU]);
  const targetU = typeof u === 'number' && fits.includes(u) ? u : fits[0];

  return (
    <Panel title={`Rack ${rack.id}`} subtitle={rack.name}>
      <div className="space-y-3">
        <p className="text-[12px] text-muted">{rack.description}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={healthTone(rack.health)}>Health: {HEALTH_TEXT[rack.health]}</Badge>
          <Badge tone="muted">
            {rack.type === 'mgx' ? 'MGX-style' : 'Standard 19"'} · {rack.heightU}U · {rack.cooling}
          </Badge>
          <Badge tone="muted">{hosts.length} hosts</Badge>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[12px]">
            <span className="text-muted">IT load</span>
            <span className="tabular">
              {formatW(rack.powerW)} / {formatW(rack.maxPowerW)} design
            </span>
          </div>
          <Meter value={rack.powerW} max={rack.maxPowerW} tone={rack.powerW > rack.maxPowerW ? 'crit' : rack.powerW > rack.maxPowerW * 0.8 ? 'warn' : 'ok'} label="Rack power" />
        </div>
        <KV
          rows={[
            ['Inlet (base)', formatTemp(rack.inletC)],
            ['Open U', `${rack.openU} of ${rack.heightU}`],
            ['Static load', `${Math.round(weight)} kg / ${rack.maxWeightKg} kg`],
            ...(rack.busbar
              ? ([
                  ['Busbar', <span key="b">{formatW(rack.busbar.demandW)} of {formatW(rack.busbar.capacityW)} · <Badge tone={powerTone(rack.busbar.status)}>{POWER_TEXT[rack.busbar.status]}</Badge></span>],
                ] as [string, React.ReactNode][])
              : []),
            ...(rack.coolant
              ? ([
                  ['Coolant loop', `${rack.coolant.flowLpm} L/min (${rack.coolant.flowPct} %) · ${rack.coolant.supplyC} → ${rack.coolant.returnC} °C${rack.coolant.leak ? ' · LEAK' : ''}`],
                ] as [string, React.ReactNode][])
              : []),
          ]}
        />
        {pdus.length > 0 && (
          <div className="space-y-1.5">
            {pdus.map((p) => {
              const rating = getEquipmentModel(p.modelId).pdu?.ratingW ?? 1;
              return (
                <div key={p.id} className="space-y-0.5">
                  <div className="flex justify-between text-[11.5px]">
                    <span className="text-muted">
                      {p.hostname.replace('dh1-', '')} · feed {p.feed}
                    </span>
                    <span className="tabular">{formatW(p.powerDemandW)}</span>
                  </div>
                  <Meter value={p.powerDemandW} max={rating} tone={p.powerStatus !== 'available' ? 'crit' : p.powerDemandW > rating * 0.8 ? 'warn' : 'ok'} label={`${p.hostname} load`} />
                </div>
              );
            })}
          </div>
        )}

        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Placement checks</div>
          {issues.length === 0 ? (
            <div className="text-[12px] text-ok">No issues found.</div>
          ) : (
            <ul className="space-y-1">
              {issues.map((i, n) => (
                <li key={n} className="flex gap-1.5 text-[12px]">
                  <TriangleAlert className={`mt-0.5 size-3.5 shrink-0 ${i.severity === 'critical' ? 'text-crit' : 'text-warn'}`} />
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Install from inventory</div>
          {inventory.length === 0 ? (
            <div className="text-[12px] text-subtle">No inventory equipment fits a {rack.type === 'mgx' ? 'MGX' : 'standard'} rack.</div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Select aria-label="Equipment to install" value={chosen?.id} onChange={(e) => setEqId(e.target.value)}>
                  {inventory.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.hostname} · {getEquipmentModel(e.modelId).shortName} ({getEquipmentModel(e.modelId).heightU}U)
                    </option>
                  ))}
                </Select>
                <Select aria-label="Target U position" value={targetU ?? ''} onChange={(e) => setU(Number(e.target.value))} disabled={fits.length === 0}>
                  {fits.length === 0 && <option value="">No space</option>}
                  {fits.map((x) => (
                    <option key={x} value={x}>
                      U{x}
                      {h > 1 ? `–U${x + h - 1}` : ''}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                variant="primary"
                disabled={!chosen || !targetU}
                onClick={() => chosen && targetU && act({ type: 'equipment/mount', equipmentId: chosen.id, rackId, uStart: targetU }, `${chosen.hostname} mounted at ${rackId} U${targetU}`)}
              >
                <ArrowDownToLine /> Mount at U{targetU ?? '—'}
              </Button>
              <div className="flex flex-wrap gap-1.5" aria-label="Drag to a free U">
                {inventory.map((e) => (
                  <span
                    key={e.id}
                    draggable
                    data-inventory-equipment={e.id}
                    onDragStart={(ev) => {
                      setDrag({ kind: 'equipment', equipmentId: e.id });
                      ev.dataTransfer.setData(EQUIPMENT_MIME, e.id);
                      ev.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDrag(null)}
                    className="cursor-grab rounded-[4px] border border-border-strong bg-surface-3 px-2 py-1 font-mono text-[11px] active:cursor-grabbing"
                    title="Drag onto a free U in the elevation"
                  >
                    ⠿ {e.hostname} ({getEquipmentModel(e.modelId).heightU}U)
                  </span>
                ))}
              </div>
              <Callout tone="info">Drag a chip onto a free U in the elevation, or use the selectors above. New equipment is mounted powered off: cable power, management and data first, then power on.</Callout>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
