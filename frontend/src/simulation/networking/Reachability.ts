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
// Probes from the laptop or from a host OS
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

/** Where a probe originates: the technician laptop, or a host's operating system. */
export type ProbeSource = { kind: 'laptop' } | { kind: 'host'; equipmentId: Id };
export const LAPTOP_SOURCE: ProbeSource = { kind: 'laptop' };

/** The IP interface a probe leaves from. */
interface SourceIface {
  port: Port;
  tag: number | null | undefined;
  address: string;
  prefix: number;
  gateway: string;
}

function laptopPort(s: SimulationState): Port | undefined {
  const eq = s.equipment[s.workstation.equipmentId];
  return eq?.portIds.map((id) => s.ports[id]).find((p) => p?.defId === 'eth0');
}

/** Host OS interface that carries its data-network address. */
export function hostDataPort(s: SimulationState, equipmentId: Id): Port | undefined {
  const eq = s.equipment[equipmentId];
  if (!eq) return undefined;
  return eq.portIds.map((id) => s.ports[id]).find((p) => p?.ip && p.role !== 'bmc');
}

interface Ctx {
  inSeg: (e: Endpoint) => boolean;
  hops: number;
}

const failRoute = (code: ProbeCode, message: string, why: string): Route => ({ ok: false, code, message, why, latencyMs: 0, routed: false });

function sourceIface(s: SimulationState, from: ProbeSource): { src?: SourceIface; fail?: Route } {
  if (from.kind === 'laptop') {
    const ws = s.workstation;
    if (!ws.poweredOn) return { fail: failRoute('powered_off', 'Laptop is off (battery empty)', 'Battery at 0 % and no AC adapter connected') };
    const port = laptopPort(s);
    if (!port || !ws.net.adminUp) return { fail: failRoute('no_carrier', 'connect: Network is unreachable (eth0 is down)', 'Interface administratively down') };
    if (port.state !== 'link_up') return { fail: failRoute('no_carrier', 'connect: Network is unreachable (eth0: no carrier)', port.reason ?? `eth0 is ${port.state}`) };
    if (ws.effective.source === 'none' || !ws.effective.address) return { fail: failRoute('no_address', 'connect: Network is unreachable (no IPv4 address)', 'No address configured') };
    return { src: { port, tag: ws.net.vlan, address: ws.effective.address, prefix: ws.effective.prefix, gateway: ws.effective.gateway } };
  }
  const eq = s.equipment[from.equipmentId];
  if (!eq || !OS_STATES.has(eq.state)) return { fail: failRoute('powered_off', 'Host operating system not running', 'Host OS is down') };
  const port = hostDataPort(s, eq.id);
  if (!port?.ip) return { fail: failRoute('no_address', 'connect: Network is unreachable', `${eq.hostname} has no configured data interface`) };
  const name = port.osName ?? port.label;
  if (port.state !== 'link_up') return { fail: failRoute('no_carrier', 'connect: Network is unreachable', `${name} is ${port.state}${port.reason ? ` (${port.reason})` : ''}`) };
  return { src: { port, tag: port.ip.vlan, address: port.ip.address, prefix: port.ip.prefix, gateway: port.ip.gateway ?? '' } };
}

function segmentContext(s: SimulationState, src: SourceIface, cache?: SegmentCache): { ctx?: Ctx; fail?: Route } {
  const att = attachmentOf(s, src.port, src.tag);
  if (!att) return { fail: failRoute('unreachable', 'Destination Host Unreachable', 'Frames dropped at the switch port (VLAN tag not allowed)') };
  if (att.kind === 'p2p') return { ctx: { inSeg: (e) => e.portId === att.peerPortId, hops: 0 } };
  const seg = segmentFrom(s, att.switchId, att.vlan, cache);
  return { ctx: { inSeg: (e) => endpointInSegment(s, e, seg), hops: Math.max(1, seg.switches.size > 1 ? 2 : 1) } };
}

