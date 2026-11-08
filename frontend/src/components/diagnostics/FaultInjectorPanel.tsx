import { FlaskConical, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { FAULT_DEFINITIONS, FAULT_TYPES } from '@/data/faults/faultCatalog';
import { describeTarget, eligibleTargets } from '@/simulation/diagnostics/FaultInjector';
import { useAct } from '@/stores/hardwareStore';
import { useSim, useSimulationStore } from '@/stores/simulationStore';
import type { FaultType, Id } from '@/types/simulation';

/** Developer-mode fault injection: pick a fault type, a target and parameters. */
export function FaultInjectorPanel({ equipmentId }: { equipmentId?: Id }) {
  const act = useAct();
  const equipment = useSim((s) => s.equipment);
  const faults = useSim((s) => s.faults);
  const [type, setType] = useState<FaultType>('psu_failure');
  const [target, setTarget] = useState<string>('');
  const [params, setParams] = useState<Record<string, number>>({});
  const def = FAULT_DEFINITIONS[type];

  const targets = useMemo(() => eligibleTargets(useSimulationStore.getState().state, type, equipmentId), [type, equipmentId, equipment]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = targets.find((t) => t.id === target) ? target : (targets[0]?.id ?? '');
  const active = Object.values(faults).filter((f) => {
    if (!equipmentId) return true;
    const s = useSimulationStore.getState().state;
    const c = s.components[f.targetId];
    if (c?.location.kind === 'equipment') return c.location.equipmentId === equipmentId;
    const p = s.ports[f.targetId];
    if (p) return p.equipmentId === equipmentId;
    return f.targetId === equipmentId;
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
        <Select aria-label="Fault type" value={type} onChange={(e) => setType(e.target.value as FaultType)}>
          {FAULT_TYPES.filter((t) => !equipmentId || eligibleTargets(useSimulationStore.getState().state, t, equipmentId).length > 0).map((t) => (
            <option key={t} value={t}>
              {FAULT_DEFINITIONS[t].name}
            </option>
          ))}
        </Select>
        <Select aria-label="Fault target" value={chosen} onChange={(e) => setTarget(e.target.value)} disabled={targets.length === 0}>
          {targets.length === 0 && <option>No eligible targets</option>}
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
        <Button
          variant="danger"
          disabled={!chosen}
          onClick={() => act({ type: 'fault/inject', faultType: type, targetId: chosen, params, hidden: true, source: 'developer' }, `Injected: ${def.name}`)}
        >
          <FlaskConical /> Inject
        </Button>
      </div>
      {def.params?.map((p) => (
        <label key={p.name} className="flex items-center gap-2 text-[12px] text-muted">
          {p.label}
          {p.options ? (
            <Select value={params[p.name] ?? p.default} onChange={(e) => setParams({ ...params, [p.name]: Number(e.target.value) })}>
              {p.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <input
              type="number"
              min={1}
              value={params[p.name] ?? p.default}
              onChange={(e) => setParams({ ...params, [p.name]: Number(e.target.value) })}
              className="h-7 w-20 rounded-chip border border-border-strong bg-surface-2 px-2 text-fg"
            />
          )}
        </label>
      ))}
      <div className="rounded-chip border border-border bg-surface-2 p-2 text-[11.5px] text-muted">
        <div>
          <span className="text-fg">Root cause:</span> {def.rootCause}
        </div>
        <div className="mt-1">
          <span className="text-fg">Learner sees:</span> {def.symptoms.join(' · ')}
        </div>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Active faults ({active.length})</div>
        {active.length === 0 ? (
          <div className="text-[12px] text-subtle">None</div>
        ) : (
          <ul className="space-y-1">
            {active.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-chip border border-border bg-surface-2 px-2 py-1 text-[12px]">
                <Badge tone={f.source === 'scenario' ? 'info' : 'warn'}>{f.source}</Badge>
                <span className="truncate">
                  {FAULT_DEFINITIONS[f.type].name} → {describeTarget(useSimulationStore.getState().state, f.targetId)}
                  {Object.keys(f.params).length > 0 && <span className="text-subtle"> {JSON.stringify(f.params)}</span>}
                </span>
                <Button size="icon" variant="ghost" className="ml-auto size-6" aria-label={`Clear fault ${f.id}`} onClick={() => act({ type: 'fault/clear', faultId: f.id })}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
