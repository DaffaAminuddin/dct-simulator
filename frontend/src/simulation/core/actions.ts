/**
 * Action handlers. Each validates its intent (throwing SimError on hard
 * errors), mutates BASE fields of the draft state, and returns warnings.
 * Derived fields are recomputed afterwards by the derivation pipeline.
 */
import { getCableModel } from '@/data/cables/cableCatalog';
import { FAULT_DEFINITIONS } from '@/data/faults/faultCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { clearFault, describeTarget, injectFault } from '@/simulation/diagnostics/FaultInjector';
import type { EventDraft } from '@/simulation/diagnostics/HealthMonitor';
import { installComponent, removeComponent } from '@/simulation/hardware/Compatibility';
import { mountEquipment, unmountEquipment } from '@/simulation/hardware/Rack';
import { checkFit, CONNECTOR_LABEL, requiredLengthM } from '@/simulation/networking/Cable';
import { assertAdminControllable } from '@/simulation/networking/Switch';
import { describeVlan, isSwitchingPort } from '@/simulation/networking/Vlan';
import { configureWorkstation, moveCart } from '@/simulation/workstation/Workstation';
import { estimateIdleDemand } from '@/simulation/power/PowerState';
import type { Equipment, Id, SimAction, SimulationState } from '@/types/simulation';
import { isHost, isMainPowerOn, OS_STATES } from './SimulationState';
import { clamp, fail } from './util';

export interface HandlerResult {
  warnings: string[];
  events: EventDraft[];
}

function hostOrFail(s: SimulationState, id: Id): Equipment {
  const eq = s.equipment[id];
  if (!eq) fail('UNKNOWN_EQUIPMENT', `Unknown equipment ${id}`);
  if (!isHost(eq)) fail('NOT_A_HOST', `${eq.hostname} has no power control`);
  return eq;
}

/** Runtime OS state that a reboot resets: the GPU driver loads again and interfaces come back up. */
function resetOsRuntime(s: SimulationState, eq: Equipment): void {
  eq.software.gpuDriverLoaded = getEquipmentModel(eq.modelId).slots.some((sl) => sl.category === 'gpu');
  for (const pid of eq.portIds) {
    const p = s.ports[pid];
    if (p && p.componentId && (p.role === 'data' || p.role === 'fabric') && !p.adminUp) p.adminUp = true;
  }
}

function osHostOrFail(s: SimulationState, id: Id): Equipment {
  const eq = hostOrFail(s, id);
  if (!OS_STATES.has(eq.state)) fail('OS_NOT_RUNNING', `${eq.hostname}: operating system is not running`);
  return eq;
}

function procedure(message: string, equipmentId?: Id, severity: EventDraft['severity'] = 'info'): EventDraft {
  return { severity, category: 'procedure', message, equipmentId, channels: ['bmc', 'led'] };
}

