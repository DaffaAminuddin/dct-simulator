/**
 * Link derivation (SIMULATION_SPEC §6): physical link state per port and
 * cable state, from cabling, power, admin state, faults and media compatibility.
 */
import { getCableModel } from '@/data/cables/cableCatalog';
import { type DeriveContext, isMainPowerOn, OS_STATES, peerPort } from '@/simulation/core/SimulationState';
import { set } from '@/simulation/core/util';
import type { Port, PortState, SimulationState } from '@/types/simulation';
import { evaluateLink } from './Cable';

const PASSIVE_ROLES = new Set(['power_in', 'power_out', 'usb', 'console', 'video']);

/** Is the PHY behind this port powered and enumerated? */
export function portEnergised(s: SimulationState, port: Port): { ok: boolean; reason?: string } {
  const eq = s.equipment[port.equipmentId];
  if (eq.kind === 'switch') return OS_STATES.has(eq.state) ? { ok: true } : { ok: false, reason: 'switch not running' };
  if (port.role === 'bmc') return eq.bmcAlive ? { ok: true } : { ok: false, reason: 'BMC not running' };
  if (!isMainPowerOn(eq)) return { ok: false, reason: 'host powered off' };
  if (port.componentId) {
    const c = s.components[port.componentId];
    if (c && (c.status === 'not_detected' || c.status === 'failed')) return { ok: false, reason: 'adapter not operational' };
  }
  return { ok: true };
}

export function derivePorts(s: SimulationState, ctx: DeriveContext): void {
  for (const port of Object.values(s.ports)) {
    const peer = peerPort(s, port);
    set(port, 'peerPortId', peer?.id ?? null);

    if (PASSIVE_ROLES.has(port.role)) {
      set(port, 'state', port.cableId ? 'connected' : 'disconnected');
      set(port, 'speedGbps', 0);
      set(port, 'reason', undefined);
      continue;
    }

    let state: PortState;
    let reason: string | undefined;
    let speed = 0;
    const faulty = ctx.faults.has(port.id, 'port_faulty') || (!!port.componentId && ctx.faults.has(port.componentId, 'nic_failure'));

    if (faulty) {
      state = 'faulty';
      reason = 'Port hardware fault';
    } else if (!port.adminUp) {
      state = 'disabled';
      reason = 'Administratively down';
    } else if (!port.cableId) {
      state = 'disconnected';
    } else if (!peer) {
      state = 'connected';
      reason = 'Far end of the cable is not plugged in';
    } else {
      const local = portEnergised(s, port);
      const remote = portEnergised(s, peer);
      const peerFaulty = ctx.faults.has(peer.id, 'port_faulty') || (!!peer.componentId && ctx.faults.has(peer.componentId, 'nic_failure'));
      state = 'link_down';
      if (ctx.faults.has(port.cableId, 'cable_damaged')) reason = 'No signal (cable fault)';
      else if (peerFaulty) reason = 'Remote port fault';
      else if (!peer.adminUp) reason = 'Remote port administratively down';
      else if (!local.ok) reason = `Local ${local.reason}`;
      else if (!remote.ok) reason = `Remote ${remote.reason}`;
      else {
        const link = evaluateLink(port, peer, getCableModel(s.cables[port.cableId].modelId));
        if (link.ok) {
          state = 'link_up';
          speed = link.speedGbps;
        } else reason = link.reason;
      }
    }
    set(port, 'state', state);
    set(port, 'reason', reason);
    set(port, 'speedGbps', speed);
  }
}

export function deriveCables(s: SimulationState, ctx: DeriveContext): void {
  for (const cable of Object.values(s.cables)) {
    const [a, b] = cable.ends.map((e) => (e.portId ? s.ports[e.portId] : undefined));
    if (ctx.faults.has(cable.id, 'cable_damaged')) {
      set(cable, 'state', 'damaged');
      set(cable, 'reason', 'Physical damage');
      continue;
    }
    if (a && b) {
      const link = evaluateLink(a, b, getCableModel(cable.modelId));
      set(cable, 'state', link.ok ? 'connected' : 'incompatible');
      set(cable, 'reason', link.ok ? undefined : link.reason);
    } else {
      set(cable, 'state', a || b ? 'connected' : 'available');
      set(cable, 'reason', a || b ? 'One end unplugged' : undefined);
    }
  }
}
