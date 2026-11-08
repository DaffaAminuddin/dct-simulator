/**
 * Power distribution rules (SIMULATION_SPEC §3):
 * facility feed → PDU → outlet → cord → PSU inlet → PSU output → equipment,
 * and for MGX racks: feed → power shelf PSUs → rack busbar → trays.
 */
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import {
  type DeriveContext,
  equipmentInRack,
  feedTargetId,
  isHost,
  isMounted,
  peerPort,
} from '@/simulation/core/SimulationState';
import { set } from '@/simulation/core/util';
import type { Component, Equipment, FeedId, Port, PowerStatus, SimulationState } from '@/types/simulation';
import { estimateIdleDemand, estimateRunningDemand, STANDBY_W } from './PowerState';

/** True if a power inlet port is fed by a live outlet through an undamaged cord. */
export function inletHasPower(s: SimulationState, ctx: DeriveContext, inlet: Port | undefined): boolean {
  if (!inlet || !inlet.cableId) return false;
  if (ctx.faults.has(inlet.cableId, 'cable_damaged')) return false;
  const source = peerPort(s, inlet);
  if (!source || source.role !== 'power_out') return false;
  if (ctx.faults.has(source.id, 'port_faulty')) return false;
  return source.live === true;
}

export function psuInletPort(s: SimulationState, psu: Component): Port | undefined {
  if (psu.location.kind !== 'equipment') return undefined;
  const eq = s.equipment[psu.location.equipmentId];
  for (const pid of eq.portIds) {
    const p = s.ports[pid];
    if (p && p.componentId === psu.id && p.role === 'power_in') return p;
  }
  return undefined;
}

function psusOf(s: SimulationState, eq: Equipment): Component[] {
  const out: Component[] = [];
  const model = getEquipmentModel(eq.modelId);
  for (const slot of model.slots) {
    if (slot.category !== 'psu') continue;
    const cid = eq.slots[slot.id];
    if (cid) out.push(s.components[cid]);
  }
  return out;
}

export function derivePower(s: SimulationState, ctx: DeriveContext): void {
  // 1. Facility feeds
  for (const feed of Object.values(s.facility.feeds)) {
    set(feed, 'up', !ctx.faults.has(feedTargetId(feed.id), 'feed_loss'));
  }
  const feedUp = (f: FeedId | undefined) => !!f && s.facility.feeds[f].up;

  // 2. Feed-powered and passive equipment
  for (const eq of Object.values(s.equipment)) {
    const mounted = isMounted(eq);
    switch (eq.kind) {
      case 'pdu': {
        const input = mounted && feedUp(eq.feed);
        const powered = input && !ctx.faults.has(eq.id, 'pdu_failure');
        set(eq, 'state', 'passive');
        set(eq, 'powerStatus', powered ? 'available' : input ? 'failed' : 'disconnected');
        set(eq, 'powerCapacityW', powered ? (getEquipmentModel(eq.modelId).pdu?.ratingW ?? 0) : 0);
        for (const pid of eq.portIds) set(s.ports[pid], 'live', powered);
        break;
      }
      case 'power_shelf': {
        const input = mounted && feedUp(eq.feed);
        let cap = 0;
        let delivering = 0;
        let installed = 0;
        for (const psu of psusOf(s, eq)) {
          installed++;
          const ok = input && !ctx.faults.has(psu.id, 'psu_failure');
          set(psu, 'inputLive', input);
          set(psu, 'delivering', ok);
          if (ok) {
            delivering++;
            cap += getComponentModel(psu.modelId).ratingW ?? 0;
          }
        }
        set(eq, 'state', 'passive');
        set(eq, 'powerCapacityW', cap);
        set(eq, 'powerStatus', !input ? 'disconnected' : delivering === 0 ? 'failed' : delivering < installed ? 'degraded' : 'available');
        break;
      }
      case 'cdu': {
        // CDUs are dual-fed through an automatic transfer switch (simplified).
        const powered = mounted && (feedUp('A') || feedUp('B'));
        set(eq, 'state', 'passive');
        set(eq, 'powerStatus', powered ? 'available' : 'disconnected');
        set(eq, 'powerCapacityW', powered ? 1 : 0);
        break;
      }
      case 'blank':
        set(eq, 'state', 'passive');
        set(eq, 'powerStatus', 'not_applicable');
        set(eq, 'powerCapacityW', 0);
        break;
      default:
        break;
    }
  }

  // 3. Rack busbars (MGX racks)
  for (const rack of Object.values(s.racks)) {
    if (rack.type !== 'mgx') continue;
    const inRack = equipmentInRack(s, rack.id);
    let capacity = 0;
    let maxShelf = 0;
    let shelfDegraded = false;
    let demand = 0;
    for (const eq of inRack) {
      if (eq.kind === 'power_shelf') {
        capacity += eq.powerCapacityW;
        maxShelf = Math.max(maxShelf, eq.powerCapacityW);
        if (eq.powerStatus !== 'available') shelfDegraded = true;
      } else if (getEquipmentModel(eq.modelId).powerPath === 'busbar') {
        demand += eq.desiredPower === 'on' ? estimateRunningDemand(s, eq) : STANDBY_W;
      }
    }
    let status: PowerStatus;
    if (capacity <= 0) status = 'disconnected';
    else if (capacity < demand || shelfDegraded) status = 'degraded';
    else if (capacity - maxShelf >= demand) status = 'redundant';
    else status = 'available';
    if (!rack.busbar) rack.busbar = { capacityW: capacity, demandW: demand, status };
    else {
      set(rack.busbar, 'capacityW', capacity);
      set(rack.busbar, 'status', status);
    }
    ctx.power[`busbar:${rack.id}`] = { hasPower: capacity > 0, canRun: capacity > 0, brake: capacity < demand, runDemandW: demand, idleDemandW: 0 };
  }

  // 4. Hosts (servers, trays, switches)
  for (const eq of Object.values(s.equipment)) {
    if (!isHost(eq)) continue;
    const model = getEquipmentModel(eq.modelId);
    const runDemandW = estimateRunningDemand(s, eq);
    const idleDemandW = estimateIdleDemand(s, eq);
    let capacity = 0;
    let status: PowerStatus = 'disconnected';
    let brake = false;

    if (model.powerPath === 'psu') {
      const psus = psusOf(s, eq);
      let withInput = 0;
      let delivering = 0;
      let maxRating = 0;
      for (const psu of psus) {
        const rating = getComponentModel(psu.modelId).ratingW ?? 0;
        maxRating = Math.max(maxRating, rating);
        const input = isMounted(eq) && inletHasPower(s, ctx, psuInletPort(s, psu));
        const ok = input && !ctx.faults.has(psu.id, 'psu_failure');
        set(psu, 'inputLive', input);
        set(psu, 'delivering', ok);
        if (input) withInput++;
        if (ok) {
          delivering++;
          capacity += rating;
        }
      }
      if (psus.length === 0 || withInput === 0) status = 'disconnected';
      else if (delivering === 0 || capacity < idleDemandW) status = 'failed';
      else if (delivering < psus.length || capacity < runDemandW) status = 'degraded';
      else if (psus.length >= 2 && capacity - maxRating >= runDemandW) status = 'redundant';
      else status = 'available';
      brake = capacity > 0 && capacity < runDemandW;
    } else if (model.powerPath === 'busbar') {
      const loc = eq.location;
      const rack = loc.kind === 'rack' ? s.racks[loc.rackId] : undefined;
      if (rack?.type === 'mgx' && rack.busbar) {
        capacity = rack.busbar.capacityW;
        status = rack.busbar.status;
        brake = ctx.power[`busbar:${rack.id}`]?.brake ?? false;
      }
    }

    set(eq, 'powerCapacityW', capacity);
    // A host that cannot even reach idle power stays in standby.
    const hasPower = capacity > 0 && status !== 'disconnected';
    ctx.power[eq.id] = { hasPower, canRun: hasPower && capacity >= idleDemandW, brake, runDemandW, idleDemandW };
    set(eq, 'powerStatus', status);
  }
}

