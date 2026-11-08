/**
 * Layer-2 model (SIMULATION_SPEC §6a): 802.1Q access/trunk ports and VLAN
 * broadcast domains ("segments") flooded across inter-switch links.
 */
import { OS_STATES, peerPort } from '@/simulation/core/SimulationState';
import type { Id, Port, SimulationState, VlanConfig } from '@/types/simulation';

export const DEFAULT_VLAN: VlanConfig = { mode: 'access', access: 1, allowed: [], native: 1 };

/** Ethernet switching port (not the switch's own OOB port, console or InfiniBand). */
export function isSwitchingPort(s: SimulationState, port: Port): boolean {
  const eq = s.equipment[port.equipmentId];
  return eq?.kind === 'switch' && (port.role === 'mgmt' || port.role === 'data' || port.role === 'uplink') && port.type !== 'osfp';
}

export function vlanOf(port: Port): VlanConfig {
  return port.vlan ?? DEFAULT_VLAN;
}

export function carriesVlan(cfg: VlanConfig, vlan: number): boolean {
  return cfg.mode === 'access' ? cfg.access === vlan : cfg.native === vlan || cfg.allowed.includes(vlan);
}

/** VLAN a frame from an endpoint lands in at a switch edge port; null = dropped. */
export function ingressVlan(cfg: VlanConfig, tag: number | null | undefined): number | null {
  const untagged = tag === null || tag === undefined;
  if (cfg.mode === 'access') return untagged ? cfg.access : null;
  if (untagged) return cfg.native;
  return cfg.allowed.includes(tag) ? tag : null;
}

export function describeVlan(cfg: VlanConfig | undefined): string {
  if (!cfg) return '—';
  return cfg.mode === 'access' ? `access ${cfg.access}` : `trunk ${cfg.allowed.join(',') || 'none'} (native ${cfg.native})`;
}

export interface Segment {
  vlan: number;
  switches: Set<Id>;
  /** Endpoint ports attached to an edge port in this VLAN (untagged or tagged as the edge port expects). */
  endpointPortIds: Set<Id>;
}

export type SegmentCache = Map<string, Segment>;

/** Flood VLAN `vlan` from `switchId` across running switches and up inter-switch links. */
export function segmentFrom(s: SimulationState, switchId: Id, vlan: number, cache?: SegmentCache): Segment {
  const key = `${switchId}|${vlan}`;
  const hit = cache?.get(key);
  if (hit) return hit;
  const seg: Segment = { vlan, switches: new Set(), endpointPortIds: new Set() };
  const start = s.equipment[switchId];
  if (!start || start.kind !== 'switch' || !OS_STATES.has(start.state)) return seg;
  const queue: Id[] = [switchId];
  seg.switches.add(switchId);
  while (queue.length) {
    const sw = s.equipment[queue.shift() as Id];
    for (const pid of sw.portIds) {
      const p = s.ports[pid];
      if (!p || !isSwitchingPort(s, p) || p.state !== 'link_up') continue;
      const cfg = vlanOf(p);
      const peer = peerPort(s, p);
      if (!peer) continue;
      if (isSwitchingPort(s, peer)) {
        if (carriesVlan(cfg, vlan) && carriesVlan(vlanOf(peer), vlan) && !seg.switches.has(peer.equipmentId)) {
          seg.switches.add(peer.equipmentId);
          queue.push(peer.equipmentId);
        }
      } else if (ingressVlan(cfg, peer.ip?.vlan) === vlan) {
        seg.endpointPortIds.add(peer.id);
      }
    }
  }
  if (cache) for (const id of seg.switches) cache.set(`${id}|${vlan}`, seg);
  return seg;
}

export type Attachment = { kind: 'switch'; switchId: Id; switchPortId: Id; vlan: number } | { kind: 'p2p'; peerPortId: Id };

/** Where an endpoint port attaches to the network, given the 802.1Q tag it sends. */
export function attachmentOf(s: SimulationState, port: Port, tag: number | null | undefined): Attachment | null {
  if (port.state !== 'link_up') return null;
  const peer = peerPort(s, port);
  if (!peer) return null;
  if (isSwitchingPort(s, peer)) {
    const vlan = ingressVlan(vlanOf(peer), tag);
    return vlan === null ? null : { kind: 'switch', switchId: peer.equipmentId, switchPortId: peer.id, vlan };
  }
  return { kind: 'p2p', peerPortId: peer.id };
}

const caches = new WeakMap<object, SegmentCache>();

/** Segment cache bound to an immutable snapshot (never use with the engine's working copy). */
export function snapshotCache(s: SimulationState): SegmentCache {
  let c = caches.get(s);
  if (!c) {
    c = new Map();
    caches.set(s, c);
  }
  return c;
}
