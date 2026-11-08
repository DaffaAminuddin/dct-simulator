/**
 * GPU model (SIMULATION_SPEC §5): lifecycle, XID, HBM ECC, host link,
 * NVLink, thermal and power-brake throttling, utilization and power.
 */
import { XID_INFO } from '@/data/faults/faultCatalog';
import { OS_STATES } from '@/simulation/core/SimulationState';
import { round1, set } from '@/simulation/core/util';
import { GPU_UTILIZATION } from '@/simulation/power/PowerState';
import type { GpuLifecycle, GpuTelemetry } from '@/types/simulation';
import { cond, type RuleContext } from './rules';

export const NVLINKS_PER_SWITCH_TRAY = 2;
export const THERMAL_SLOWDOWN_BAND_C = 3;

export function gpuIndexFromSlot(slotId: string): number {
  const m = /gpu(\d+)/.exec(slotId);
  return m ? Number(m[1]) : 0;
}

export function busIdFor(index: number): string {
  return `00000000:${(0x18 + index * 0x10).toString(16).toUpperCase().padStart(2, '0')}:00.0`;
}

export function deriveGpu(rc: RuleContext): void {
  const { ctx, comp, eq, model, hostOn, depOk, conditions } = rc;
  const faults = ctx.faults.get(comp.id);
  const osUp = OS_STATES.has(eq.state);
  const fallen = faults.some((f) => f.type === 'gpu_fallen_off_bus');
  const enumerated = hostOn && depOk && !fallen;
  const index = gpuIndexFromSlot(rc.slot.id);

  let lifecycle: GpuLifecycle;
  if (!hostOn) lifecycle = 'not_powered';
  else if (!enumerated) lifecycle = 'installed';
  else if (!osUp || !eq.software.gpuDriverLoaded) lifecycle = 'detected';
  else lifecycle = 'initialized';

  const xids: number[] = [];
  let eccUncorrectable = 0;
  let eccCorrectable = 0;
  let linksDown = 0;
  for (const f of faults) {
    if (f.type === 'gpu_fallen_off_bus') xids.push(79);
    if (f.type === 'gpu_xid') xids.push(Number(f.params.xid ?? 79));
    if (f.type === 'hbm_ecc_uncorrectable') {
      xids.push(48);
      eccUncorrectable += Number(f.params.count ?? 4);
    }
    if (f.type === 'nvlink_down') {
      xids.push(74);
      linksDown += Number(f.params.links ?? 2);
    }
  }
  for (const x of xids) if (x === 92) eccCorrectable += 1200;
  const fatal = xids.some((x) => XID_INFO[x]?.fatal) || eccUncorrectable > 0;

  const nvlinkTotal = Number(model.specs.nvlinks ?? 18);
  const baseLinks = eq.kind === 'compute_tray' ? Math.min(nvlinkTotal, rc.healthySwitchTrays * NVLINKS_PER_SWITCH_TRAY) : nvlinkTotal;
  const nvlinkActive = lifecycle === 'initialized' && !fatal ? Math.max(0, baseLinks - linksDown) : 0;

  // Proportional thermal slowdown: clocks ramp down from 3 °C below the throttle
  // point so the GPU settles at an equilibrium instead of oscillating.
  const throttleC = model.thermal.throttleC ?? model.thermal.criticalC;
  const slowdownStartC = throttleC - THERMAL_SLOWDOWN_BAND_C;
  const thermalFactor =
    lifecycle === 'initialized' && comp.temperatureC >= slowdownStartC
      ? Math.max(0.5, Math.round((1 - (comp.temperatureC - slowdownStartC) * 0.08) * 100) / 100)
      : 1;
  const thermalThrottle = thermalFactor < 1;
  const powerBrake = lifecycle === 'initialized' && eq.powerBrake;
  const throttleReasons: string[] = [];
  if (thermalThrottle) throttleReasons.push('HW Thermal Slowdown');
  if (powerBrake) throttleReasons.push('HW Power Brake Slowdown');

  const util = lifecycle === 'initialized' && !fatal ? GPU_UTILIZATION[eq.workload] : 0;
  const clockFactor = thermalFactor * (powerBrake ? 0.7 : 1);
  const maxClock = Number(model.specs.maxClockMHz ?? 1980);
  const smClock = lifecycle === 'initialized' ? Math.round(util > 0 ? maxClock * clockFactor : maxClock * 0.17) : 0;
  const powerLimit = Math.round(model.maxW * (powerBrake ? 0.7 : 1));
  let powerW = 0;
  if (hostOn) {
    if (!enumerated) powerW = model.idleW * 0.5;
    else powerW = Math.min(powerLimit, model.idleW + (util / 100) * (model.maxW - model.idleW) * clockFactor);
  }
  const memTotal = Number(model.specs.memoryGB ?? 0);
  const memFrac = eq.workload === 'training' ? 0.93 : eq.workload === 'light' ? 0.42 : 0.004;
  const memUsed = lifecycle === 'initialized' && !fatal ? round1(memTotal * memFrac) : 0;

  // --- conditions -----------------------------------------------------------
  if (fallen && hostOn) conditions.push(cond('GPU_FALLEN_OFF_BUS', 'critical', `GPU ${index} has fallen off the bus (Xid 79)`, ['os', 'driver'], true));
  if (!depOk && hostOn) conditions.push(cond('GPU_NOT_ENUMERATED', 'critical', `GPU ${index} not enumerated: upstream device missing or failed`, ['os', 'driver'], true));
  for (const x of xids) {
    if (x === 79 || x === 48 || x === 74) continue;
    const info = XID_INFO[x];
    conditions.push(cond(`GPU_XID_${x}`, info?.fatal ? 'critical' : 'warning', `GPU ${index} Xid ${x}: ${info?.name ?? 'unknown error'}`, ['os', 'driver', 'dcgm'], !!info?.fatal));
  }
  if (eccUncorrectable > 0 && hostOn)
    conditions.push(cond('GPU_HBM_UNCORRECTABLE', 'critical', `GPU ${index}: ${eccUncorrectable} uncorrectable HBM ECC errors (Xid 48)`, ['os', 'driver', 'dcgm'], true));
  if (lifecycle === 'initialized' && !fatal && nvlinkActive < nvlinkTotal)
    conditions.push(cond('GPU_NVLINK_DOWN', 'warning', `GPU ${index}: ${nvlinkTotal - nvlinkActive} of ${nvlinkTotal} NVLink links inactive`, ['driver', 'dcgm'], true));
  if (thermalThrottle) conditions.push(cond('GPU_THERMAL_THROTTLE', 'warning', `GPU ${index} thermal slowdown active (clocks reduced)`, ['driver', 'dcgm', 'bmc'], true));
  if (powerBrake) conditions.push(cond('GPU_POWER_BRAKE', 'warning', `GPU ${index} power brake: clocks capped by insufficient supply`, ['driver', 'dcgm'], true));
  if (osUp && enumerated && !eq.software.gpuDriverLoaded)
    conditions.push(cond('GPU_DRIVER_NOT_LOADED', 'warning', 'NVIDIA kernel driver not loaded', ['os'], true));

  set(comp, 'status', !hostOn ? 'not_powered' : !enumerated ? 'not_detected' : fatal ? 'failed' : 'ok');
  set(comp, 'powerW', Math.round(powerW));

  const telemetry: GpuTelemetry = {
    index,
    lifecycle,
    busId: busIdFor(index),
    utilizationPct: util,
    memTotalGB: memTotal,
    memUsedGB: memUsed,
    powerW: Math.round(powerW),
    powerLimitW: powerLimit,
    smClockMHz: smClock,
    maxClockMHz: maxClock,
    eccCorrectable,
    eccUncorrectable,
    xids,
    pcieGen: enumerated ? 5 : 0,
    pcieWidth: enumerated ? 16 : 0,
    pcieMaxWidth: 16,
    nvlinkTotal,
    nvlinkActive,
    throttleReasons,
  };
  if (!comp.gpu) comp.gpu = telemetry;
  else for (const k of Object.keys(telemetry) as (keyof GpuTelemetry)[]) set(comp.gpu, k, telemetry[k]);
}
