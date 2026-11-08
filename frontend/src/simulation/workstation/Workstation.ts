/**
 * Technician laptop (SIMULATION_SPEC §10): battery and USB-C power, the eth0
 * IP stack (DHCP / static / link-local), the serial console cable, and the
 * crash cart it sits on.
 */
import { getCableModel } from '@/data/cables/cableCatalog';
import { type DeriveContext, peerPort } from '@/simulation/core/SimulationState';
import { clamp, fail, hash32, set } from '@/simulation/core/util';
import { inCidr, intToIp, ipToInt, isIpv4, isReservedHost, sameSubnet } from '@/simulation/networking/ip';
import { attachmentOf, segmentFrom } from '@/simulation/networking/Vlan';
import { inletHasPower } from '@/simulation/power/PowerDistribution';
import type { EffectiveIp, Id, Port, SimulationState, WorkstationNetConfig, WorkstationState } from '@/types/simulation';

export const LAPTOP_ID = 'laptop-01';
/** Battery runtime and charge time (simplified). */
export const BATTERY_RUNTIME_MIN = 120;
export const BATTERY_CHARGE_MIN = 60;

export function defaultWorkstation(): WorkstationState {
  return {
    equipmentId: LAPTOP_ID,
    net: { mode: 'dhcp', address: '', prefix: 16, gateway: '', dns: '', vlan: null, adminUp: true },
    batteryPct: 80,
    onAc: false,
    poweredOn: true,
    effective: { address: '', prefix: 0, gateway: '', dns: '', source: 'none' },
    conflict: false,
    consoleEquipmentId: null,
  };
}

export function laptopPorts(s: SimulationState): Port[] {
  const eq = s.equipment[s.workstation.equipmentId];
  return eq ? eq.portIds.map((id) => s.ports[id]).filter(Boolean) : [];
}

export function laptopPort(s: SimulationState, defId: string): Port | undefined {
  return laptopPorts(s).find((p) => p.defId === defId);
}

/** Power stage: AC adapter into a live outlet, otherwise battery. */
export function deriveWorkstationPower(s: SimulationState, ctx: DeriveContext): void {
  const ws = s.workstation;
  const eq = s.equipment[ws.equipmentId];
  if (!eq) return;
  const inlet = laptopPorts(s).find((p) => p.role === 'power_in');
  const onAc = eq.location.kind !== 'inventory' && inletHasPower(s, ctx, inlet);
  set(ws, 'onAc', onAc);
  set(ws, 'poweredOn', onAc || ws.batteryPct > 0);
  set(eq, 'state', 'passive');
  set(eq, 'powerStatus', onAc ? 'available' : ws.poweredOn ? 'degraded' : 'disconnected');
  set(eq, 'powerCapacityW', ws.poweredOn ? 65 : 0);
  set(eq, 'powerDemandW', ws.poweredOn ? 25 : 0);
  set(eq, 'health', 'ok');
}

const NONE: EffectiveIp = { address: '', prefix: 0, gateway: '', dns: '', source: 'none' };

function apipaFor(s: SimulationState): EffectiveIp {
  const h = hash32(s.equipment[s.workstation.equipmentId]?.serial ?? 'laptop');
  return { address: `169.254.${1 + (h % 254)}.${1 + ((h >>> 8) % 254)}`, prefix: 16, gateway: '', dns: '', source: 'apipa' };
}

