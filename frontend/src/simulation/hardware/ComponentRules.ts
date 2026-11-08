/**
 * Component derivation pass: decides whether each component is energised,
 * computes its power draw and status, and collects its ground-truth conditions
 * by dispatching to the per-category rule modules.
 */
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getSlotDef } from '@/data/hardware/equipmentCatalog';
import {
  type DeriveContext,
  equipmentInRack,
  isHost,
  isMainPowerOn,
  OS_STATES,
} from '@/simulation/core/SimulationState';
import { set } from '@/simulation/core/util';
import { componentRunningW } from '@/simulation/power/PowerState';
import type { Condition, SimulationState } from '@/types/simulation';
import { deriveCpu } from './CPU';
import { deriveFan } from './Fan';
import { deriveGpu } from './GPU';
import { deriveDimm } from './Memory';
import { derivePsu } from './PSU';
import { cond, type RuleContext } from './rules';
import { deriveDrive, deriveRaid, deriveRiser } from './Storage';

const DEPENDENCY_FAULTS = ['riser_failure', 'cpu_failure', 'nic_failure'] as const;

function countHealthySwitchTrays(s: SimulationState, ctx: DeriveContext): Record<string, number> {
  const out: Record<string, number> = {};
  for (const rack of Object.values(s.racks)) {
    if (rack.type !== 'mgx') continue;
    let n = 0;
    for (const eq of equipmentInRack(s, rack.id)) {
      if (eq.kind !== 'nvlink_switch_tray') continue;
      if (!OS_STATES.has(eq.state) || ctx.faults.has(eq.id, 'nvswitch_failure')) continue;
      if (!eq.slots.nvsw0 || !eq.slots.nvsw1) continue;
      n++;
    }
    out[rack.id] = n;
  }
  return out;
}

