/**
 * Scenario-driven fault injection (SIMULATION_SPEC §8). Faults attach to
 * instance ids: replacing a part removes the fault from the running system,
 * while the defective part keeps its fault in inventory.
 */
import { FAULT_DEFINITIONS } from '@/data/faults/faultCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { fail } from '@/simulation/core/util';
import type { Fault, FaultTargetKind, FaultType, Id, SimAction, SimulationState } from '@/types/simulation';

type InjectAction = Extract<SimAction, { type: 'fault/inject' }>;

export function validateFaultTarget(s: SimulationState, type: FaultType, targetId: Id): FaultTargetKind {
  const def = FAULT_DEFINITIONS[type];
  if (!def) fail('UNKNOWN_FAULT', `Unknown fault type: ${type}`);
  switch (def.targetKind) {
    case 'component': {
      const c = s.components[targetId];
      if (!c) fail('BAD_TARGET', `${def.name} needs a component target`);
      if (def.targetCategories && !def.targetCategories.includes(c.category)) {
        fail('BAD_TARGET', `${def.name} applies to ${def.targetCategories.join('/')} components, not ${c.category}`);
      }
      break;
    }
    case 'equipment': {
      const e = s.equipment[targetId];
      if (!e) fail('BAD_TARGET', `${def.name} needs an equipment target`);
      if (def.targetEquipmentKinds && !def.targetEquipmentKinds.includes(e.kind)) {
        fail('BAD_TARGET', `${def.name} applies to ${def.targetEquipmentKinds.join('/')} equipment, not ${e.kind}`);
      }
      break;
    }
    case 'port':
      if (!s.ports[targetId]) fail('BAD_TARGET', `${def.name} needs a port target`);
      break;
    case 'cable':
      if (!s.cables[targetId]) fail('BAD_TARGET', `${def.name} needs a cable target`);
      break;
    case 'feed':
      if (targetId !== 'feed:A' && targetId !== 'feed:B') fail('BAD_TARGET', `${def.name} needs a feed target (feed:A or feed:B)`);
      break;
    case 'rack': {
      const r = s.racks[targetId];
      if (!r) fail('BAD_TARGET', `${def.name} needs a rack target`);
      if (type === 'coolant_leak' && !r.cduId) fail('BAD_TARGET', `${targetId} is not liquid-cooled`);
      break;
    }
  }
  return def.targetKind;
}

export function injectFault(s: SimulationState, action: InjectAction): Fault {
  const targetKind = validateFaultTarget(s, action.faultType, action.targetId);
  const existing = Object.values(s.faults).find((f) => f.type === action.faultType && f.targetId === action.targetId);
  if (existing && action.faultType !== 'gpu_xid') fail('FAULT_EXISTS', `${FAULT_DEFINITIONS[action.faultType].name} is already active on this target`);
  const def = FAULT_DEFINITIONS[action.faultType];
  const params: Record<string, number | string> = {};
  for (const p of def.params ?? []) params[p.name] = action.params?.[p.name] ?? p.default;
  s.seq.fault += 1;
  const fault: Fault = {
    id: `flt-${String(s.seq.fault).padStart(4, '0')}`,
    type: action.faultType,
    targetId: action.targetId,
    targetKind,
    injectedAtMs: s.timeMs,
    hidden: action.hidden ?? true,
    source: action.source ?? 'developer',
    params,
  };
  s.faults[fault.id] = fault;
  return fault;
}

export function clearFault(s: SimulationState, faultId: Id): Fault {
  const f = s.faults[faultId];
  if (!f) fail('UNKNOWN_FAULT', `No active fault ${faultId}`);
  delete s.faults[faultId];
  return f;
}

/** Human-readable description of a fault target. */
export function describeTarget(s: SimulationState, targetId: Id): string {
  const c = s.components[targetId];
  if (c) {
    const loc = c.location;
    if (loc.kind === 'equipment') {
      const eq = s.equipment[loc.equipmentId];
      const slot = getEquipmentModel(eq.modelId).slots.find((sl) => sl.id === loc.slotId);
      return `${eq.hostname} · ${slot?.label ?? loc.slotId}`;
    }
    return `${getComponentModel(c.modelId).name} (inventory, ${c.serial})`;
  }
  const e = s.equipment[targetId];
  if (e) return e.hostname;
  const p = s.ports[targetId];
  if (p) return `${s.equipment[p.equipmentId].hostname} · ${p.label}`;
  const cb = s.cables[targetId];
  if (cb) return `Cable ${cb.label}`;
  if (targetId.startsWith('feed:')) return `Facility feed ${targetId.slice(5)}`;
  const r = s.racks[targetId];
  if (r) return `Rack ${r.id}`;
  return targetId;
}

export interface TargetOption {
  id: Id;
  label: string;
}

/** Candidate targets for a fault type, limited to one equipment where relevant. */
export function eligibleTargets(s: SimulationState, type: FaultType, equipmentId?: Id): TargetOption[] {
  const def = FAULT_DEFINITIONS[type];
  const out: TargetOption[] = [];
  switch (def.targetKind) {
    case 'component':
      for (const c of Object.values(s.components)) {
        if (c.location.kind !== 'equipment') continue;
        if (equipmentId && c.location.equipmentId !== equipmentId) continue;
        if (def.targetCategories?.includes(c.category)) out.push({ id: c.id, label: describeTarget(s, c.id) });
      }
      break;
    case 'equipment':
      for (const e of Object.values(s.equipment)) {
        if (equipmentId && e.id !== equipmentId) continue;
        if (def.targetEquipmentKinds?.includes(e.kind) && e.location.kind !== 'inventory') out.push({ id: e.id, label: e.hostname });
      }
      break;
    case 'port':
      for (const p of Object.values(s.ports)) {
        if (equipmentId && p.equipmentId !== equipmentId) continue;
        if (['data', 'fabric', 'uplink', 'bmc', 'mgmt'].includes(p.role)) out.push({ id: p.id, label: describeTarget(s, p.id) });
      }
      break;
    case 'cable':
      for (const cb of Object.values(s.cables)) {
        const ends = cb.ends.map((e) => e.portId).filter(Boolean) as Id[];
        if (ends.length === 0) continue;
        if (equipmentId && !ends.some((pid) => s.ports[pid].equipmentId === equipmentId)) continue;
        const label = ends.map((pid) => describeTarget(s, pid)).join(' ↔ ');
        out.push({ id: cb.id, label: `${cb.label}: ${label}` });
      }
      break;
    case 'feed':
      out.push({ id: 'feed:A', label: 'Facility feed A' }, { id: 'feed:B', label: 'Facility feed B' });
      break;
    case 'rack':
      for (const r of Object.values(s.racks)) if (r.cduId) out.push({ id: r.id, label: `Rack ${r.id} manifold` });
      break;
  }
  return out;
}
