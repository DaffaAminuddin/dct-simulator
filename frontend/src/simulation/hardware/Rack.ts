/**
 * Rack mounting rules and placement checks (SIMULATION_SPEC §7).
 */
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { equipmentInRack, isHost, isMainPowerOn, portsOf } from '@/simulation/core/SimulationState';
import { fail, formatU } from '@/simulation/core/util';
import { estimateRunningDemand } from '@/simulation/power/PowerState';
import { RECIRCULATION_C_PER_OPEN_U, RECIRCULATION_CAP_C } from '@/simulation/cooling/ThermalModel';
import type { Equipment, Id, SimulationState } from '@/types/simulation';

export const HEAVY_KG = 40;
export const HEAVY_MAX_U = 20;

export interface URange {
  equipmentId: Id;
  start: number;
  end: number;
}

export function occupiedRanges(s: SimulationState, rackId: Id, excludeId?: Id): URange[] {
  const out: URange[] = [];
  for (const eq of equipmentInRack(s, rackId)) {
    if (eq.id === excludeId || eq.location.kind !== 'rack' || eq.location.uStart === null) continue;
    const h = getEquipmentModel(eq.modelId).heightU;
    out.push({ equipmentId: eq.id, start: eq.location.uStart, end: eq.location.uStart + h - 1 });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** U numbers with nothing mounted (1-based). */
export function freeUnits(s: SimulationState, rackId: Id): number[] {
  const rack = s.racks[rackId];
  const used = new Set<number>();
  for (const r of occupiedRanges(s, rackId)) for (let u = r.start; u <= r.end; u++) used.add(u);
  const out: number[] = [];
  for (let u = 1; u <= rack.heightU; u++) if (!used.has(u)) out.push(u);
  return out;
}

/** Validate a mount; throws SimError for hard errors and returns best-practice warnings. */
export function validateMount(s: SimulationState, equipmentId: Id, rackId: Id, uStart: number): string[] {
  const eq = s.equipment[equipmentId];
  if (!eq) fail('UNKNOWN_EQUIPMENT', `Unknown equipment ${equipmentId}`);
  const rack = s.racks[rackId];
  if (!rack) fail('UNKNOWN_RACK', `Unknown rack ${rackId}`);
  if (eq.location.kind !== 'inventory') fail('ALREADY_MOUNTED', `${eq.hostname} is already installed; remove it first`);
  const model = getEquipmentModel(eq.modelId);
  if (model.kind === 'cdu' || model.rackTypes.length === 0) fail('NOT_RACKABLE', `${model.shortName} is floor-standing equipment`);
  if (model.heightU === 0) fail('ZERO_U', '0U equipment mounts on the rack side brackets, not in U positions');
  if (!model.rackTypes.includes(rack.type)) {
    if (rack.type === 'standard') fail('RACK_TYPE', `${model.shortName} needs an MGX rack with busbar, NVLink spine and liquid manifold; ${rack.id} is a standard rack`);
    fail('RACK_TYPE', `${model.shortName} uses standard 19-inch rails; ${rack.id} is an MGX rack`);
  }
  if (!Number.isInteger(uStart) || uStart < 1) fail('OUT_OF_RANGE', 'U position must be a whole number ≥ 1');
  const end = uStart + model.heightU - 1;
  if (end > rack.heightU) fail('OUT_OF_RANGE', `${model.shortName} needs ${formatU(uStart, model.heightU)} but ${rack.id} has only ${rack.heightU}U`);
  for (const r of occupiedRanges(s, rackId)) {
    if (uStart <= r.end && end >= r.start) {
      const other = s.equipment[r.equipmentId];
      fail('OVERLAP', `${formatU(uStart, model.heightU)} overlaps ${other.hostname} (${formatU(r.start, r.end - r.start + 1)})`);
    }
  }

  const warnings: string[] = [];
  if (model.weightKg >= HEAVY_KG && uStart > HEAVY_MAX_U) {
    warnings.push(`Heavy equipment (${model.weightKg} kg) above U${HEAVY_MAX_U}: install heavy equipment low in the rack to keep the centre of gravity low`);
  }
  const inRack = equipmentInRack(s, rackId);
  const weight = inRack.reduce((w, e) => w + getEquipmentModel(e.modelId).weightKg, 0) + model.weightKg;
  if (weight > rack.maxWeightKg) warnings.push(`Rack static load ${Math.round(weight)} kg exceeds the ${rack.maxWeightKg} kg rating`);
  const power = inRack.filter(isHost).reduce((w, e) => w + estimateRunningDemand(s, e), 0) + (isHostModel(model.kind) ? estimateRunningDemand(s, eq) : 0);
  if (power > rack.maxPowerW) warnings.push(`Rack design power exceeded: ${(power / 1000).toFixed(1)} kW of ${(rack.maxPowerW / 1000).toFixed(0)} kW`);
  return warnings;
}

function isHostModel(kind: string) {
  return kind === 'server' || kind === 'compute_tray' || kind === 'nvlink_switch_tray' || kind === 'switch';
}

export function mountEquipment(s: SimulationState, equipmentId: Id, rackId: Id, uStart: number): string[] {
  const warnings = validateMount(s, equipmentId, rackId, uStart);
  const eq = s.equipment[equipmentId];
  eq.location = { kind: 'rack', rackId, uStart };
  eq.desiredPower = 'off';
  eq.bootElapsedMs = 0;
  return warnings;
}

export function unmountEquipment(s: SimulationState, equipmentId: Id): string[] {
  const eq = s.equipment[equipmentId];
  if (!eq) fail('UNKNOWN_EQUIPMENT', `Unknown equipment ${equipmentId}`);
  if (eq.location.kind !== 'rack') fail('NOT_MOUNTED', `${eq.hostname} is not rack-mounted`);
  if (isHost(eq) && isMainPowerOn(eq)) fail('POWERED_ON', `Power off ${eq.hostname} before removing it from the rack`);
  const cabled = portsOf(s, eq).filter((p) => p.cableId);
  if (cabled.length > 0) {
    const sample = cabled.slice(0, 3).map((p) => p.label).join(', ');
    fail('CABLES_ATTACHED', `Disconnect ${cabled.length} cable(s) from ${eq.hostname} first (${sample}${cabled.length > 3 ? ', …' : ''})`);
  }
  eq.location = { kind: 'inventory' };
  eq.desiredPower = 'off';
  eq.bootElapsedMs = 0;
  eq.uidLed = false;
  return [];
}

export interface PlacementIssue {
  severity: 'info' | 'warning' | 'critical';
  message: string;
  equipmentId?: Id;
}

/** Best-practice review of a rack's current build. */
export function placementChecks(s: SimulationState, rackId: Id): PlacementIssue[] {
  const rack = s.racks[rackId];
  const issues: PlacementIssue[] = [];
  const inRack = equipmentInRack(s, rackId);
  const hosts = inRack.filter(isHost);

  for (const eq of inRack) {
    const m = getEquipmentModel(eq.modelId);
    if (eq.location.kind === 'rack' && eq.location.uStart !== null && m.weightKg >= HEAVY_KG && eq.location.uStart > HEAVY_MAX_U) {
      issues.push({ severity: 'warning', equipmentId: eq.id, message: `${eq.hostname} (${m.weightKg} kg) is mounted above U${HEAVY_MAX_U}` });
    }
  }

  if (hosts.length > 0 && rack.openU > 0) {
    const rise = Math.min(RECIRCULATION_CAP_C, rack.openU * RECIRCULATION_C_PER_OPEN_U);
    issues.push({
      severity: 'warning',
      message: `${rack.openU} open U without blanking panels: hot-air recirculation adds about ${rise.toFixed(1)} °C to inlet temperatures`,
    });
  }

  const weight = inRack.reduce((w, e) => w + getEquipmentModel(e.modelId).weightKg, 0);
  if (weight > rack.maxWeightKg) issues.push({ severity: 'critical', message: `Static load ${Math.round(weight)} kg exceeds the ${rack.maxWeightKg} kg rating` });
  if (rack.powerW > rack.maxPowerW) issues.push({ severity: 'warning', message: `Rack draw ${(rack.powerW / 1000).toFixed(1)} kW exceeds design power ${(rack.maxPowerW / 1000).toFixed(0)} kW` });

  for (const eq of hosts) issues.push(...feedRedundancyIssues(s, eq));
  return issues;
}

/** Dual-PSU equipment should have cords on both the A and B feeds. */
export function feedRedundancyIssues(s: SimulationState, eq: Equipment): PlacementIssue[] {
  const m = getEquipmentModel(eq.modelId);
  if (m.powerPath !== 'psu') return [];
  const psuSlots = m.slots.filter((sl) => sl.category === 'psu');
  if (psuSlots.length < 2) return [];
  const feeds = new Set<string>();
  let uncabled = 0;
  for (const sl of psuSlots) {
    const cid = eq.slots[sl.id];
    if (!cid) continue;
    const inlet = portsOf(s, eq).find((p) => p.componentId === cid && p.role === 'power_in');
    const outletId = inlet?.peerPortId;
    if (!outletId) {
      uncabled++;
      continue;
    }
    const pdu = s.equipment[s.ports[outletId].equipmentId];
    if (pdu.feed) feeds.add(pdu.feed);
  }
  const out: PlacementIssue[] = [];
  if (uncabled > 0) out.push({ severity: 'warning', equipmentId: eq.id, message: `${eq.hostname}: ${uncabled} PSU(s) without a power cord` });
  if (feeds.size === 1 && psuSlots.length - uncabled >= 2) {
    out.push({ severity: 'critical', equipmentId: eq.id, message: `${eq.hostname}: all PSU cords on feed ${[...feeds][0]}. A single feed failure will drop the host` });
  }
  return out;
}