/** Route a packet from `from` to `ip`. */
export function routeFrom(s: SimulationState, from: ProbeSource, ip: string, cache?: SegmentCache): Route {
  const { src, fail: f1 } = sourceIface(s, from);
  if (f1 || !src) return f1 as Route;
  const { ctx, fail: f2 } = segmentContext(s, src, cache);
  if (f2 || !ctx) return f2 as Route;
  const endpoints = listEndpoints(s);
  const target = endpoints.find((e) => e.ip === ip);
  const base = 0.22 + ctx.hops * 0.09;

  if (ip === src.address || ip === '127.0.0.1') return { ok: true, code: 'ok', message: 'local address', why: 'Loopback to own address', latencyMs: 0.03, routed: false };

  if (sameSubnet(src.address, ip, src.prefix)) {
    if (!target) return { ok: false, code: 'unreachable', message: 'Destination Host Unreachable', why: `No device owns ${ip}`, latencyMs: 0, routed: false };
    if (!ctx.inSeg(target)) return { ok: false, code: 'unreachable', message: 'Destination Host Unreachable', why: `${target.dnsName} is not in the source's VLAN segment (ARP gets no reply)`, endpoint: target, latencyMs: 0, routed: false };
    if (!target.alive) return { ok: false, code: 'unreachable', message: 'Destination Host Unreachable', why: `${target.dnsName} is attached but not responding (${target.kind === 'bmc' ? 'BMC down' : 'host OS not running'})`, endpoint: target, latencyMs: 0, routed: false };
    return { ok: true, code: 'ok', message: 'reply', why: 'Same subnet, same VLAN segment', endpoint: target, latencyMs: base, routed: false };
  }

  if (!src.gateway) return { ok: false, code: 'unreachable', message: 'connect: Network is unreachable', why: `${ip} is outside ${src.address}/${src.prefix} and no default gateway is set`, latencyMs: 0, routed: false };
  if (!sameSubnet(src.address, src.gateway, src.prefix)) {
    return { ok: false, code: 'unreachable', message: 'connect: Network is unreachable', why: `Gateway ${src.gateway} is not inside the source subnet ${src.address}/${src.prefix}`, latencyMs: 0, routed: false };
  }
  const gw = endpoints.find((e) => e.ip === src.gateway && e.kind === 'gateway');
  if (!gw || !ctx.inSeg(gw) || !gw.alive) {
    return { ok: false, code: 'unreachable', message: 'Destination Host Unreachable', why: `Gateway ${src.gateway} does not answer ARP on the source segment`, latencyMs: 0, routed: false };
  }
  const fromNet = gw.networkId ?? '';
  const dst = networkFor(s, ip);
  if (!dst) return { ok: false, code: 'timeout', message: 'Request timed out', why: `No route to ${ip}`, latencyMs: 0, routed: true };
  const fw = firewallDecision(s, fromNet, dst.id);
  if (!fw.allowed) return { ok: false, code: 'timeout', message: 'Request timed out', why: `Dropped by firewall (${fw.rule}): ${fromNet} → ${dst.id}`, latencyMs: 0, routed: true };
  if (!target) return { ok: false, code: 'timeout', message: 'Request timed out', why: `No device owns ${ip}`, latencyMs: 0, routed: true };
  const router = s.equipment[dst.routerId];
  if (!router || !OS_STATES.has(router.state)) return { ok: false, code: 'timeout', message: 'Request timed out', why: `Router for ${dst.id} is down`, endpoint: target, latencyMs: 0, routed: true };
  const seg = segmentFrom(s, dst.routerId, dst.vlan, cache);
  if (!endpointInSegment(s, target, seg) || !target.alive) {
    return { ok: false, code: 'timeout', message: 'Request timed out', why: `${target.dnsName} is not reachable from the ${dst.id} router (VLAN path or device down)`, endpoint: target, latencyMs: 0, routed: true };
  }
  return { ok: true, code: 'ok', message: 'reply', why: `Routed via ${src.gateway}`, endpoint: target, latencyMs: base + 0.55, routed: true };
}

/** Route a packet from the laptop to `ip`. */
export function routeFromLaptop(s: SimulationState, ip: string, cache?: SegmentCache): Route {
  return routeFrom(s, LAPTOP_SOURCE, ip, cache);
}

