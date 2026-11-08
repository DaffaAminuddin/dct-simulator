/**
 * Layer-3 reachability (SIMULATION_SPEC §6b): IP endpoints, gateways, routing
 * between networks, firewall policy, DNS, and the technician laptop's probes
 * (ping, SSH, HTTPS). Every function is a pure read of the simulation state.
 */
import { OS_STATES } from '@/simulation/core/SimulationState';
import type { Equipment, Id, NetworkDef, Port, SimulationState } from '@/types/simulation';
import { inCidr, isIpv4, sameSubnet } from './ip';
import { attachmentOf, type Segment, type SegmentCache, segmentFrom } from './Vlan';

export type EndpointKind = 'bmc' | 'host' | 'switch' | 'gateway' | 'dns' | 'laptop';
export type Service = 'icmp' | 'ssh' | 'https' | 'dns';
export type CredentialProfile = 'bmc-admin' | 'linux-dct' | 'netops';

export const CREDENTIALS: Record<CredentialProfile, { user: string; label: string; for: string }> = {
  'bmc-admin': { user: 'admin', label: 'BMC administrator (vault: DH01-BMC)', for: 'BMC / Redfish' },
  'linux-dct': { user: 'dct', label: 'Linux technician account (vault: DH01-LINUX)', for: 'Host operating systems' },
  netops: { user: 'netops', label: 'Network operator (vault: DH01-NET)', for: 'Switches' },
};

export interface Endpoint {
  ip: string;
  prefix: number;
  kind: EndpointKind;
  equipmentId: Id;
  hostname: string;
  /** DNS name that resolves to this endpoint. */
  dnsName: string;
  /** Physical port, absent for services hosted on a router (gateway SVI, DNS). */
  portId?: Id;
  networkId?: string;
  alive: boolean;
  services: Service[];
  auth?: CredentialProfile;
}

function networkFor(s: SimulationState, ip: string): NetworkDef | undefined {
  return s.facility.networks.find((n) => inCidr(ip, n.cidr));
}

function endpointKind(eq: Equipment, port: Port): EndpointKind {
  if (port.role === 'bmc') return eq.kind === 'switch' ? 'switch' : 'bmc';
  return 'host';
}

function endpointAlive(eq: Equipment, kind: EndpointKind): boolean {
  if (kind === 'bmc') return eq.bmcAlive;
  return OS_STATES.has(eq.state);
}

/** All IP endpoints except the laptop. */
export function listEndpoints(s: SimulationState): Endpoint[] {
  const out: Endpoint[] = [];
  for (const p of Object.values(s.ports)) {
    if (!p.ip || s.equipment[p.equipmentId]?.kind === 'laptop') continue;
    const eq = s.equipment[p.equipmentId];
    if (eq.location.kind === 'inventory') continue;
    const kind = endpointKind(eq, p);
    out.push({
      ip: p.ip.address,
      prefix: p.ip.prefix,
      kind,
      equipmentId: eq.id,
      hostname: eq.hostname,
      dnsName: kind === 'bmc' ? `${eq.hostname}-bmc` : eq.hostname,
      portId: p.id,
      networkId: networkFor(s, p.ip.address)?.id,
      alive: endpointAlive(eq, kind),
      services: kind === 'bmc' ? ['icmp', 'ssh', 'https'] : ['icmp', 'ssh'],
      auth: kind === 'bmc' ? 'bmc-admin' : kind === 'switch' ? 'netops' : 'linux-dct',
    });
  }
  for (const n of s.facility.networks) {
    const router = s.equipment[n.routerId];
    const prefix = Number(n.cidr.split('/')[1]);
    const alive = !!router && OS_STATES.has(router.state);
    out.push({ ip: n.gateway, prefix, kind: 'gateway', equipmentId: n.routerId, hostname: router?.hostname ?? n.routerId, dnsName: `gw-${n.id}`, networkId: n.id, alive, services: ['icmp'] });
    for (const svc of n.services ?? []) {
      out.push({ ip: svc.address, prefix, kind: 'dns', equipmentId: n.routerId, hostname: svc.name, dnsName: svc.name, networkId: n.id, alive, services: ['icmp', 'dns'] });
    }
  }
  return out;
}

/** Is the endpoint attached to this VLAN segment? */
export function endpointInSegment(s: SimulationState, e: Endpoint, seg: Segment): boolean {
  if (e.portId) return seg.endpointPortIds.has(e.portId);
  const n = s.facility.networks.find((x) => x.id === e.networkId);
  return !!n && n.vlan === seg.vlan && seg.switches.has(n.routerId);
}

export function firewallDecision(s: SimulationState, from: string, to: string): { allowed: boolean; rule?: string } {
  if (from === to) return { allowed: true };
  const rule = s.facility.firewall.find((r) => r.from === from && r.to === to);
  if (!rule) return { allowed: false, rule: 'implicit deny' };
  return { allowed: rule.action === 'allow', rule: rule.name };
}