/**
 * Second power pass, after host states and component power are known:
 * actual draw per host, PDU loads, busbar demand, feed loads and rack totals.
 */
export function accountPower(s: SimulationState, ctx: DeriveContext): void {
  const pduLoad: Record<string, number> = {};

  for (const eq of Object.values(s.equipment)) {
    if (!isHost(eq)) continue;
    const model = getEquipmentModel(eq.modelId);
    const p = ctx.power[eq.id];
    let draw = 0;
    if (p?.hasPower) {
      if (eq.state === 'standby') draw = STANDBY_W;
      else {
        draw = model.baseW;
        for (const cid of Object.values(eq.slots)) if (cid) draw += s.components[cid].powerW;
      }
    }
    draw = Math.round(draw);
    set(eq, 'powerDemandW', draw);

    if (model.powerPath === 'psu' && draw > 0) {
      const delivering = psusOf(s, eq).filter((c) => c.delivering);
      for (const psu of delivering) {
        const inlet = psuInletPort(s, psu);
        const outlet = inlet ? peerPort(s, inlet) : undefined;
        if (outlet) pduLoad[outlet.equipmentId] = (pduLoad[outlet.equipmentId] ?? 0) + draw / delivering.length;
      }
    }
  }

  // Busbar demand and power-shelf share
  for (const rack of Object.values(s.racks)) {
    if (rack.type !== 'mgx' || !rack.busbar) continue;
    let demand = 0;
    const inRack = equipmentInRack(s, rack.id);
    for (const eq of inRack) if (getEquipmentModel(eq.modelId).powerPath === 'busbar') demand += eq.powerDemandW;
    set(rack.busbar, 'demandW', Math.round(demand));
    const cap = rack.busbar.capacityW;
    for (const eq of inRack) {
      if (eq.kind !== 'power_shelf') continue;
      const share = cap > 0 ? (demand * eq.powerCapacityW) / cap : 0;
      set(eq, 'powerDemandW', Math.round(share));
    }
  }

  const feedLoad: Record<FeedId, number> = { A: 0, B: 0 };
  for (const eq of Object.values(s.equipment)) {
    if (eq.kind === 'pdu') set(eq, 'powerDemandW', Math.round(pduLoad[eq.id] ?? 0));
    if (eq.kind === 'cdu') {
      let w = eq.powerStatus === 'available' ? getEquipmentModel(eq.modelId).baseW : 0;
      for (const cid of Object.values(eq.slots)) if (cid) w += s.components[cid].powerW;
      set(eq, 'powerDemandW', Math.round(w));
    }
    if ((eq.kind === 'pdu' || eq.kind === 'power_shelf') && eq.feed && isMounted(eq)) {
      feedLoad[eq.feed] += eq.powerDemandW;
    }
    if (eq.kind === 'cdu' && eq.feed && isMounted(eq)) {
      const other: FeedId = eq.feed === 'A' ? 'B' : 'A';
      feedLoad[s.facility.feeds[eq.feed].up ? eq.feed : other] += eq.powerDemandW;
    }
  }
  for (const feed of Object.values(s.facility.feeds)) set(feed, 'loadW', Math.round(feedLoad[feed.id]));

  for (const rack of Object.values(s.racks)) {
    let total = 0;
    for (const eq of equipmentInRack(s, rack.id)) if (isHost(eq)) total += eq.powerDemandW;
    set(rack, 'powerW', Math.round(total));
  }
}