export function handleAction(s: SimulationState, action: SimAction): HandlerResult {
  const warnings: string[] = [];
  const events: EventDraft[] = [];

  switch (action.type) {
    case 'equipment/power': {
      const eq = hostOrFail(s, action.equipmentId);
      if (action.power === 'on') {
        if (eq.location.kind === 'inventory') fail('NOT_INSTALLED', `${eq.hostname} is not installed in a rack`);
        if (eq.powerCapacityW <= 0) fail('NO_POWER', `${eq.hostname} has no input power: check PSU cords, PDU outlets and feeds`);
        if (eq.powerCapacityW < estimateIdleDemand(s, eq)) fail('INSUFFICIENT_POWER', `Delivering PSU capacity (${eq.powerCapacityW} W) is too low to power on ${eq.hostname}`);
        if (eq.desiredPower !== 'on') {
          eq.desiredPower = 'on';
          eq.bootElapsedMs = 0;
          resetOsRuntime(s, eq);
        }
        eq.thermalTrip = false;
        events.push(procedure(`${eq.hostname}: power on requested`, eq.id));
      } else {
        eq.desiredPower = 'off';
        events.push(procedure(`${eq.hostname}: power off requested`, eq.id));
      }
      break;
    }
    case 'equipment/powerCycle': {
      const eq = hostOrFail(s, action.equipmentId);
      if (eq.powerCapacityW <= 0) fail('NO_POWER', `${eq.hostname} has no input power`);
      eq.desiredPower = 'on';
      eq.bootElapsedMs = 0;
      eq.thermalTrip = false;
      resetOsRuntime(s, eq);
      events.push(procedure(`${eq.hostname}: power cycle (warm reset)`, eq.id));
      break;
    }
    case 'equipment/mount': {
      warnings.push(...mountEquipment(s, action.equipmentId, action.rackId, action.uStart));
      const eq = s.equipment[action.equipmentId];
      events.push(procedure(`${eq.hostname} mounted in ${action.rackId} at U${action.uStart}`, eq.id));
      break;
    }
    case 'equipment/unmount': {
      const eq = s.equipment[action.equipmentId];
      const from = eq?.location.kind === 'rack' ? eq.location.rackId : '';
      warnings.push(...unmountEquipment(s, action.equipmentId));
      events.push(procedure(`${eq.hostname} removed from ${from}`, eq.id));
      break;
    }
    case 'equipment/setChassisOpen': {
      const eq = hostOrFail(s, action.equipmentId);
      if (eq.chassisOpen === action.open) break;
      eq.chassisOpen = action.open;
      if (action.open && isMainPowerOn(eq)) warnings.push('Chassis opened while running: airflow is reduced and an intrusion event is logged');
      events.push(procedure(`${eq.hostname}: chassis ${action.open ? 'opened' : 'closed'}`, eq.id));
      break;
    }
    case 'equipment/setUid': {
      const eq = s.equipment[action.equipmentId];
      if (!eq) fail('UNKNOWN_EQUIPMENT', `Unknown equipment ${action.equipmentId}`);
      eq.uidLed = action.on;
      break;
    }
    case 'equipment/setWorkload': {
      const eq = hostOrFail(s, action.equipmentId);
      eq.workload = action.workload;
      break;
    }
    case 'component/remove': {
      const comp = s.components[action.componentId];
      const eqId = comp?.location.kind === 'equipment' ? comp.location.equipmentId : undefined;
      const slot = comp?.location.kind === 'equipment' ? comp.location.slotId : '';
      warnings.push(...removeComponent(s, action.componentId));
      if (eqId) {
        events.push(procedure(`${s.equipment[eqId].hostname}: removed ${slot} (S/N ${comp.serial})`, eqId));
        for (const w of warnings) if (w.startsWith('Unsafe')) events.push(procedure(`${s.equipment[eqId].hostname}: ${w}`, eqId, 'warning'));
      }
      break;
    }
    case 'component/install': {
      warnings.push(...installComponent(s, action.componentId, action.equipmentId, action.slotId));
      const eq = s.equipment[action.equipmentId];
      events.push(procedure(`${eq.hostname}: installed ${action.slotId} (S/N ${s.components[action.componentId].serial})`, eq.id));
      for (const w of warnings) if (w.startsWith('Unsafe')) events.push(procedure(`${eq.hostname}: ${w}`, eq.id, 'warning'));
      break;
    }
    case 'cable/connect': {
      const cable = s.cables[action.cableId];
      if (!cable) fail('UNKNOWN_CABLE', `Unknown cable ${action.cableId}`);
      const port = s.ports[action.portId];
      if (!port) fail('UNKNOWN_PORT', `Unknown port ${action.portId}`);
      if (cable.ends[action.end].portId) fail('END_IN_USE', `That end of ${cable.label} is already plugged in`);
      if (port.cableId) fail('PORT_OCCUPIED', `${port.label} already has a cable`);
      const model = getCableModel(cable.modelId);
      const plug = model.ends[action.end];
      const fit = checkFit(port, plug);
      if (!fit.ok) fail('CONNECTOR_MISMATCH', fit.reason ?? `${CONNECTOR_LABEL[plug]} does not fit`);
      const otherId = cable.ends[action.end === 0 ? 1 : 0].portId;
      if (otherId === port.id) fail('SAME_PORT', 'Both ends cannot go into the same port');
      if (otherId) {
        const need = requiredLengthM(s, s.ports[otherId], port);
        if (need > model.lengthM) fail('CABLE_TOO_SHORT', `${model.shortName} is ${model.lengthM} m; this run needs about ${need.toFixed(1)} m`);
      }
      cable.ends[action.end].portId = port.id;
      port.cableId = cable.id;
      port.cableEnd = action.end;
      events.push(procedure(`${cable.label} plugged into ${s.equipment[port.equipmentId].hostname} ${port.label}`, port.equipmentId));
      break;
    }
    case 'cable/disconnect': {
      const cable = s.cables[action.cableId];
      if (!cable) fail('UNKNOWN_CABLE', `Unknown cable ${action.cableId}`);
      const portId = cable.ends[action.end].portId;
      if (!portId) fail('END_FREE', 'That end is not plugged in');
      const port = s.ports[portId];
      cable.ends[action.end].portId = null;
      port.cableId = null;
      port.cableEnd = null;
      events.push(procedure(`${cable.label} unplugged from ${s.equipment[port.equipmentId].hostname} ${port.label}`, port.equipmentId));
      break;
    }
    case 'port/setAdmin': {
      const port = s.ports[action.portId];
      if (!port) fail('UNKNOWN_PORT', `Unknown port ${action.portId}`);
      assertAdminControllable(s, port);
      port.adminUp = action.up;
      events.push(procedure(`${s.equipment[port.equipmentId].hostname} ${port.label}: admin ${action.up ? 'up' : 'down'}`, port.equipmentId));
      break;
    }
    case 'fault/inject': {
      const f = injectFault(s, action);
      events.push({
        severity: 'warning',
        category: 'fault',
        devOnly: true,
        message: `Fault injected: ${FAULT_DEFINITIONS[f.type].name} on ${describeTarget(s, f.targetId)}`,
        channels: [],
      });
      break;
    }
    case 'fault/clear': {
      const f = clearFault(s, action.faultId);
      events.push({ severity: 'info', category: 'fault', devOnly: true, message: `Fault cleared: ${FAULT_DEFINITIONS[f.type].name} on ${describeTarget(s, f.targetId)}`, channels: [] });
      break;
    }
    case 'port/setVlan': {
      const port = s.ports[action.portId];
      if (!port) fail('UNKNOWN_PORT', `Unknown port ${action.portId}`);
      if (!isSwitchingPort(s, port)) fail('NOT_A_SWITCH_PORT', 'VLANs are configured on Ethernet switch ports');
      const v = action.vlan;
      const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 4094;
      if (!ok(v.access) || !ok(v.native) || !v.allowed.every(ok)) fail('INVALID_VLAN', 'VLAN IDs must be between 1 and 4094');
      port.vlan = { mode: v.mode, access: v.access, native: v.native, allowed: [...new Set(v.allowed)].sort((a, b) => a - b) };
      events.push(procedure(`${s.equipment[port.equipmentId].hostname} ${port.label}: switchport ${describeVlan(port.vlan)}`, port.equipmentId));
      break;
    }
    case 'workstation/configure': {
      warnings.push(...configureWorkstation(s, action.net));
      const n = s.workstation.net;
      events.push(procedure(`tech-laptop eth0 configured: ${n.mode === 'dhcp' ? 'DHCP' : `static ${n.address}/${n.prefix} gw ${n.gateway || 'none'}`}${n.vlan ? `, VLAN tag ${n.vlan}` : ''}${n.adminUp ? '' : ', interface down'}`));
      break;
    }
    case 'workstation/move': {
      moveCart(s, action.rackId, action.side);
      events.push(procedure(`Crash cart moved to ${action.rackId} (${action.side === 'front' ? 'cold aisle' : 'hot aisle'})`));
      break;
    }
    case 'host/setGpuDriver': {
      const eq = osHostOrFail(s, action.equipmentId);
      if (!getEquipmentModel(eq.modelId).slots.some((sl) => sl.category === 'gpu')) fail('NO_GPU', `${eq.hostname} has no NVIDIA GPUs`);
      if (eq.software.gpuDriverLoaded === action.loaded) break;
      eq.software.gpuDriverLoaded = action.loaded;
      events.push({ severity: action.loaded ? 'info' : 'warning', category: 'gpu', message: `${eq.hostname}: NVIDIA kernel driver ${action.loaded ? 'loaded' : 'unloaded'} (modprobe)`, equipmentId: eq.id, channels: ['os'] });
      break;
    }
    case 'host/setLinkAdmin': {
      const port = s.ports[action.portId];
      if (!port) fail('UNKNOWN_PORT', `Unknown port ${action.portId}`);
      const eq = osHostOrFail(s, port.equipmentId);
      if (!port.componentId || (port.role !== 'data' && port.role !== 'fabric')) fail('NOT_AN_OS_INTERFACE', `${port.label} is not an operating-system network interface`);
      const comp = s.components[port.componentId];
      if (!comp || comp.status === 'failed' || comp.status === 'not_detected') fail('NO_SUCH_DEVICE', `${port.osName ?? port.label}: device not present`);
      if (port.adminUp === action.up) break;
      port.adminUp = action.up;
      events.push({ severity: 'info', category: 'network', message: `${eq.hostname}: ${port.osName ?? port.label} set ${action.up ? 'up' : 'down'} (ip link)`, equipmentId: eq.id, channels: ['os'] });
      break;
    }
    case 'facility/setCrahSupply': {
      s.facility.crahSupplyC = clamp(action.tempC, 15, 35);
      events.push(procedure(`CRAH supply setpoint set to ${s.facility.crahSupplyC} °C`));
      break;
    }
    default: {
      const never: never = action;
      fail('UNKNOWN_ACTION', `Unknown action ${(never as { type: string }).type}`);
    }
  }
  return { warnings, events };
}

/** Short model name for an equipment (used by UI and messages). */
export function shortModel(eq: Equipment): string {
  return getEquipmentModel(eq.modelId).shortName;
}
