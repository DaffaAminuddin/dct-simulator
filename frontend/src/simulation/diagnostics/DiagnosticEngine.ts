/**
 * DiagnosticEngine: what a learner can observe through each channel
 * (SIMULATION_SPEC §1.2). Ground truth stays in `conditions`; this module
 * filters it by what an LED, the BMC, the OS, the driver or DCGM would show.
 */
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { installedComponents, isHost, isMainPowerOn, OS_STATES } from '@/simulation/core/SimulationState';
import { healthFromConditions, worstHealth } from '@/simulation/core/util';
import { bmcReachability } from '@/simulation/networking/NetworkTopology';
import type { Channel, Component, Condition, Equipment, Health, SimEvent, SimulationState } from '@/types/simulation';

export interface ChannelStatus {
  available: boolean;
  reason?: string;
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  led: 'Physical indicators',
  bmc: 'BMC / device management',
  os: 'Operating system',
  driver: 'NVIDIA driver (nvidia-smi)',
  dcgm: 'DCGM',
};

export function channelStatus(s: SimulationState, eq: Equipment, channel: Channel): ChannelStatus {
  switch (channel) {
    case 'led': {
      const powered = isHost(eq) ? eq.powerCapacityW > 0 : eq.powerStatus === 'available' || eq.powerStatus === 'degraded';
      return powered ? { available: true } : { available: false, reason: 'No power: indicators are dark' };
    }
    case 'bmc': {
      if (eq.kind === 'switch') return OS_STATES.has(eq.state) ? { available: true } : { available: false, reason: 'Switch management plane not running' };
      if (!isHost(eq)) {
        return eq.powerStatus === 'available' || eq.powerStatus === 'degraded' ? { available: true } : { available: false, reason: 'Controller has no power' };
      }
      const r = bmcReachability(s, eq.id);
      return r.reachable ? { available: true } : { available: false, reason: r.reason };
    }
    case 'os':
      return OS_STATES.has(eq.state) ? { available: true } : { available: false, reason: 'Operating system not running' };
    case 'driver':
      if (!OS_STATES.has(eq.state)) return { available: false, reason: 'Operating system not running' };
      return eq.software.gpuDriverLoaded ? { available: true } : { available: false, reason: 'NVIDIA driver not loaded' };
    case 'dcgm':
      if (!OS_STATES.has(eq.state)) return { available: false, reason: 'Operating system not running' };
      if (!eq.software.gpuDriverLoaded) return { available: false, reason: 'NVIDIA driver not loaded' };
      return eq.software.dcgmInstalled ? { available: true } : { available: false, reason: 'DCGM not installed' };
  }
}

export function conditionsVia(conditions: Condition[], channel: Channel): Condition[] {
  return conditions.filter((c) => c.channels.includes(channel));
}

export function componentHealthVia(s: SimulationState, comp: Component, channel: Channel): Health {
  if (comp.location.kind !== 'equipment') return 'unknown';
  const eq = s.equipment[comp.location.equipmentId];
  if (!channelStatus(s, eq, channel).available) return 'unknown';
  return healthFromConditions(conditionsVia(comp.conditions, channel));
}

export function equipmentHealthVia(s: SimulationState, eq: Equipment, channel: Channel): Health {
  if (!channelStatus(s, eq, channel).available) return 'unknown';
  const healths: Health[] = [healthFromConditions(conditionsVia(eq.conditions, channel))];
  for (const c of installedComponents(s, eq)) healths.push(healthFromConditions(conditionsVia(c.conditions, channel)));
  return worstHealth(healths);
}

/** Health shown in the UI: ground truth in developer mode, BMC view otherwise. */
export function displayedHealth(s: SimulationState, eq: Equipment, devMode: boolean): Health {
  if (eq.kind === 'blank') return 'ok';
  if (devMode) return eq.health;
  if (!isHost(eq)) return equipmentHealthVia(s, eq, 'bmc');
  const bmc = equipmentHealthVia(s, eq, 'bmc');
  if (bmc !== 'unknown') return bmc;
  // Without a BMC view the technician still sees the front-panel LEDs.
  return equipmentHealthVia(s, eq, 'led');
}

export type LedColor = 'off' | 'green' | 'amber' | 'blue' | 'blink-green' | 'blink-amber';

export interface FrontLeds {
  power: LedColor;
  health: LedColor;
  uid: LedColor;
}