/**
 * Monitoring view of a BMC: is it reachable from the management network's
 * router (where the NOC polls from)? Layer 1 checks first, then VLAN path.
 */
export function routedFromNoc(s: SimulationState, port: Port, cache?: SegmentCache): { ok: boolean; reason?: string } {
  if (!port.ip) return { ok: false, reason: 'No IP address configured' };
  const net = networkFor(s, port.ip.address);
  if (!net) return { ok: false, reason: `Address ${port.ip.address} is outside every managed network` };
  const router = s.equipment[net.routerId];
  if (!router || !OS_STATES.has(router.state)) return { ok: false, reason: `Management router ${router?.hostname ?? net.routerId} is down` };
  const seg = segmentFrom(s, net.routerId, net.vlan, cache);
  if (!seg.endpointPortIds.has(port.id)) return { ok: false, reason: `No VLAN ${net.vlan} path from the management network (check the switch port VLAN and uplinks)` };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Laptop probes
// ---------------------------------------------------------------------------

export type ProbeCode = 'ok' | 'powered_off' | 'no_carrier' | 'no_address' | 'unreachable' | 'timeout' | 'refused' | 'auth' | 'dns' | 'invalid';

export interface Route {
  ok: boolean;
  code: ProbeCode;
  /** Learner-visible message. */
  message: string;
  /** Ground-truth explanation (developer mode / hints). */
  why: string;
  endpoint?: Endpoint;
  latencyMs: number;
  routed: boolean;
}

function laptopPort(s: SimulationState): Port | undefined {
  const eq = s.equipment[s.workstation.equipmentId];
  return eq?.portIds.map((id) => s.ports[id]).find((p) => p?.defId === 'eth0');
}

interface LaptopCtx {
  port: Port;
  inSeg: (e: Endpoint) => boolean;
  hops: number;
}

function laptopContext(s: SimulationState, cache?: SegmentCache): { ctx?: LaptopCtx; fail?: Route } {
  const ws = s.workstation;
  const fail = (code: ProbeCode, message: string, why: string): { fail: Route } => ({ fail: { ok: false, code, message, why, latencyMs: 0, routed: false } });
  if (!ws.poweredOn) return fail('powered_off', 'Laptop is off (battery empty)', 'Battery at 0 % and no AC adapter connected');
  const port = laptopPort(s);
  if (!port || !ws.net.adminUp) return fail('no_carrier', 'connect: Network is unreachable (eth0 is down)', 'Interface administratively down');
  if (port.state !== 'link_up') return fail('no_carrier', 'connect: Network is unreachable (eth0: no carrier)', port.reason ?? `eth0 is ${port.state}`);
  if (ws.effective.source === 'none' || !ws.effective.address) return fail('no_address', 'connect: Network is unreachable (no IPv4 address)', 'No address configured');
  const att = attachmentOf(s, port, ws.net.vlan);
  if (!att) return fail('unreachable', 'Destination Host Unreachable', 'Frames dropped at the switch port (VLAN tag not allowed)');
  if (att.kind === 'p2p') {
    return { ctx: { port, inSeg: (e) => e.portId === att.peerPortId, hops: 0 } };
  }
  const seg = segmentFrom(s, att.switchId, att.vlan, cache);
  return { ctx: { port, inSeg: (e) => endpointInSegment(s, e, seg), hops: Math.max(1, seg.switches.size > 1 ? 2 : 1) } };
}

/** Route a packet from the laptop to `ip`. */
export function routeFromLaptop(s: SimulationState, ip: string, cache?: SegmentCache): Route {
  const { ctx, fail } = laptopContext(s, cache);
  if (fail || !ctx) return fail as Route;
  const eff = s.workstation.effective;
  const endpoints = listEndpoints(s);
  const target = endpoints.find((e) => e.ip === ip);
  const base = 0.22 + ctx.hops * 0.09;

  if (ip === eff.address) return { ok: true, code: 'ok', message: 'local address', why: 'Loopback to own address', latencyMs: 0.03, routed: false };

  if (sameSubnet(eff.address, ip, eff.prefix)) {
    if (!target) return { ok: false, code: 'unreachable', message: 'Destination Host Unreachable', why: `No device owns ${ip}`, latencyMs: 0, routed: false };
    if (!ctx.inSeg(target)) return { ok: false, code: 'unreachable', message: 'Destination Host Unreachable', why: `${target.dnsName} is not in the laptop's VLAN segment (ARP gets no reply)`, endpoint: target, latencyMs: 0, routed: false };
    if (!target.alive) return { ok: false, code: 'unreachable', message: 'Destination Host Unreachable', why: `${target.dnsName} is attached but not responding (${target.kind === 'bmc' ? 'BMC down' : 'host OS not running'})`, endpoint: target, latencyMs: 0, routed: false };
    return { ok: true, code: 'ok', message: 'reply', why: 'Same subnet, same VLAN segment', endpoint: target, latencyMs: base, routed: false };
  }

  if (!eff.gateway) return { ok: false, code: 'unreachable', message: 'connect: Network is unreachable', why: `${ip} is outside ${eff.address}/${eff.prefix} and no default gateway is set`, latencyMs: 0, routed: false };
  if (!sameSubnet(eff.address, eff.gateway, eff.prefix)) {
    return { ok: false, code: 'unreachable', message: 'connect: Network is unreachable', why: `Gateway ${eff.gateway} is not inside the laptop's subnet ${eff.address}/${eff.prefix}`, latencyMs: 0, routed: false };
  }
  const gw = endpoints.find((e) => e.ip === eff.gateway && e.kind === 'gateway');
  if (!gw || !ctx.inSeg(gw) || !gw.alive) {
    return { ok: false, code: 'unreachable', message: 'Destination Host Unreachable', why: `Gateway ${eff.gateway} does not answer ARP on the laptop's segment`, latencyMs: 0, routed: false };
  }
  const from = gw.networkId ?? '';
  const dst = networkFor(s, ip);
  if (!dst) return { ok: false, code: 'timeout', message: 'Request timed out', why: `No route to ${ip}`, latencyMs: 0, routed: true };
  const fw = firewallDecision(s, from, dst.id);
  if (!fw.allowed) return { ok: false, code: 'timeout', message: 'Request timed out', why: `Dropped by firewall (${fw.rule}): ${from} → ${dst.id}`, latencyMs: 0, routed: true };
  if (!target) return { ok: false, code: 'timeout', message: 'Request timed out', why: `No device owns ${ip}`, latencyMs: 0, routed: true };
  const router = s.equipment[dst.routerId];
  if (!router || !OS_STATES.has(router.state)) return { ok: false, code: 'timeout', message: 'Request timed out', why: `Router for ${dst.id} is down`, endpoint: target, latencyMs: 0, routed: true };
  const seg = segmentFrom(s, dst.routerId, dst.vlan, cache);
  if (!endpointInSegment(s, target, seg) || !target.alive) {
    return { ok: false, code: 'timeout', message: 'Request timed out', why: `${target.dnsName} is not reachable from the ${dst.id} router (VLAN path or device down)`, endpoint: target, latencyMs: 0, routed: true };
  }
  return { ok: true, code: 'ok', message: 'reply', why: `Routed via ${eff.gateway}`, endpoint: target, latencyMs: base + 0.55, routed: true };
}

export interface ProbeResult {
  ok: boolean;
  code: ProbeCode;
  lines: string[];
  why: string;
  endpoint?: Endpoint;
}

/** Resolve a hostname via the laptop's DNS server (IP literals pass through). */
export function resolveName(s: SimulationState, input: string, cache?: SegmentCache): { ip?: string; fail?: ProbeResult } {
  const name = input.trim().replace(/\.dh01\.lab$/i, '');
  if (!name) return { fail: { ok: false, code: 'invalid', lines: ['usage: <host>'], why: 'Empty target' } };
  if (isIpv4(name)) return { ip: name };
  if (/^\d+(\.\d+)*$/.test(name)) return { fail: { ok: false, code: 'invalid', lines: [`${name}: Name or service not known`], why: 'Malformed address' } };
  const dns = s.workstation.effective.dns;
  if (!dns) return { fail: { ok: false, code: 'dns', lines: [`${name}: Temporary failure in name resolution`], why: 'No DNS server configured on the laptop' } };
  const route = routeFromLaptop(s, dns, cache);
  if (!route.ok || route.endpoint?.kind !== 'dns' || !route.endpoint.alive) {
    return { fail: { ok: false, code: 'dns', lines: [`${name}: Temporary failure in name resolution`], why: `DNS server ${dns} unreachable: ${route.why}` } };
  }
  const hit = listEndpoints(s).find((e) => e.dnsName.toLowerCase() === name.toLowerCase());
  if (!hit) return { fail: { ok: false, code: 'dns', lines: [`${name}: Name or service not known`], why: `No DNS record for ${name}` } };
  return { ip: hit.ip };
}

export function ping(s: SimulationState, input: string, count = 4, cache?: SegmentCache): ProbeResult {
  const res = resolveName(s, input, cache);
  if (res.fail) return { ...res.fail, lines: [`ping: ${res.fail.lines[0]}`] };
  const ip = res.ip as string;
  const r = routeFromLaptop(s, ip, cache);
  const head = `PING ${input.trim()} (${ip}) 56(84) bytes of data.`;
  if (r.code === 'powered_off' || r.code === 'no_carrier' || r.code === 'no_address' || r.message.startsWith('connect:')) {
    return { ok: false, code: r.code, lines: [`ping: ${r.message}`], why: r.why, endpoint: r.endpoint };
  }
  const lines = [head];
  const src = s.workstation.effective.address;
  if (r.ok) {
    for (let i = 1; i <= count; i++) lines.push(`64 bytes from ${ip}: icmp_seq=${i} ttl=${r.routed ? 63 : 64} time=${(r.latencyMs + ((i * 37) % 11) / 100).toFixed(2)} ms`);
  } else if (r.code === 'unreachable') {
    for (let i = 1; i <= count; i++) lines.push(`From ${src} icmp_seq=${i} Destination Host Unreachable`);
  }
  lines.push('', `--- ${input.trim()} ping statistics ---`);
  lines.push(r.ok ? `${count} packets transmitted, ${count} received, 0% packet loss, time ${(count - 1) * 1001}ms` : `${count} packets transmitted, 0 received${r.code === 'unreachable' ? `, +${count} errors` : ''}, 100% packet loss, time ${(count - 1) * 1001}ms`);
  return { ok: r.ok, code: r.code, lines, why: r.why, endpoint: r.endpoint };
}

const BANNERS: Record<'bmc' | 'host' | 'switch', (e: Endpoint) => string[]> = {
  bmc: (e) => [`${e.hostname} BMC (DC-SCM reference firmware, simulated)`, 'Redfish service: https://' + e.ip + '/redfish/v1', '-> SMASH-CLP shell. Interactive commands arrive with the Phase 3 terminal.'],
  host: (e) => ['Welcome to Ubuntu 24.04 LTS (simulated)', `Last login from the technician laptop. Host: ${e.hostname}`, 'Interactive shell arrives with the Phase 3 terminal.'],
  switch: (e) => [`Network OS (reference) on ${e.hostname}`, 'Interactive CLI arrives with Phase 5 switch commands.'],
};

export function sshConnect(s: SimulationState, input: string, profile: CredentialProfile, cache?: SegmentCache): ProbeResult {
  const res = resolveName(s, input, cache);
  const host = input.trim();
  if (res.fail) return { ...res.fail, lines: [`ssh: Could not resolve hostname ${host}: ${res.fail.lines[0].split(': ').slice(1).join(': ') || 'Name or service not known'}`] };
  const ip = res.ip as string;
  const r = routeFromLaptop(s, ip, cache);
  const user = CREDENTIALS[profile].user;
  if (!r.ok) {
    const msg = r.code === 'timeout' ? 'Connection timed out' : r.code === 'unreachable' ? 'No route to host' : r.message.replace(/^connect: /, '');
    return { ok: false, code: r.code, lines: [`ssh: connect to host ${host} port 22: ${msg}`], why: r.why, endpoint: r.endpoint };
  }
  const e = r.endpoint as Endpoint;
  if (!e.services.includes('ssh')) return { ok: false, code: 'refused', lines: [`ssh: connect to host ${host} port 22: Connection refused`], why: `${e.dnsName} does not run an SSH service`, endpoint: e };
  if (e.auth !== profile) {
    return { ok: false, code: 'auth', lines: [`${user}@${host}: Permission denied (publickey,password).`], why: `${e.dnsName} expects the ${e.auth} credential, not ${profile}`, endpoint: e };
  }
  const kind = e.kind === 'bmc' ? 'bmc' : e.kind === 'switch' ? 'switch' : 'host';
  return {
    ok: true,
    code: 'ok',
    lines: [`Warning: Permanently added '${host}' (ED25519) to the list of known hosts.`, `Authenticated to ${host} ([${ip}]:22) as '${user}'.`, '', ...BANNERS[kind](e)],
    why: r.why,
    endpoint: e,
  };
}

export function httpsGet(s: SimulationState, input: string, cache?: SegmentCache): ProbeResult {
  const host = input.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const res = resolveName(s, host, cache);
  if (res.fail) return { ...res.fail, lines: ['ERR_NAME_NOT_RESOLVED'] };
  const r = routeFromLaptop(s, res.ip as string, cache);
  if (!r.ok) return { ok: false, code: r.code, lines: [r.code === 'timeout' ? 'ERR_CONNECTION_TIMED_OUT' : r.code === 'no_carrier' || r.code === 'no_address' || r.code === 'powered_off' ? 'ERR_INTERNET_DISCONNECTED' : 'ERR_ADDRESS_UNREACHABLE'], why: r.why, endpoint: r.endpoint };
  const e = r.endpoint as Endpoint;
  if (!e.services.includes('https')) return { ok: false, code: 'refused', lines: ['ERR_CONNECTION_REFUSED'], why: `${e.dnsName} has no web interface`, endpoint: e };
  return { ok: true, code: 'ok', lines: [], why: r.why, endpoint: e };
}

