/**
 * Thermal model (SIMULATION_SPEC §4). Lumped, first-order and deliberately
 * simple: T_target = T_coolant + P × R / flowFactor, integrated with τ = 15 s.
 * Not suitable for real facility design.
 */
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { type DeriveContext, equipmentInRack, isHost, isMainPowerOn } from '@/simulation/core/SimulationState';
import { round1, set } from '@/simulation/core/util';
import { computeAirflow } from '@/simulation/hardware/Fan';
import { maxDemand } from '@/simulation/power/PowerState';
import type { SimulationState } from '@/types/simulation';

export const THERMAL_TAU_MS = 15000;
export const STRATIFICATION_C_PER_U = 0.05;
export const RECIRCULATION_C_PER_OPEN_U = 0.25;
export const RECIRCULATION_CAP_C = 4;
export const INVENTORY_AMBIENT_C = 22;

export function openRackUnits(s: SimulationState, rackId: string): number {
  const rack = s.racks[rackId];
  let used = 0;
  for (const eq of equipmentInRack(s, rackId)) {
    if (eq.location.kind === 'rack' && eq.location.uStart !== null) used += getEquipmentModel(eq.modelId).heightU;
  }
  return Math.max(0, rack.heightU - used);
}

export function deriveThermal(s: SimulationState, ctx: DeriveContext): void {
  const crah = s.facility.crahSupplyC;
  const rackRecirc: Record<string, number> = {};
  for (const rack of Object.values(s.racks)) {
    const open = openRackUnits(s, rack.id);
    const hasHeat = equipmentInRack(s, rack.id).some((e) => isHost(e));
    const recirc = hasHeat ? Math.min(RECIRCULATION_CAP_C, open * RECIRCULATION_C_PER_OPEN_U) : 0;
    rackRecirc[rack.id] = recirc;
    set(rack, 'openU', open);
    set(rack, 'inletC', round1(crah + recirc));
  }

  for (const eq of Object.values(s.equipment)) {
    const model = getEquipmentModel(eq.modelId);
    const loc = eq.location;
    let inlet = INVENTORY_AMBIENT_C;
    if (loc.kind === 'rack') inlet = crah + rackRecirc[loc.rackId] + STRATIFICATION_C_PER_U * (loc.uStart ?? 21);
    else if (loc.kind === 'floor') inlet = crah;
    set(eq, 'inletC', round1(inlet));

    const hostOn = isHost(eq) ? isMainPowerOn(eq) : eq.powerStatus === 'available';
    const fanSlots = model.slots.filter((sl) => sl.category === 'fan');
    let working = 0;
    for (const sl of fanSlots) {
      const cid = eq.slots[sl.id];
      if (cid && hostOn && !ctx.faults.has(cid, 'fan_failure')) working++;
    }
    const loadFraction = isHost(eq) ? eq.powerDemandW / maxDemand(s, eq) : 0.5;
    const air = computeAirflow(fanSlots.length, working, loadFraction, eq.chassisOpen && hostOn);
    set(eq, 'airflowFactor', hostOn ? air.airflowFactor : 1);

    const rack = loc.kind === 'rack' ? s.racks[loc.rackId] : undefined;
    const flowFactor = rack?.coolant ? rack.coolant.flowPct / 100 : 0;
    const coolantC = rack?.coolant?.supplyC ?? inlet;

    for (const sl of model.slots) {
      const cid = eq.slots[sl.id];
      if (!cid) continue;
      const comp = s.components[cid];
      const cm = getComponentModel(comp.modelId);
      if (comp.category === 'fan') {
        const runs = hostOn && !ctx.faults.has(cid, 'fan_failure');
        set(comp, 'dutyPct', runs ? Math.round(air.duty * 100) : 0);
        set(comp, 'rpm', runs ? Math.round(((cm.maxRpm ?? 10000) * air.duty) / 10) * 10 : 0);
      }
      let target = inlet;
      if (comp.powered && comp.powerW > 0) {
        const degraded = comp.category === 'gpu' && ctx.faults.has(cid, 'gpu_cooling_degraded') ? 2.5 : 1;
        const r = cm.thermalResistance * degraded;
        if (cm.cooling === 'liquid') target = coolantC + (comp.powerW * r) / Math.max(flowFactor, 0.05);
        else target = inlet + (comp.powerW * r) / Math.max(hostOn ? air.airflowFactor : 1, 0.05);
      }
      set(comp, 'targetTempC', round1(Math.min(target, 150)));
    }
  }

  for (const comp of Object.values(s.components)) {
    if (comp.location.kind === 'inventory') set(comp, 'targetTempC', INVENTORY_AMBIENT_C);
  }
}

/** First-order integration toward the target temperature. */
export function integrateTemperatures(s: SimulationState, dtMs: number): void {
  const k = 1 - Math.exp(-dtMs / THERMAL_TAU_MS);
  for (const comp of Object.values(s.components)) {
    const diff = comp.targetTempC - comp.temperatureC;
    if (Math.abs(diff) <= 0.1) {
      if (comp.temperatureC !== comp.targetTempC) comp.temperatureC = comp.targetTempC;
      continue;
    }
    // Minimum 0.1 °C step so that rounding cannot stall convergence.
    let step = diff * k;
    if (Math.abs(step) < 0.1) step = Math.sign(diff) * 0.1;
    comp.temperatureC = round1(comp.temperatureC + step);
  }
}

/** Jump every component to its target (used when a scenario starts). */
export function settleTemperatures(s: SimulationState): void {
  for (const comp of Object.values(s.components)) comp.temperatureC = comp.targetTempC;
}