/** Front-panel indicator state derived from the LED channel. */
export function frontLeds(s: SimulationState, eq: Equipment): FrontLeds {
  const led = channelStatus(s, eq, 'led');
  if (!led.available) return { power: 'off', health: 'off', uid: 'off' };
  let power: LedColor = 'blink-amber';
  if (isHost(eq)) {
    if (eq.state === 'standby') power = 'blink-amber';
    else if (eq.state === 'powered_on' || eq.state === 'booting') power = 'blink-green';
    else if (isMainPowerOn(eq)) power = 'green';
  } else power = 'green';
  const ledHealth = equipmentHealthVia(s, eq, 'led');
  const health: LedColor = ledHealth === 'critical' ? 'amber' : ledHealth === 'warning' ? 'blink-amber' : 'green';
  return { power, health, uid: eq.uidLed ? 'blue' : 'off' };
}

/** Categories with a status/activity LED on the part itself. */
const STATUS_LED_CATEGORIES = new Set(['psu', 'fan', 'nvme', 'ssd', 'pump', 'bmc', 'nic', 'dpu', 'raid']);
/** Categories with only a board-mounted fault LED (dark unless a fault is latched). */
const FAULT_LED_CATEGORIES = new Set(['dimm', 'cpu']);

export function hasPhysicalLed(category: string): boolean {
  return STATUS_LED_CATEGORIES.has(category) || FAULT_LED_CATEGORIES.has(category);
}

/** Status LED for an individual component with a physical indicator (PSU, fan, drive, DIMM fault LED). */
export function componentLed(s: SimulationState, comp: Component): LedColor {
  if (comp.location.kind !== 'equipment' || !hasPhysicalLed(comp.category)) return 'off';
  const eq = s.equipment[comp.location.equipmentId];
  if (!channelStatus(s, eq, 'led').available) return 'off';
  const visible = conditionsVia(comp.conditions, 'led');
  if (comp.category === 'psu') {
    if (visible.some((c) => c.code === 'PSU_FAILED')) return 'amber';
    if (visible.some((c) => c.code === 'PSU_NO_INPUT')) return 'blink-amber';
    return 'green';
  }
  if (visible.some((c) => c.severity === 'critical')) return 'amber';
  if (visible.length > 0) return 'blink-amber';
  if (FAULT_LED_CATEGORIES.has(comp.category)) return 'off';
  return comp.powered ? 'green' : 'off';
}

/** Events visible to a learner: everything in developer mode, otherwise monitoring channels only. */
export function visibleEvents(events: SimEvent[], devMode: boolean): SimEvent[] {
  if (devMode) return events;
  return events.filter((e) => !e.devOnly && (!e.channels || e.channels.includes('bmc') || e.channels.includes('led')));
}

export function hasGpus(eq: Equipment): boolean {
  return getEquipmentModel(eq.modelId).slots.some((sl) => sl.category === 'gpu');
}

export interface MonitoringAlert {
  key: string;
  severity: 'warning' | 'critical';
  equipmentId: string;
  hostname: string;
  rackId?: string;
  message: string;
  componentId?: string;
}

/**
 * Alerts a NOC monitoring system would show: everything the BMC / device
 * management channel reports, plus "lost contact" when that channel is down.
 * Developer mode shows ground truth instead.
 */
export function monitoringAlerts(s: SimulationState, devMode: boolean): MonitoringAlert[] {
  const out: MonitoringAlert[] = [];
  for (const eq of Object.values(s.equipment)) {
    if (eq.location.kind === 'inventory' || eq.kind === 'blank') continue;
    const rackId = eq.location.kind === 'rack' ? eq.location.rackId : undefined;
    const push = (c: Condition, componentId?: string) => {
      if (c.severity === 'info') return;
      out.push({ key: `${eq.id}|${componentId ?? ''}|${c.code}|${c.message}`, severity: c.severity, equipmentId: eq.id, hostname: eq.hostname, rackId, message: c.message, componentId });
    };
    const ch = channelStatus(s, eq, 'bmc');
    if (devMode) {
      eq.conditions.forEach((c) => push(c));
      for (const comp of installedComponents(s, eq)) comp.conditions.forEach((c) => push(c, comp.id));
      continue;
    }
    if (!ch.available) {
      if (isHost(eq) || eq.kind === 'pdu' || eq.kind === 'cdu' || eq.kind === 'power_shelf') {
        const critical = eq.powerCapacityW <= 0 && eq.desiredPower === 'on';
        out.push({
          key: `${eq.id}|unreachable`,
          severity: critical ? 'critical' : 'warning',
          equipmentId: eq.id,
          hostname: eq.hostname,
          rackId,
          message: `${eq.kind === 'switch' ? 'Management plane' : 'Management controller'} unreachable: ${ch.reason}`,
        });
      }
      continue;
    }
    conditionsVia(eq.conditions, 'bmc').forEach((c) => push(c));
    for (const comp of installedComponents(s, eq)) conditionsVia(comp.conditions, 'bmc').forEach((c) => push(c, comp.id));
  }
  const rank = { critical: 0, warning: 1 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.hostname.localeCompare(b.hostname));
}
