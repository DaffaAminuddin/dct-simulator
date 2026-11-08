/**
 * HealthMonitor: (1) final derivation step — equipment-level conditions,
 * os_running vs degraded, health roll-ups; (2) state diffing — turns
 * transitions into activity events and BMC SEL entries (SIMULATION_SPEC §9).
 */
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import {
  type DeriveContext,
  equipmentInRack,
  installedComponents,
  isHost,
  isMounted,
  OS_STATES,
} from '@/simulation/core/SimulationState';
import { healthFromConditions, set, worstHealth } from '@/simulation/core/util';
import { cond } from '@/simulation/hardware/rules';
import type {
  Channel,
  Condition,
  Equipment,
  EquipmentState,
  EventCategory,
  Health,
  SimEvent,
  SimulationState,
} from '@/types/simulation';

export const MAX_EVENTS = 500;
export const MAX_SEL = 200;

function equipmentConditions(s: SimulationState, ctx: DeriveContext, eq: Equipment): Condition[] {
  const model = getEquipmentModel(eq.modelId);
  const out: Condition[] = [];
  const loc = eq.location;
  const rack = loc.kind === 'rack' ? s.racks[loc.rackId] : undefined;

  if (isHost(eq)) {
    const p = ctx.power[eq.id];
    if (isMounted(eq) && !p?.hasPower && eq.desiredPower === 'on') out.push(cond('NO_POWER', 'critical', 'No input power: the device is dark', ['led']));
    if (model.powerPath === 'psu') {
      for (const sl of model.slots) {
        if (sl.category === 'psu' && !eq.slots[sl.id]) out.push(cond('PSU_SLOT_EMPTY', 'warning', `${sl.label} not installed: no power redundancy`, ['bmc', 'led'], true));
      }
      if (p?.hasPower && !p.canRun && eq.desiredPower === 'on')
        out.push(cond('INSUFFICIENT_POWER', 'critical', 'Delivering PSU capacity is below the minimum needed to power on', ['bmc']));
    }
    if (model.powerPath === 'busbar' && rack?.busbar?.status === 'degraded' && p?.hasPower)
      out.push(cond('BUSBAR_DEGRADED', 'warning', 'Rack busbar redundancy degraded', ['bmc'], true));
    if (p?.brake && OS_STATES.has(eq.state)) out.push(cond('POWER_CAPPED', 'warning', 'Power capping active: supply below workload demand', ['bmc'], true));
    for (const sl of model.slots) {
      if (sl.category === 'fan' && !eq.slots[sl.id]) out.push(cond('FAN_SLOT_EMPTY', 'warning', `${sl.label} missing`, ['bmc', 'led'], true));
    }
    if (eq.chassisOpen && eq.powerCapacityW > 0) out.push(cond('CHASSIS_INTRUSION', 'warning', 'Chassis intrusion: lid open', ['bmc']));
    if (eq.thermalTrip) out.push(cond('THERMAL_TRIP', 'critical', 'Host powered off by thermal protection', ['bmc', 'led']));
    if (eq.state === 'boot_failed') out.push(cond('POST_FAILED', 'critical', `POST failed: ${eq.postFailures[0] ?? 'unknown error'}`, ['bmc', 'led']));
    if (model.cooling === 'liquid' && rack?.coolant && eq.powerCapacityW > 0) {
      if (rack.coolant.leak) out.push(cond('LEAK_DETECTED', 'critical', `Leak sensor active in ${rack.id} manifold`, ['bmc', 'led']));
      if (rack.coolant.flowPct <= 0) out.push(cond('COOLANT_FLOW_LOST', 'critical', 'Coolant flow lost', ['bmc'], true));
    }
  } else if (eq.kind === 'pdu' && isMounted(eq)) {
    const rating = model.pdu?.ratingW ?? 0;
    if (eq.powerStatus === 'disconnected') out.push(cond('PDU_NO_INPUT', 'critical', `PDU input feed ${eq.feed} lost`, ['led', 'bmc']));
    else if (eq.powerStatus === 'failed') out.push(cond('PDU_FAILED', 'critical', 'PDU output failed / breaker tripped', ['led', 'bmc']));
    else if (rating > 0 && eq.powerDemandW > rating) out.push(cond('PDU_OVERLOAD', 'critical', `PDU load exceeds its ${rating / 1000} kW rating`, ['led', 'bmc']));
    else if (rating > 0 && eq.powerDemandW > rating * 0.8)
      out.push(cond('PDU_LOAD_HIGH', 'warning', `PDU load above 80 % of its ${rating / 1000} kW rating`, ['bmc']));
  } else if (eq.kind === 'power_shelf' && isMounted(eq)) {
    if (eq.powerStatus === 'disconnected') out.push(cond('SHELF_NO_INPUT', 'warning', `Power shelf input feed ${eq.feed} lost`, ['led', 'bmc']));
  } else if (eq.kind === 'cdu') {
    const pumps = installedComponents(s, eq);
    const working = pumps.filter((c) => c.status === 'ok').length;
    if (eq.powerStatus !== 'available') out.push(cond('CDU_NO_POWER', 'critical', 'CDU has no power', ['led']));
    else if (working === 0) out.push(cond('CDU_FLOW_LOST', 'critical', 'All CDU pumps stopped: no coolant flow', ['bmc', 'led']));
    else if (working < model.slots.length) out.push(cond('CDU_PUMP_REDUNDANCY', 'warning', 'CDU pump redundancy lost', ['bmc', 'led']));
    for (const rid of eq.servesRackIds ?? []) {
      if (s.racks[rid]?.coolant?.leak) out.push(cond('LEAK_DETECTED', 'critical', `Leak detected on ${rid} loop`, ['bmc', 'led']));
    }
  }
  return out;
}

