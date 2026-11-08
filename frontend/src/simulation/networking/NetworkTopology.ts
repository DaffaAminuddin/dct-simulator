/** Read-only topology queries over the simulation state. */
import { getCableModel } from '@/data/cables/cableCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { hasStandbyPower, peerPort, portsOf } from '@/simulation/core/SimulationState';
import type { CableState, Id, Port, PortState, SimulationState } from '@/types/simulation';
import { routedFromNoc } from './Reachability';
import { describeVlan, isSwitchingPort, snapshotCache } from './Vlan';

export interface Reachability {
  reachable: boolean;
  reason: string;
  via?: string;
}

/**
 * Phase 1 BMC reachability: BMC alive, management port link up, far-end
 * switch running. Phase 2 extends this with IP/VLAN/routing checks from the
 * technician laptop.
 */
export function bmcReachability(s: SimulationState, equipmentId: Id): Reachability {
  const eq = s.equipment[equipmentId];
  if (!eq) return { reachable: false, reason: 'Unknown equipment' };
  const model = getEquipmentModel(eq.modelId);
  const bmcSlot = model.slots.find((sl) => sl.category === 'bmc');
  if (!bmcSlot) return { reachable: false, reason: 'No BMC on this device' };
  if (!hasStandbyPower(eq)) return { reachable: false, reason: 'No standby power: every PSU / busbar input is dead' };
  if (!eq.slots[bmcSlot.id]) return { reachable: false, reason: 'DC-SCM / BMC module not installed' };
  if (!eq.bmcAlive) return { reachable: false, reason: 'BMC not responding' };
  const port = portsOf(s, eq).find((p) => p.role === 'bmc');
  if (!port) return { reachable: false, reason: 'No management port' };
  if (port.state !== 'link_up') {
    return { reachable: false, reason: `Management port ${port.state.replace('_', ' ')}${port.reason ? `: ${port.reason}` : ''}` };
  }
  const peer = peerPort(s, port);
  const sw = peer ? s.equipment[peer.equipmentId] : undefined;
  const routed = routedFromNoc(s, port, snapshotCache(s));
  if (!routed.ok) return { reachable: false, reason: routed.reason ?? 'No path from the management network' };
  return { reachable: true, reason: 'OK', via: sw && peer ? `${sw.hostname} ${peer.label}` : undefined };
}

export interface PatchRow {
  cableId: Id;
  label: string;
  model: string;
  aEquipment?: string;
  aPort?: string;
  aState?: PortState;
  bEquipment?: string;
  bPort?: string;
  bState?: PortState;
  state: CableState;
  reason?: string;
  media: string;
  /** VLAN config of the switch-side end, if any. */
  vlan?: string;
  /** IP of the endpoint end, if any. */
  ip?: string;
}

function endInfo(s: SimulationState, portId: Id | null) {
  if (!portId) return {};
  const p = s.ports[portId];
  const eq = s.equipment[p.equipmentId];
  return { eq: eq.hostname, port: p.label, state: p.state };
}

/** Patch schedule: one row per cable that has at least one end attached. */
export function patchSchedule(s: SimulationState): PatchRow[] {
  const rows: PatchRow[] = [];
  for (const c of Object.values(s.cables)) {
    if (!c.ends[0].portId && !c.ends[1].portId) continue;
    const a = endInfo(s, c.ends[0].portId);
    const b = endInfo(s, c.ends[1].portId);
    const m = getCableModel(c.modelId);
    const ends = c.ends.map((e) => (e.portId ? s.ports[e.portId] : undefined));
    const sw = ends.find((p) => p && isSwitchingPort(s, p));
    const ep = ends.find((p) => p?.ip);
    rows.push({
      cableId: c.id,
      vlan: sw ? describeVlan(sw.vlan) : undefined,
      ip: ep?.ip ? `${ep.ip.address}/${ep.ip.prefix}` : undefined,
      label: c.label,
      model: m.shortName,
      media: m.media,
      aEquipment: a.eq,
      aPort: a.port,
      aState: a.state,
      bEquipment: b.eq,
      bPort: b.port,
      bState: b.state,
      state: c.state,
      reason: c.reason,
    });
  }
  return rows;
}

export function peerLabel(s: SimulationState, port: Port): string | null {
  const peer = peerPort(s, port);
  if (!peer) return null;
  return `${s.equipment[peer.equipmentId].hostname} · ${peer.label}`;
}