/** Network stage (after link derivation): effective address, DHCP lease, conflicts, serial console. */
export function deriveWorkstationNetwork(s: SimulationState): void {
  const ws = s.workstation;
  const eth = laptopPort(s, 'eth0');
  let eff: EffectiveIp = NONE;

  if (ws.poweredOn && ws.net.adminUp && eth?.state === 'link_up') {
    if (ws.net.mode === 'static') {
      const net = s.facility.networks.find((n) => isIpv4(ws.net.address) && inCidr(ws.net.address, n.cidr));
      eff = { address: ws.net.address, prefix: ws.net.prefix, gateway: ws.net.gateway, dns: ws.net.dns, source: 'static', networkId: net?.id };
    } else {
      eff = apipaFor(s);
      const att = attachmentOf(s, eth, ws.net.vlan);
      if (att?.kind === 'switch') {
        const seg = segmentFrom(s, att.switchId, att.vlan);
        const net = s.facility.networks.find((n) => n.dhcp && n.vlan === att.vlan && seg.switches.has(n.routerId));
        if (net?.dhcp) {
          const used = new Set(Object.values(s.ports).filter((p) => p.ip).map((p) => p.ip!.address));
          let addr = ipToInt(net.dhcp.start);
          const end = ipToInt(net.dhcp.end);
          while (addr <= end && used.has(intToIp(addr))) addr++;
          if (addr <= end) {
            eff = { address: intToIp(addr), prefix: Number(net.cidr.split('/')[1]), gateway: net.gateway, dns: net.dhcp.dns, source: 'dhcp', networkId: net.id };
          }
        }
      }
    }
  }
  if (!ws.effective || ws.effective.address !== eff.address || ws.effective.source !== eff.source || ws.effective.gateway !== eff.gateway || ws.effective.dns !== eff.dns || ws.effective.prefix !== eff.prefix) {
    ws.effective = eff;
  }
  const conflict = eff.source === 'static' && Object.values(s.ports).some((p) => p.ip?.address === eff.address && s.equipment[p.equipmentId]?.location.kind !== 'inventory');
  set(ws, 'conflict', conflict);

  // Serial console: a console cable from a laptop USB-A port to a host's RJ45 console port.
  let consoleEq: Id | null = null;
  let reason: string | undefined;
  for (const p of laptopPorts(s)) {
    if (p.type !== 'usb_a' || !p.cableId) continue;
    const cable = s.cables[p.cableId];
    const peer = peerPort(s, p);
    if (!getCableModel(cable.modelId).console) {
      reason = 'The cable in the USB port is not a serial console cable';
      continue;
    }
    if (!peer) {
      reason = 'Console cable plugged into the laptop, far end loose';
      continue;
    }
    if (peer.type !== 'serial_rj45') {
      reason = `Console cable plugged into ${peer.label}, which is not a serial console port`;
      continue;
    }
    consoleEq = peer.equipmentId;
    reason = undefined;
    break;
  }
  set(ws, 'consoleEquipmentId', consoleEq);
  set(ws, 'consoleReason', reason);
}

export function advanceWorkstation(s: SimulationState, dtMs: number): void {
  const ws = s.workstation;
  const min = dtMs / 60000;
  const next = ws.onAc ? ws.batteryPct + (100 / BATTERY_CHARGE_MIN) * min : ws.batteryPct - (100 / BATTERY_RUNTIME_MIN) * min;
  const rounded = Math.round(clamp(next, 0, 100) * 100) / 100;
  if (rounded !== ws.batteryPct) ws.batteryPct = rounded;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function configureWorkstation(s: SimulationState, patch: Partial<WorkstationNetConfig>): string[] {
  const next: WorkstationNetConfig = { ...s.workstation.net, ...patch };
  const warnings: string[] = [];
  next.address = next.address.trim();
  next.gateway = next.gateway.trim();
  next.dns = next.dns.trim();
  if (next.mode === 'static') {
    if (!isIpv4(next.address)) fail('INVALID_IP', `"${next.address || '(empty)'}" is not a valid IPv4 address`);
    if (!Number.isInteger(next.prefix) || next.prefix < 8 || next.prefix > 30) fail('INVALID_PREFIX', 'Prefix length must be between /8 and /30');
    if (isReservedHost(next.address, next.prefix)) fail('INVALID_IP', `${next.address} is the network or broadcast address of /${next.prefix}`);
    if (next.gateway && !isIpv4(next.gateway)) fail('INVALID_GATEWAY', `"${next.gateway}" is not a valid gateway address`);
    if (next.gateway && !sameSubnet(next.address, next.gateway, next.prefix)) warnings.push(`Gateway ${next.gateway} is outside ${next.address}/${next.prefix}: routed traffic will fail`);
  }
  if (next.dns && !isIpv4(next.dns)) fail('INVALID_DNS', `"${next.dns}" is not a valid DNS server address`);
  if (next.vlan !== null && (!Number.isInteger(next.vlan) || next.vlan < 1 || next.vlan > 4094)) fail('INVALID_VLAN', 'VLAN ID must be between 1 and 4094 (or untagged)');
  s.workstation.net = next;
  return warnings;
}

export function moveCart(s: SimulationState, rackId: Id, side: 'front' | 'rear'): void {
  if (!s.racks[rackId]) fail('UNKNOWN_RACK', `Unknown rack ${rackId}`);
  const cabled = laptopPorts(s).filter((p) => p.cableId);
  if (cabled.length) fail('CABLES_ATTACHED', `Unplug the laptop's cables first (${cabled.map((p) => p.label).join(', ')})`);
  const eq = s.equipment[s.workstation.equipmentId];
  eq.location = { kind: 'cart', rackId, side };
}