export function finalizeHealth(s: SimulationState, ctx: DeriveContext): void {
  for (const comp of Object.values(s.components)) {
    set(comp, 'health', comp.location.kind === 'inventory' ? 'unknown' : healthFromConditions(comp.conditions));
  }

  for (const eq of Object.values(s.equipment)) {
    const conds = equipmentConditions(s, ctx, eq);
    set(eq, 'conditions', conds);
    const comps = installedComponents(s, eq);
    if (isHost(eq) && OS_STATES.has(eq.state)) {
      const degraded = conds.some((c) => c.degradesHost) || comps.some((c) => c.conditions.some((x) => x.degradesHost));
      set(eq, 'state', degraded ? 'degraded' : 'os_running');
    }
    const healths: Health[] = [healthFromConditions(conds)];
    for (const c of comps) healths.push(c.health);
    set(eq, 'health', eq.location.kind === 'inventory' ? 'unknown' : worstHealth(healths));
  }

  for (const rack of Object.values(s.racks)) {
    const healths: Health[] = equipmentInRack(s, rack.id).map((e) => e.health);
    if (rack.coolant) {
      healths.push(rack.coolant.status === 'normal' ? 'ok' : rack.coolant.status === 'warning' ? 'warning' : 'critical');
    }
    set(rack, 'health', worstHealth(healths));
  }
}

// ---------------------------------------------------------------------------
// Diffing → events
// ---------------------------------------------------------------------------

export type EventDraft = Omit<SimEvent, 'id' | 'timeMs'> & { channels: Channel[] };

export const STATE_LABEL: Record<EquipmentState, string> = {
  powered_off: 'powered off',
  standby: 'standby',
  powered_on: 'POST',
  booting: 'booting',
  boot_failed: 'boot failed',
  os_running: 'running',
  degraded: 'degraded',
  passive: 'passive',
};

export function categoryForCode(code: string): EventCategory {
  if (/^(PSU|POWER|PDU|BUSBAR|SHELF|NO_POWER|INSUFFICIENT)/.test(code)) return 'power';
  if (/^(FAN|TEMP|THERMAL)/.test(code)) return 'thermal';
  if (/^GPU|^NVSWITCH/.test(code)) return 'gpu';
  if (/^(LEAK|COOLANT|CDU|PUMP)/.test(code)) return 'cooling';
  if (/^(NIC|PORT|LINK)/.test(code)) return 'network';
  if (/^(POST|CHASSIS|BMC)/.test(code)) return 'system';
  return 'hardware';
}

