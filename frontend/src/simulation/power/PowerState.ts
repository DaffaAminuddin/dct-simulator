/**
 * Power helpers: workload-dependent component load and equipment demand
 * estimates. Simplified teaching model: P = idle + load × (max − idle).
 */
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import type { ComponentCategory, WorkloadProfile } from '@/types/catalog';
import type { Equipment, PowerStatus, SimulationState } from '@/types/simulation';

const LOAD: Record<WorkloadProfile, Partial<Record<ComponentCategory, number>>> = {
  idle: { cpu: 0.08, gpu: 0, dimm: 0.1, nic: 0.1, dpu: 0.2, nvme: 0.05, ssd: 0.05, raid: 0.2, fan: 0.3, nvswitch: 0.05, asic: 0.3, riser: 0.2, motherboard: 0.3, bmc: 0.5 },
  light: { cpu: 0.35, gpu: 0.3, dimm: 0.4, nic: 0.3, dpu: 0.4, nvme: 0.2, ssd: 0.2, raid: 0.4, fan: 0.45, nvswitch: 0.3, asic: 0.5, riser: 0.4, motherboard: 0.5, bmc: 0.5 },
  training: { cpu: 0.6, gpu: 0.92, dimm: 0.7, nic: 0.8, dpu: 0.5, nvme: 0.35, ssd: 0.3, raid: 0.5, fan: 0.7, nvswitch: 0.9, asic: 0.7, riser: 0.7, motherboard: 0.7, bmc: 0.5 },
};

/** GPU utilization for each workload profile (percent). */
export const GPU_UTILIZATION: Record<WorkloadProfile, number> = { idle: 0, light: 35, training: 96 };

export function loadFraction(workload: WorkloadProfile, category: ComponentCategory): number {
  return LOAD[workload][category] ?? 0;
}

/** Nominal power of a component running at the given workload. */
export function componentRunningW(modelId: string, workload: WorkloadProfile): number {
  const m = getComponentModel(modelId);
  if (m.category === 'psu' || m.category === 'pump') return m.idleW;
  return m.idleW + loadFraction(workload, m.category) * (m.maxW - m.idleW);
}

/** Power the host draws in standby (BMC and PSU housekeeping). */
export const STANDBY_W = 15;

/** Demand if the host were running its workload now (before power-brake). */
export function estimateRunningDemand(s: SimulationState, eq: Equipment): number {
  const model = getEquipmentModel(eq.modelId);
  let w = model.baseW;
  for (const cid of Object.values(eq.slots)) {
    if (!cid) continue;
    const c = s.components[cid];
    if (c) w += componentRunningW(c.modelId, eq.workload);
  }
  return Math.round(w);
}

/** Demand at idle; PSU capacity below this prevents power-on. */
export function estimateIdleDemand(s: SimulationState, eq: Equipment): number {
  const model = getEquipmentModel(eq.modelId);
  let w = model.baseW;
  for (const cid of Object.values(eq.slots)) {
    if (!cid) continue;
    const c = s.components[cid];
    if (c) w += componentRunningW(c.modelId, 'idle');
  }
  return Math.round(w);
}

/** Maximum possible draw (all components at max), used for fan-demand scaling. */
export function maxDemand(s: SimulationState, eq: Equipment): number {
  const model = getEquipmentModel(eq.modelId);
  let w = model.baseW;
  for (const cid of Object.values(eq.slots)) {
    if (!cid) continue;
    const c = s.components[cid];
    if (c) w += getComponentModel(c.modelId).maxW;
  }
  return Math.max(1, w);
}

export const POWER_STATUS_LABEL: Record<PowerStatus, string> = {
  redundant: 'Redundant',
  available: 'Available (no redundancy)',
  degraded: 'Degraded',
  failed: 'Failed',
  disconnected: 'Disconnected',
  not_applicable: 'n/a',
};