export function deriveComponents(s: SimulationState, ctx: DeriveContext): void {
  const switchTrays = countHealthySwitchTrays(s, ctx);

  for (const comp of Object.values(s.components)) {
    const owner = comp.location.kind === 'equipment' ? s.equipment[comp.location.equipmentId] : undefined;
    // Parts in inventory, or inside equipment sitting in inventory, are inert.
    if (comp.location.kind === 'inventory' || owner?.location.kind === 'inventory') {
      set(comp, 'powered', false);
      set(comp, 'status', 'in_inventory');
      set(comp, 'powerW', 0);
      set(comp, 'conditions', []);
      set(comp, 'health', 'unknown');
      if (comp.category === 'fan') {
        set(comp, 'rpm', 0);
        set(comp, 'dutyPct', 0);
      }
      if (comp.gpu) set(comp.gpu, 'lifecycle', 'not_powered');
      continue;
    }

    const eq = owner as NonNullable<typeof owner>;
    const slot = getSlotDef(eq.modelId, comp.location.kind === 'equipment' ? comp.location.slotId : '');
    if (!slot) continue;
    const model = getComponentModel(comp.modelId);
    const host = isHost(eq);
    const hostOn = host ? isMainPowerOn(eq) : eq.powerStatus === 'available' || eq.powerStatus === 'degraded';
    const standby = eq.powerCapacityW > 0;

    let powered: boolean;
    if (comp.category === 'psu') powered = comp.inputLive === true;
    else if (comp.category === 'bmc') powered = standby;
    else powered = hostOn;

    let depOk = true;
    if (slot.dependsOn) {
      const depId = eq.slots[slot.dependsOn];
      depOk = !!depId && !DEPENDENCY_FAULTS.some((t) => ctx.faults.has(depId, t));
    }

    const conditions: Condition[] = [];
    const rc: RuleContext = {
      s,
      ctx,
      comp,
      eq,
      model,
      slot,
      hostOn,
      powered,
      depOk,
      conditions,
      healthySwitchTrays: eq.location.kind === 'rack' ? (switchTrays[eq.location.rackId] ?? 0) : 0,
    };

    let status = hostOn ? 'ok' : 'not_powered';
    let powerW = powered ? componentRunningW(comp.modelId, host ? eq.workload : 'light') : 0;

    switch (comp.category) {
      case 'gpu':
        deriveGpu(rc);
        status = comp.status;
        powerW = comp.powerW;
        break;
      case 'cpu':
        status = deriveCpu(rc);
        break;
      case 'dimm':
        status = deriveDimm(rc);
        break;
      case 'nvme':
      case 'ssd':
        status = deriveDrive(rc);
        break;
      case 'raid':
        status = deriveRaid(rc);
        break;
      case 'riser':
        status = deriveRiser(rc);
        break;
      case 'psu': {
        status = derivePsu(rc);
        // Conversion losses (≈6 %) of this PSU's share of the load become heat.
        const psus = Object.values(eq.slots).filter((id) => id && s.components[id]?.delivering).length;
        const share = comp.delivering && psus > 0 ? eq.powerDemandW / psus : 0;
        powerW = comp.inputLive ? model.idleW + share * 0.06 : 0;
        break;
      }
      case 'fan':
        status = deriveFan(rc);
        powerW = hostOn && status === 'ok' ? model.idleW + (comp.dutyPct ?? 30) / 100 * (model.maxW - model.idleW) : 0;
        break;
      case 'pump':
        if (ctx.faults.has(comp.id, 'pump_failure')) {
          conditions.push(cond('PUMP_FAILED', 'warning', `${slot.label}: pump failure`, ['bmc', 'led'], true));
          status = 'failed';
          powerW = 0;
        } else {
          status = hostOn ? 'ok' : 'stopped';
          powerW = hostOn ? model.maxW * 0.6 : 0;
        }
        break;
      case 'nic':
      case 'dpu':
        if (ctx.faults.has(comp.id, 'nic_failure')) {
          conditions.push(cond('NIC_FAILED', 'critical', `${slot.label}: adapter failure`, ['bmc', 'os', 'led'], true));
          status = 'failed';
        } else if (hostOn && !depOk) {
          conditions.push(cond('NIC_NOT_ENUMERATED', 'critical', `${slot.label}: not enumerated (riser missing or failed)`, ['os'], true));
          status = 'not_detected';
        }
        break;
      case 'bmc':
        if (ctx.faults.has(comp.id, 'bmc_failure')) {
          conditions.push(cond('BMC_UNRESPONSIVE', 'warning', 'BMC heartbeat lost: management controller not responding', ['led', 'os']));
          status = 'failed';
        } else status = standby ? 'ok' : 'not_powered';
        break;
      case 'nvswitch':
        if (ctx.faults.has(eq.id, 'nvswitch_failure')) {
          conditions.push(cond('NVSWITCH_FAILED', 'critical', `${slot.label}: NVLink switch not operational`, ['bmc', 'dcgm'], true));
          status = 'failed';
        }
        break;
      default:
        break;
    }

    // Over-temperature (uses the current, integrated temperature).
    if (powered) {
      const lim = model.thermal;
      const ch: Condition['channels'] = comp.category === 'gpu' ? ['bmc', 'driver', 'dcgm'] : ['bmc', 'os'];
      // Messages stay constant while a condition persists; live readings live in telemetry.
      if (comp.temperatureC >= lim.criticalC) conditions.push(cond('TEMP_CRITICAL', 'critical', `${slot.label}: temperature above critical limit (${lim.criticalC} °C)`, ch, true));
      else if (comp.temperatureC >= lim.warnC) conditions.push(cond('TEMP_WARNING', 'warning', `${slot.label}: temperature above warning threshold (${lim.warnC} °C)`, ch));
    }

    set(comp, 'powered', powered);
    set(comp, 'status', status);
    set(comp, 'powerW', Math.round(powerW * 10) / 10);
    set(comp, 'conditions', conditions);
  }
}