function conditionDiff(prev: Condition[], next: Condition[]) {
  const prevCodes = new Map(prev.map((c) => [c.code + c.message, c]));
  const nextCodes = new Map(next.map((c) => [c.code + c.message, c]));
  const added = next.filter((c) => !prevCodes.has(c.code + c.message));
  const removed = prev.filter((c) => !nextCodes.has(c.code + c.message));
  return { added, removed };
}

/** Thermal warnings fluctuate around thresholds; only log crossings into critical. */
const NOISY = new Set(['TEMP_WARNING']);

export function diffForEvents(prev: SimulationState, next: SimulationState): EventDraft[] {
  const out: EventDraft[] = [];
  if (prev === next) return out;

  for (const eq of Object.values(next.equipment)) {
    const p = prev.equipment[eq.id];
    if (!p || p === eq) continue;
    if (isHost(eq) && p.state !== eq.state) {
      let severity: SimEvent['severity'] = 'info';
      if (eq.state === 'boot_failed') severity = 'critical';
      else if (eq.state === 'powered_off' && eq.desiredPower === 'on') severity = 'critical';
      else if (eq.state === 'degraded') severity = 'warning';
      out.push({
        severity,
        category: 'system',
        message: `${eq.hostname}: ${STATE_LABEL[p.state]} → ${STATE_LABEL[eq.state]}`,
        equipmentId: eq.id,
        channels: ['bmc', 'led'],
      });
    }
    if (p.powerStatus !== eq.powerStatus && (isHost(eq) || eq.kind === 'pdu' || eq.kind === 'power_shelf') && isMounted(eq)) {
      const severity: SimEvent['severity'] = eq.powerStatus === 'degraded' ? 'warning' : eq.powerStatus === 'failed' || eq.powerStatus === 'disconnected' ? 'critical' : 'info';
      out.push({ severity, category: 'power', message: `${eq.hostname}: power ${p.powerStatus} → ${eq.powerStatus}`, equipmentId: eq.id, channels: ['bmc'] });
    }
    const d = conditionDiff(p.conditions, eq.conditions);
    for (const c of d.added) {
      if (NOISY.has(c.code)) continue;
      out.push({ severity: c.severity, category: categoryForCode(c.code), message: `${eq.hostname}: ${c.message}`, equipmentId: eq.id, channels: c.channels });
    }
    for (const c of d.removed) {
      if (NOISY.has(c.code) || c.severity === 'info') continue;
      out.push({ severity: 'info', category: categoryForCode(c.code), message: `${eq.hostname}: cleared: ${c.message}`, equipmentId: eq.id, channels: c.channels });
    }
  }

  for (const comp of Object.values(next.components)) {
    const p = prev.components[comp.id];
    if (!p || p === comp || p.conditions === comp.conditions) continue;
    if (comp.location.kind !== 'equipment') continue;
    const eq = next.equipment[comp.location.equipmentId];
    const d = conditionDiff(p.conditions, comp.conditions);
    for (const c of d.added) {
      if (NOISY.has(c.code)) continue;
      out.push({ severity: c.severity, category: categoryForCode(c.code), message: `${eq.hostname}: ${c.message}`, equipmentId: eq.id, componentId: comp.id, channels: c.channels });
    }
    for (const c of d.removed) {
      if (NOISY.has(c.code) || c.severity === 'info') continue;
      out.push({ severity: 'info', category: categoryForCode(c.code), message: `${eq.hostname}: cleared: ${c.message}`, equipmentId: eq.id, componentId: comp.id, channels: c.channels });
    }
  }

  const pw = prev.workstation;
  const nw = next.workstation;
  if (pw && nw && pw !== nw) {
    const laptopId = nw.equipmentId;
    if (pw.effective.address !== nw.effective.address || pw.effective.source !== nw.effective.source) {
      const e = nw.effective;
      const msg =
        e.source === 'dhcp'
          ? `DHCP lease ${e.address}/${e.prefix}, gateway ${e.gateway}, DNS ${e.dns}`
          : e.source === 'apipa'
            ? `no DHCP answer: self-assigned link-local ${e.address}/16`
            : e.source === 'static'
              ? `static address ${e.address}/${e.prefix} active`
              : 'no IPv4 address';
      out.push({ severity: e.source === 'apipa' ? 'warning' : 'info', category: 'network', message: `tech-laptop eth0: ${msg}`, equipmentId: laptopId, channels: ['led'] });
    }
    if (!pw.conflict && nw.conflict) out.push({ severity: 'warning', category: 'network', message: `tech-laptop: IP address conflict for ${nw.effective.address}`, equipmentId: laptopId, channels: ['led'] });
    if (pw.poweredOn && !nw.poweredOn) out.push({ severity: 'warning', category: 'power', message: 'tech-laptop: battery empty, laptop shut down', equipmentId: laptopId, channels: ['led'] });
    if (!pw.onAc && nw.onAc) out.push({ severity: 'info', category: 'power', message: 'tech-laptop: on AC power (charging)', equipmentId: laptopId, channels: ['led'] });
    if (pw.batteryPct > 15 && nw.batteryPct <= 15 && !nw.onAc) out.push({ severity: 'warning', category: 'power', message: 'tech-laptop: battery low (15 %)', equipmentId: laptopId, channels: ['led'] });
    if (pw.consoleEquipmentId !== nw.consoleEquipmentId && nw.consoleEquipmentId) {
      out.push({ severity: 'info', category: 'system', message: `tech-laptop: serial console attached to ${next.equipment[nw.consoleEquipmentId]?.hostname}`, equipmentId: laptopId, channels: ['led'] });
    }
  }

  const linkChanges: EventDraft[] = [];
  for (const port of Object.values(next.ports)) {
    const p = prev.ports[port.id];
    if (!p || p === port || p.state === port.state) continue;
    if (!['bmc', 'data', 'fabric', 'uplink', 'mgmt'].includes(port.role)) continue;
    if (p.state !== 'link_up' && port.state !== 'link_up') continue;
    const eq = next.equipment[port.equipmentId];
    const up = port.state === 'link_up';
    linkChanges.push({
      severity: up ? 'info' : 'warning',
      category: 'network',
      message: `${eq.hostname} ${port.label}: link ${up ? `up (${port.speedGbps >= 1 ? `${port.speedGbps}G` : `${port.speedGbps * 1000}M`})` : `down${port.reason ? ` (${port.reason})` : ''}`}`,
      equipmentId: eq.id,
      channels: ['bmc', 'os', 'led'],
    });
  }
  if (linkChanges.length > 12) {
    const down = linkChanges.filter((e) => e.severity === 'warning').length;
    out.push({
      severity: down > 0 ? 'warning' : 'info',
      category: 'network',
      message: `${linkChanges.length} network links changed state (${down} down, ${linkChanges.length - down} up)`,
      channels: ['bmc', 'os', 'led'],
    });
  } else out.push(...linkChanges);

  return out;
}

/** Append events to the log and write SEL entries on hosts whose BMC is alive. */
export function appendEvents(s: SimulationState, drafts: EventDraft[]): void {
  for (const d of drafts) {
    s.seq.event += 1;
    s.events.push({ ...d, id: s.seq.event, timeMs: s.timeMs });
    if (d.equipmentId && d.channels.includes('bmc')) {
      const eq = s.equipment[d.equipmentId];
      if (eq?.bmcAlive) {
        s.seq.sel += 1;
        eq.sel.push({ id: s.seq.sel, timeMs: s.timeMs, severity: d.severity, message: d.message.replace(`${eq.hostname}: `, '') });
        if (eq.sel.length > MAX_SEL) eq.sel.splice(0, eq.sel.length - MAX_SEL);
      }
    }
  }
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
}