/** Source address a probe would leave from (for "From <addr>" lines). */
export function sourceAddress(s: SimulationState, from: ProbeSource): string {
  return sourceIface(s, from).src?.address ?? '';
}

export interface ProbeResult {
  ok: boolean;
  code: ProbeCode;
  lines: string[];
  why: string;
  endpoint?: Endpoint;
}

/**
 * Hosts resolve cluster names through /etc/hosts (data-network addresses of
 * every host); the laptop asks the DNS server it got from DHCP or was given.
 */
export function hostsFileEntries(s: SimulationState): { ip: string; name: string }[] {
  return listEndpoints(s)
    .filter((e) => e.kind === 'host')
    .map((e) => ({ ip: e.ip, name: e.hostname }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve a hostname from `from` (IP literals pass through). */
export function resolveFrom(s: SimulationState, from: ProbeSource, input: string, cache?: SegmentCache): { ip?: string; fail?: ProbeResult } {
  const name = input.trim().replace(/\.dh01\.lab$/i, '');
  if (!name) return { fail: { ok: false, code: 'invalid', lines: ['usage: <host>'], why: 'Empty target' } };
  if (isIpv4(name)) return { ip: name };
  if (/^\d+(\.\d+)*$/.test(name)) return { fail: { ok: false, code: 'invalid', lines: [`${name}: Name or service not known`], why: 'Malformed address' } };
  if (name === 'localhost') return { ip: '127.0.0.1' };
  if (from.kind === 'host') {
    const hit = hostsFileEntries(s).find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (hit) return { ip: hit.ip };
    return { fail: { ok: false, code: 'dns', lines: [`${name}: Name or service not known`], why: `${name} is not in /etc/hosts and the data network has no DNS server` } };
  }
  const dns = s.workstation.effective.dns;
  if (!dns) return { fail: { ok: false, code: 'dns', lines: [`${name}: Temporary failure in name resolution`], why: 'No DNS server configured on the laptop' } };
  const route = routeFrom(s, from, dns, cache);
  if (!route.ok || route.endpoint?.kind !== 'dns' || !route.endpoint.alive) {
    return { fail: { ok: false, code: 'dns', lines: [`${name}: Temporary failure in name resolution`], why: `DNS server ${dns} unreachable: ${route.why}` } };
  }
  const hit = listEndpoints(s).find((e) => e.dnsName.toLowerCase() === name.toLowerCase());
  if (!hit) return { fail: { ok: false, code: 'dns', lines: [`${name}: Name or service not known`], why: `No DNS record for ${name}` } };
  return { ip: hit.ip };
}

/** Resolve a hostname via the laptop's DNS server (IP literals pass through). */
export function resolveName(s: SimulationState, input: string, cache?: SegmentCache): { ip?: string; fail?: ProbeResult } {
  return resolveFrom(s, LAPTOP_SOURCE, input, cache);
}

export function pingFrom(s: SimulationState, from: ProbeSource, input: string, count = 4, cache?: SegmentCache): ProbeResult {
  const res = resolveFrom(s, from, input, cache);
  if (res.fail) return { ...res.fail, lines: [`ping: ${res.fail.lines[0]}`] };
  const ip = res.ip as string;
  const head = `PING ${input.trim()} (${ip}) 56(84) bytes of data.`;
  const lines = [head];
  const stats = (received: number, errors = 0) =>
    `${count} packets transmitted, ${received} received${errors ? `, +${errors} errors` : ''}, ${received === count ? 0 : 100}% packet loss, time ${(count - 1) * 1001}ms`;
  if (ip === '127.0.0.1') {
    for (let i = 1; i <= count; i++) lines.push(`64 bytes from 127.0.0.1: icmp_seq=${i} ttl=64 time=0.0${(i * 3) % 9 + 1} ms`);
    lines.push('', `--- ${input.trim()} ping statistics ---`, stats(count));
    return { ok: true, code: 'ok', lines, why: 'Loopback' };
  }
  const r = routeFrom(s, from, ip, cache);
  if (r.code === 'powered_off' || r.code === 'no_carrier' || r.code === 'no_address' || r.message.startsWith('connect:')) {
    return { ok: false, code: r.code, lines: [`ping: ${r.message}`], why: r.why, endpoint: r.endpoint };
  }
  const src = sourceAddress(s, from);
  if (r.ok) {
    for (let i = 1; i <= count; i++) lines.push(`64 bytes from ${ip}: icmp_seq=${i} ttl=${r.routed ? 63 : 64} time=${(r.latencyMs + ((i * 37) % 11) / 100).toFixed(2)} ms`);
  } else if (r.code === 'unreachable') {
    for (let i = 1; i <= count; i++) lines.push(`From ${src} icmp_seq=${i} Destination Host Unreachable`);
  }
  lines.push('', `--- ${input.trim()} ping statistics ---`, stats(r.ok ? count : 0, r.code === 'unreachable' ? count : 0));
  return { ok: r.ok, code: r.code, lines, why: r.why, endpoint: r.endpoint };
}

export function ping(s: SimulationState, input: string, count = 4, cache?: SegmentCache): ProbeResult {
  return pingFrom(s, LAPTOP_SOURCE, input, count, cache);
}

export const PROFILE_BY_USER: Record<string, CredentialProfile> = { admin: 'bmc-admin', dct: 'linux-dct', netops: 'netops' };

const BANNERS: Record<'bmc' | 'host' | 'switch', (e: Endpoint) => string[]> = {
  bmc: (e) => [`${e.hostname} BMC (DC-SCM reference firmware, simulated)`, `Redfish service: https://${e.ip}/redfish/v1`, "BMC CLI (reference). Type 'help' for commands."],
  host: (e) => ['Welcome to Ubuntu 24.04 LTS (simulated)', `Last login from the technician laptop. Host: ${e.hostname}`],
  switch: (e) => [`Network OS (reference) on ${e.hostname}`, 'Interactive switch CLI arrives with the Phase 5 network commands.'],
};

/** SSH to `input` as `user` from `from`: route, service and credential checks. */
export function sshFrom(s: SimulationState, from: ProbeSource, input: string, user: string, cache?: SegmentCache): ProbeResult {
  const host = input.trim();
  const res = resolveFrom(s, from, host, cache);
  if (res.fail) return { ...res.fail, lines: [`ssh: Could not resolve hostname ${host}: ${res.fail.lines[0].split(': ').slice(1).join(': ') || 'Name or service not known'}`] };
  const ip = res.ip as string;
  if (ip === '127.0.0.1') return { ok: false, code: 'refused', lines: [`ssh: connect to host ${host} port 22: Connection refused`], why: 'Loopback SSH is not simulated' };
  const r = routeFrom(s, from, ip, cache);
  if (!r.ok) {
    const msg = r.code === 'timeout' ? 'Connection timed out' : r.code === 'unreachable' ? 'No route to host' : r.message.replace(/^connect: /, '');
    return { ok: false, code: r.code, lines: [`ssh: connect to host ${host} port 22: ${msg}`], why: r.why, endpoint: r.endpoint };
  }
  const e = r.endpoint as Endpoint;
  if (!e.services.includes('ssh')) return { ok: false, code: 'refused', lines: [`ssh: connect to host ${host} port 22: Connection refused`], why: `${e.dnsName} does not run an SSH service`, endpoint: e };
  const profile = PROFILE_BY_USER[user];
  if (!profile || e.auth !== profile) {
    return {
      ok: false,
      code: 'auth',
      lines: [`${user}@${host}: Permission denied (publickey,password).`],
      why: profile ? `${e.dnsName} expects the ${e.auth} credential (user ${e.auth ? CREDENTIALS[e.auth].user : '?'}), not ${profile}` : `No account "${user}" in the credential vault`,
      endpoint: e,
    };
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

/** Laptop SSH client with a vault credential profile. */
export function sshConnect(s: SimulationState, input: string, profile: CredentialProfile, cache?: SegmentCache): ProbeResult {
  return sshFrom(s, LAPTOP_SOURCE, input, CREDENTIALS[profile].user, cache);
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
