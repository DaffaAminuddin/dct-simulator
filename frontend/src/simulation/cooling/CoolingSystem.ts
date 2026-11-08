/**
 * Liquid cooling loop (SIMULATION_SPEC §4): CDU pumps (N+1), rack flow, leaks,
 * supply/return temperatures. Simplified: one shared supply setpoint per CDU.
 */
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import type { DeriveContext } from '@/simulation/core/SimulationState';
import { round1, set } from '@/simulation/core/util';
import type { CoolantLoopState, CoolingStatus, SimulationState } from '@/types/simulation';

/** Specific heat of water-glycol approximated as water: J/(kg·K). */
export const COOLANT_CP = 4186;

export function deriveCooling(s: SimulationState, ctx: DeriveContext): void {
  const cduFlow: Record<string, { flowPct: number; working: number; installed: number; supplyC: number; nominalLpm: number }> = {};

  for (const eq of Object.values(s.equipment)) {
    if (eq.kind !== 'cdu') continue;
    const model = getEquipmentModel(eq.modelId);
    const powered = eq.powerStatus === 'available';
    let installed = 0;
    let working = 0;
    for (const cid of Object.values(eq.slots)) {
      if (!cid) continue;
      installed++;
      if (powered && !ctx.faults.has(cid, 'pump_failure')) working++;
    }
    cduFlow[eq.id] = {
      flowPct: working >= 1 ? 100 : 0,
      working,
      installed,
      supplyC: model.cdu?.supplySetpointC ?? 30,
      nominalLpm: model.cdu?.nominalFlowLpmPerRack ?? 160,
    };
  }

  for (const rack of Object.values(s.racks)) {
    if (!rack.cduId) continue;
    const cdu = cduFlow[rack.cduId];
    const leak = ctx.faults.has(rack.id, 'coolant_leak');
    const flowPct = cdu ? cdu.flowPct * (leak ? 0.7 : 1) : 0;
    const flowLpm = cdu ? (cdu.nominalLpm * flowPct) / 100 : 0;
    const supplyC = cdu?.supplyC ?? 30;
    const massFlow = flowLpm / 60; // kg/s, ~1 kg per litre
    const returnC = massFlow > 0 ? supplyC + rack.powerW / (massFlow * COOLANT_CP) : supplyC;
    let status: CoolingStatus = 'normal';
    if (flowPct <= 0) status = 'failed';
    else if (leak) status = 'critical';
    else if (cdu && cdu.working < cdu.installed) status = 'warning';
    const next: CoolantLoopState = { flowPct: Math.round(flowPct), flowLpm: Math.round(flowLpm), supplyC, returnC: round1(Math.min(returnC, 80)), leak, status };
    if (!rack.coolant) rack.coolant = next;
    else for (const k of Object.keys(next) as (keyof CoolantLoopState)[]) set(rack.coolant, k, next[k] as never);
  }
}
