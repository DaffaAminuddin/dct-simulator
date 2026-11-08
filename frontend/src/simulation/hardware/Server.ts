/**
 * Host state machine (SIMULATION_SPEC §1.1) for servers, compute trays,
 * NVLink switch trays and switches, plus POST checks.
 */
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { type DeriveContext, isHost } from '@/simulation/core/SimulationState';
import { set } from '@/simulation/core/util';
import type { Equipment, SimulationState } from '@/types/simulation';

/** Reasons POST would fail for this host right now (empty = POST passes). */
export function postCheck(s: SimulationState, eq: Equipment, ctx: DeriveContext): string[] {
  const model = getEquipmentModel(eq.modelId);
  const failures: string[] = [];
  let dimmSlots = 0;
  let usableDimms = 0;

  for (const slot of model.slots) {
    const cid = eq.slots[slot.id];
    const comp = cid ? s.components[cid] : undefined;
    switch (slot.category) {
      case 'cpu':
        if (slot.id === 'cpu0' && !comp) failures.push('No processor detected in CPU 0 socket');
        if (comp && ctx.faults.has(comp.id, 'cpu_failure')) failures.push(`Processor internal error (IERR) on ${slot.label}`);
        break;
      case 'dimm':
        dimmSlots++;
        if (comp && !ctx.faults.has(comp.id, 'dimm_uncorrectable')) usableDimms++;
        break;
      case 'bmc':
        if (!comp) failures.push('DC-SCM module missing: BIOS flash not present');
        break;
      case 'asic':
        if (!comp) failures.push('Switch ASIC not detected');
        break;
      default:
        break;
    }
    if (slot.tags?.includes('boot')) {
      if (!comp) failures.push('No bootable device found');
      else if (ctx.faults.has(comp.id, 'nvme_failure')) failures.push('Boot device failure: unable to load the operating system');
    }
  }
  if (dimmSlots > 0 && usableDimms === 0) failures.push('No usable system memory detected');
  return failures;
}

export function deriveHostStates(s: SimulationState, ctx: DeriveContext): void {
  for (const eq of Object.values(s.equipment)) {
    if (!isHost(eq)) continue;
    const model = getEquipmentModel(eq.modelId);
    const p = ctx.power[eq.id];
    const bmcSlot = model.slots.find((sl) => sl.category === 'bmc');
    const bmcId = bmcSlot ? eq.slots[bmcSlot.id] : null;
    const bmcOk = !!bmcId && !ctx.faults.has(bmcId, 'bmc_failure');

    if (!p?.hasPower) {
      set(eq, 'state', 'powered_off');
      set(eq, 'bootElapsedMs', 0);
      set(eq, 'bmcAlive', false);
      set(eq, 'postFailures', []);
      set(eq, 'powerBrake', false);
      continue;
    }

    set(eq, 'bmcAlive', bmcOk);

    if (eq.desiredPower === 'off' || !p.canRun) {
      set(eq, 'state', 'standby');
      set(eq, 'bootElapsedMs', 0);
      set(eq, 'postFailures', []);
      set(eq, 'powerBrake', false);
      continue;
    }

    const failures = postCheck(s, eq, ctx);
    set(eq, 'postFailures', failures);
    set(eq, 'powerBrake', p.brake);
    if (eq.bootElapsedMs < model.postMs) set(eq, 'state', 'powered_on');
    else if (failures.length > 0) set(eq, 'state', 'boot_failed');
    else if (eq.bootElapsedMs < model.bootTimeMs) set(eq, 'state', 'booting');
    // os_running vs degraded is decided after component conditions (finalizeHealth).
    else if (eq.state !== 'degraded') set(eq, 'state', 'os_running');
  }
}

/** Advance boot timers; called from SimulationEngine.advance before derivation. */
export function advanceBoot(s: SimulationState, dtMs: number): void {
  for (const eq of Object.values(s.equipment)) {
    if (!isHost(eq) || eq.desiredPower !== 'on') continue;
    if (eq.state === 'powered_off' || eq.state === 'standby') continue;
    const model = getEquipmentModel(eq.modelId);
    if (eq.bootElapsedMs < model.bootTimeMs) eq.bootElapsedMs = Math.min(model.bootTimeMs, eq.bootElapsedMs + dtMs);
  }
}

/** Seconds remaining until the OS is up, or null if not booting. */
export function bootRemainingS(eq: Equipment): number | null {
  if (eq.state !== 'powered_on' && eq.state !== 'booting') return null;
  const model = getEquipmentModel(eq.modelId);
  return Math.max(0, Math.ceil((model.bootTimeMs - eq.bootElapsedMs) / 1000));
}

export function bootPhaseLabel(eq: Equipment): string {
  switch (eq.state) {
    case 'powered_on':
      return 'POST';
    case 'booting':
      return 'Loading OS';
    default:
      return '';
  }
}

/** Thermal protection: trip hosts with any component at or above its critical limit. */
export function checkThermalTrips(s: SimulationState): Equipment[] {
  const tripped: Equipment[] = [];
  for (const eq of Object.values(s.equipment)) {
    if (!isHost(eq) || eq.desiredPower !== 'on') continue;
    if (eq.state === 'powered_off' || eq.state === 'standby') continue;
    for (const cid of Object.values(eq.slots)) {
      if (!cid) continue;
      const c = s.components[cid];
      if (c.temperatureC >= getComponentModel(c.modelId).thermal.criticalC) {
        eq.desiredPower = 'off';
        eq.thermalTrip = true;
        tripped.push(eq);
        break;
      }
    }
  }
  return tripped;
}
