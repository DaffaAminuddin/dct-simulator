/** Network commands: ip, ping, traceroute, ethtool, ssh, serial console. */
import { getCableModel, getTransceiverModel } from '@/data/cables/cableCatalog';
import { OS_STATES } from '@/simulation/core/SimulationState';
import { macFor } from '@/simulation/core/util';
import { intToIp, ipToInt, isIpv4, maskOf, sameSubnet } from '@/simulation/networking/ip';
import { listEndpoints, pingFrom, type ProbeSource, resolveFrom, routeFrom, sshFrom } from '@/simulation/networking/Reachability';
import { snapshotCache } from '@/simulation/networking/Vlan';
import { consoleScreen } from '@/simulation/workstation/Console';
import { laptopPort } from '@/simulation/workstation/Workstation';
import type { Port, SimulationState } from '@/types/simulation';
import { bootInfo, dateString, findInterface, KERNEL, type NetIf, netInterfaces, wallClock } from '../os/HostOs';
import { pushFrame } from '../Session';
import type { CommandContext, CommandDef, CommandResult } from '../types';
import { err, ok } from '../types';
import { parseFlags, shellHost, usage } from './util';

const SHELLS: CommandDef['contexts'] = ['laptop', 'host'];

export function sourceOf(ctx: CommandContext): ProbeSource {
  return ctx.frame.kind === 'host' ? { kind: 'host', equipmentId: ctx.frame.equipmentId } : { kind: 'laptop' };
}

/** Interfaces of the current shell, with the laptop's eth0 modelled from the workstation state. */
function interfacesOf(ctx: CommandContext): (NetIf & { addr?: { ip: string; prefix: number; scope: 'global' | 'link'; dynamic: boolean } })[] {
  const s = ctx.state;
  if (ctx.frame.kind === 'laptop') {
    const ws = s.workstation;
    const eth = laptopPort(s, 'eth0');
    const eq = s.equipment[ws.equipmentId];
    const eff = ws.effective;
    const operUp = ws.poweredOn && ws.net.adminUp && eth?.state === 'link_up';
    return [
      { name: 'lo', index: 1, kind: 'loopback', mac: '00:00:00:00:00:00', mtu: 65536, adminUp: true, operUp: true, speedGbps: 0, driver: '', addr: { ip: '127.0.0.1', prefix: 8, scope: 'global', dynamic: false } },
      {
        name: 'eth0',
        index: 2,
        kind: 'ether',
        port: eth,
        mac: macFor(eq?.serial ?? 'laptop'),
        mtu: 1500,
        adminUp: ws.net.adminUp,
        operUp,
        speedGbps: eth?.state === 'link_up' ? eth.speedGbps : 0,
        driver: 'e1000e',
        bdf: '00:1f.6',
        addr: eff.address ? { ip: eff.address, prefix: eff.prefix, scope: eff.source === 'apipa' ? 'link' : 'global', dynamic: eff.source === 'dhcp' } : undefined,
      },
    ];
  }
  const eq = shellHost(ctx);
  return netInterfaces(s, eq).map((i) => ({
    ...i,
    addr: i.kind === 'loopback' ? { ip: '127.0.0.1', prefix: 8, scope: 'global' as const, dynamic: false } : i.port?.ip && i.adminUp ? { ip: i.port.ip.address, prefix: i.port.ip.prefix, scope: 'global' as const, dynamic: false } : undefined,
  }));
}

function flagsOf(i: NetIf): string {
  if (i.kind === 'loopback') return '<LOOPBACK,UP,LOWER_UP>';
  const base = ['BROADCAST', 'MULTICAST'];
  if (!i.adminUp) return `<${base.join(',')}>`;
  return i.operUp ? `<${[...base, 'UP', 'LOWER_UP'].join(',')}>` : `<NO-CARRIER,${base.join(',')},UP>`;
}

function stateOf(i: NetIf): string {
  if (i.kind === 'loopback') return 'UNKNOWN';
  return i.operUp ? 'UP' : 'DOWN';
}

function linkLine(i: NetIf): string {
  if (i.kind === 'loopback') return '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00';
  if (i.kind === 'infiniband') return `    link/infiniband ${i.mac} brd 00:ff:ff:ff:ff:12:40:1b:ff:ff:00:00:00:00:00:00:ff:ff:ff:ff`;
  return `    link/ether ${i.mac} brd ff:ff:ff:ff:ff:ff`;
}

function brd(ip: string, prefix: number): string {
  return intToIp((ipToInt(ip) | (~maskOf(prefix) >>> 0)) >>> 0);
}

function routesOf(ctx: CommandContext): string[] {
  const out: string[] = [];
  for (const i of interfacesOf(ctx)) {
    if (i.kind === 'loopback' || !i.addr || !i.adminUp) continue;
    const net = intToIp((ipToInt(i.addr.ip) & maskOf(i.addr.prefix)) >>> 0);
    const down = i.operUp ? '' : ' linkdown';
    const gw = ctx.frame.kind === 'laptop' ? ctx.state.workstation.effective.gateway : (i.port?.ip?.gateway ?? '');
    const proto = i.addr.dynamic ? 'dhcp' : 'static';
    const metric = ctx.frame.kind === 'laptop' ? ' metric 100' : '';
    if (gw) out.push(`default via ${gw} dev ${i.name} proto ${proto}${i.addr.dynamic ? ` src ${i.addr.ip}` : ''}${metric}${down}`);
    out.push(`${net}/${i.addr.prefix} dev ${i.name} proto kernel scope link src ${i.addr.ip}${metric}${down}`);
  }
  return out;
}

function ipCommand(ctx: CommandContext): CommandResult {
  const args = ctx.argv.slice(1);
  const brief = args.includes('-br') || args.includes('-brief');
  const stats = args.includes('-s') || args.includes('-stats');
  const detail = args.includes('-d') || args.includes('-details');
  const rest = args.filter((a) => !/^-(br|brief|s|stats|d|details|4|6|c|color)$/.test(a) && !a.startsWith('-color'));
  const [obj = '', verb = '', ...tail] = rest;
  const devIdx = rest.indexOf('dev');
  const devName = devIdx >= 0 ? rest[devIdx + 1] : verb === 'show' && tail[0] ? tail[0] : undefined;
  const ifs = interfacesOf(ctx);
  const filtered = devName ? ifs.filter((i) => i.name === devName) : ifs;
  if (devName && !filtered.length) return err(`Device "${devName}" does not exist.`);

  const isObj = (o: string, ...names: string[]) => names.some((n) => n.startsWith(o) && o.length > 0);
  if (!obj || obj === 'help') return ok(['Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }', 'where  OBJECT := { address | link | route | neigh }', '       OPTIONS := { -br[ief] | -s[tatistics] | -d[etails] }']);

  if (isObj(obj, 'address', 'addr') || obj === 'a') {
    if (brief) return ok(filtered.map((i) => `${i.name.padEnd(16)} ${stateOf(i).padEnd(14)} ${i.addr ? `${i.addr.ip}/${i.addr.prefix}` : ''}`.trimEnd()));
    const out: string[] = [];
    for (const i of filtered) {
      out.push(`${i.index}: ${i.name}: ${flagsOf(i)} mtu ${i.mtu} qdisc ${i.kind === 'loopback' ? 'noqueue' : 'mq'} state ${stateOf(i)} group default qlen ${i.kind === 'infiniband' ? 256 : 1000}`);
      out.push(linkLine(i));
      if (i.addr) {
        const scope = i.kind === 'loopback' ? 'host' : i.addr.scope;
        out.push(`    inet ${i.addr.ip}/${i.addr.prefix}${i.kind === 'loopback' ? '' : ` brd ${brd(i.addr.ip, i.addr.prefix)}`} scope ${scope}${i.addr.dynamic ? ' dynamic' : ''} ${i.name}`);
        out.push(i.addr.dynamic ? '       valid_lft 86213sec preferred_lft 86213sec' : '       valid_lft forever preferred_lft forever');
      }
    }
    return ok(out);
  }

  if (isObj(obj, 'link') || obj === 'l') {
    if (verb === 'set') {
      const name = devName ?? tail[0];
      const want = rest.includes('up') ? true : rest.includes('down') ? false : null;
      if (!name || want === null) return usage('ip link set', 'dev IFNAME { up | down }');
      if (!ctx.root) return err('RTNETLINK answers: Operation not permitted');
      if (ctx.frame.kind === 'laptop') {
        if (name !== 'eth0') return err(`Cannot find device "${name}"`);
        const r = ctx.dispatch({ type: 'workstation/configure', net: { adminUp: want } });
        return r.ok ? ok([]) : err(`RTNETLINK answers: ${r.message}`);
      }
      const i = findInterface(ctx.state, shellHost(ctx), name);
      if (!i) return err(`Cannot find device "${name}"`);
      if (i.kind === 'loopback') return ok([]);
      const r = ctx.dispatch({ type: 'host/setLinkAdmin', portId: (i.port as Port).id, up: want });
      return r.ok ? ok([]) : err(`RTNETLINK answers: ${r.message}`);
    }
    if (brief) return ok(filtered.map((i) => `${i.name.padEnd(16)} ${stateOf(i).padEnd(14)} ${i.kind === 'infiniband' ? i.mac.slice(-23) : i.mac} ${flagsOf(i)}`));
    const out: string[] = [];
    const up = ctx.frame.kind === 'host' ? bootInfo(ctx.state, shellHost(ctx)).upMs / 1000 : 3600;
    for (const i of filtered) {
      out.push(`${i.index}: ${i.name}: ${flagsOf(i)} mtu ${i.mtu} qdisc ${i.kind === 'loopback' ? 'noqueue' : 'mq'} state ${stateOf(i)} mode DEFAULT group default qlen ${i.kind === 'infiniband' ? 256 : 1000}`);
      out.push(linkLine(i));
      if (detail && i.name === 'eth0' && ctx.frame.kind === 'laptop' && ctx.state.workstation.net.vlan) out.push(`    vlan protocol 802.1Q id ${ctx.state.workstation.net.vlan} (tag applied by the Network settings app)`);
      if (stats) {
        const rate = i.operUp ? (i.kind === 'loopback' ? 2_000 : 180_000) : 0;
        const bytes = Math.round(up * rate);
        out.push('    RX:  bytes packets errors dropped  missed   mcast', `    ${String(bytes).padStart(10)} ${String(Math.round(bytes / 900)).padStart(7)}      0       0       0 ${String(Math.round(up / 30)).padStart(7)}`);
        out.push('    TX:  bytes packets errors dropped carrier collsns', `    ${String(Math.round(bytes * 0.6)).padStart(10)} ${String(Math.round(bytes / 1400)).padStart(7)}      0       0       0       0`);
      }
    }
    return ok(out);
  }

  if (isObj(obj, 'route') || obj === 'r') {
    if (verb === 'get') {
      const dst = tail[0];
      if (!dst || !isIpv4(dst)) return err('Error: inet prefix is expected rather than "' + (dst ?? '') + '".');
      const i = interfacesOf(ctx).find((x) => x.kind !== 'loopback' && x.addr && x.adminUp);
      if (!i?.addr) return err('RTNETLINK answers: Network is unreachable');
      if (sameSubnet(i.addr.ip, dst, i.addr.prefix)) return ok([`${dst} dev ${i.name} src ${i.addr.ip} uid 1000`, '    cache']);
      const gw = ctx.frame.kind === 'laptop' ? ctx.state.workstation.effective.gateway : i.port?.ip?.gateway;
      if (!gw) return err('RTNETLINK answers: Network is unreachable');
      return ok([`${dst} via ${gw} dev ${i.name} src ${i.addr.ip} uid 1000`, '    cache']);
    }
    return ok(routesOf(ctx));
  }

  if (isObj(obj, 'neighbour', 'neighbor') || obj === 'n') {
    const out: string[] = [];
    const cache = snapshotCache(ctx.state);
    const i = interfacesOf(ctx).find((x) => x.kind !== 'loopback' && x.addr && x.adminUp);
    const gw = ctx.frame.kind === 'laptop' ? ctx.state.workstation.effective.gateway : i?.port?.ip?.gateway;
    if (i && gw) {
      const r = routeFrom(ctx.state, sourceOf(ctx), gw, cache);
      out.push(r.ok ? `${gw} dev ${i.name} lladdr ${macFor(`gw/${gw}`)} REACHABLE` : `${gw} dev ${i.name} FAILED`);
    }
    return ok(out);
  }
  return err(`Object "${obj}" is unknown, try "ip help".`);
}

function sshCommand(ctx: CommandContext): CommandResult {
  const args = ctx.argv.slice(1);
  let user: string | undefined;
  let port = 22;
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-l') user = args[++i];
    else if (a === '-p') port = Number(args[++i]);
    else if (a === '-o' || a === '-i' || a === '-J' || a === '-F') i++;
    else if (/^-[46AaCfGgKkMNnqsTtVvXxYy]+$/.test(a)) continue;
    else {
      pos.push(...args.slice(i));
      break;
    }
  }
  const target = pos[0];
  if (!target) return err(['usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-l login_name] [-p port] destination [command [argument ...]]'], 255);
  const at = target.lastIndexOf('@');
  const host = at >= 0 ? target.slice(at + 1) : target;
  user = at >= 0 ? target.slice(0, at) : (user ?? ctx.frame.user);
  const remote = pos.slice(1).join(' ');
  if (port !== 22) return err(`ssh: connect to host ${host} port ${port}: Connection refused`, 255);

  const s = ctx.state;
  const src = sourceOf(ctx);
  const r = sshFrom(s, src, host, user, snapshotCache(s));
  if (!r.ok || !r.endpoint) return { stdout: [], stderr: r.lines, exit: 255 };
  const e = r.endpoint;
  const lines: string[] = [];
  let session = ctx.session;
  if (ctx.frame.kind === 'laptop' && !session.knownHosts.includes(host)) {
    lines.push(`Warning: Permanently added '${host}' (ED25519) to the list of known hosts.`);
    session = { ...session, knownHosts: [...session.knownHosts, host] };
  }
  const banner = r.lines.filter((l) => !l.startsWith('Warning: Permanently') && !l.startsWith('Authenticated to'));
  while (banner[0] === '') banner.shift();

  if (e.kind === 'switch') return ok([...lines, ...banner, `Connection to ${host} closed.`], { session });
  if (e.kind === 'bmc') {
    const frame = { kind: 'bmc' as const, equipmentId: e.equipmentId, host: `${e.hostname}-bmc`, user, cwd: '/', via: 'ssh' as const, address: e.ip };
    if (remote) {
      const sub = ctx.subshell(pushFrame(session, frame), remote);
      return { stdout: [...lines, ...sub.lines], exit: sub.exit, session };
    }
    return ok([...lines, ...banner], { session: pushFrame(session, frame) });
  }
  const eq = s.equipment[e.equipmentId];
  const frame = { kind: 'host' as const, equipmentId: e.equipmentId, host: eq.hostname, user, cwd: user === 'root' ? '/root' : `/home/${user}`, via: 'ssh' as const, address: e.ip };
  if (remote) {
    const sub = ctx.subshell(pushFrame(session, frame), remote);
    return { stdout: [...lines, ...sub.lines], exit: sub.exit, session };
  }
  const from = ctx.frame.kind === 'laptop' ? s.workstation.effective.address : (netInterfaces(s, shellHost(ctx)).find((i) => i.port?.ip)?.port?.ip?.address ?? '');
  return ok([...lines, ...banner, ` * Kernel ${KERNEL} on ${eq.software.os}`, '', `Last login: ${dateString(wallClock(s, s.timeMs - 3_600_000 * 26))} from ${from}`], { session: pushFrame(session, frame) });
}

/** Open the host's serial console (laptop + console cable). */
function consoleCommand(ctx: CommandContext): CommandResult {
  const s = ctx.state;
  const name = ctx.argv[0];
  const device = ctx.argv.slice(1).find((a) => a.startsWith('/dev/')) ?? '/dev/ttyUSB0';
  const eqId = s.workstation.consoleEquipmentId;
  if (!eqId || device !== '/dev/ttyUSB0') {
    if (name === 'console') return err(`console: no serial console attached${s.workstation.consoleReason ? `: ${s.workstation.consoleReason}` : ' (plug a console cable into a laptop USB port and the device\'s console port)'}`);
    return err(name === 'screen' ? `Cannot exec '${device}': No such file or directory` : `${name}: cannot open ${device}: No such file or directory`);
  }
  const eq = s.equipment[eqId];
  const scr = consoleScreen(s, eqId);
  if (eq.kind === 'switch') return ok([...scr.lines, '', '(Switch CLI arrives with the Phase 5 network commands.)', '[screen is terminating]']);
  if (!OS_STATES.has(eq.state)) {
    return ok([`Connected to ${eq.hostname} serial console (115200 8N1).`, '', ...(scr.lines.length ? scr.lines : [`(${scr.status})`]), '', `(${scr.status}: no login prompt. Run ${name} again once the OS is up.)`, '[screen is terminating]']);
  }
  return ok([`Connected to ${eq.hostname} serial console (115200 8N1).`, '', ...scr.lines.slice(-3, -1), `${eq.hostname} login: dct`, 'Password: (vault DH01-LINUX)', '', 'Welcome to Ubuntu 24.04 LTS (simulated)'], {
    session: pushFrame(ctx.session, { kind: 'host', equipmentId: eqId, host: eq.hostname, user: 'dct', cwd: '/home/dct', via: 'serial' }),
  });
}

function hopName(s: SimulationState, ip: string): string {
  const e = listEndpoints(s).find((x) => x.ip === ip);
  return e ? e.dnsName : ip;
}

export const NETWORK_COMMANDS: CommandDef[] = [
  {
    name: 'ip',
    summary: 'Interfaces, addresses and routes (ip a, ip -br link, ip route, ip link set dev X down)',
    contexts: SHELLS,
    group: 'network',
    run: ipCommand,
  },
  {
    name: 'ping',
    summary: 'ICMP echo (default 4 packets, -c N)',
    contexts: SHELLS,
    group: 'network',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1), ['c', 'W', 'i', 'I', 's', 'w']);
      const host = f.positional[0];
      if (!host) return err(['ping: usage error: Destination address required'], 1);
      const count = Math.min(20, Math.max(1, Number(f.value('c') ?? 4) || 4));
      const r = pingFrom(ctx.state, sourceOf(ctx), host, count, snapshotCache(ctx.state));
      return r.ok ? ok(r.lines) : r.lines.length === 1 ? err(r.lines, 2) : { stdout: r.lines, exit: 1 };
    },
  },
  {
    name: 'traceroute',
    summary: 'Hop-by-hop path to a host',
    contexts: SHELLS,
    group: 'network',
    run: (ctx) => {
      const host = parseFlags(ctx.argv.slice(1), ['m', 'w', 'q']).positional[0];
      if (!host) return usage('traceroute', 'host');
      const s = ctx.state;
      const cache = snapshotCache(s);
      const src = sourceOf(ctx);
      const res = resolveFrom(s, src, host, cache);
      if (res.fail) return err([`${host}: ${res.fail.lines[0].split(': ').slice(1).join(': ') || 'Name or service not known'}`, `Cannot handle "host" cmdline arg \`${host}' on position 1 (argc 1)`], 2);
      const ip = res.ip as string;
      const r = routeFrom(s, src, ip, cache);
      if (r.code === 'powered_off' || r.code === 'no_carrier' || r.code === 'no_address' || r.message.startsWith('connect:')) return err(`connect: Network is unreachable`, 2);
      const out = [`traceroute to ${host} (${ip}), 30 hops max, 60 byte packets`];
      const t = (base: number, k: number) => `${(base + k * 0.031).toFixed(3)} ms`;
      const hop = (n: number, name: string, addr: string, base: number) => `${String(n).padStart(2)}  ${name} (${addr})  ${t(base, 0)}  ${t(base, 1)}  ${t(base, 2)}`;
      const gw = ctx.frame.kind === 'laptop' ? s.workstation.effective.gateway : (netInterfaces(s, shellHost(ctx)).find((i) => i.port?.ip)?.port?.ip?.gateway ?? '');
      let n = 1;
      if (r.ok) {
        if (r.routed) out.push(hop(n++, hopName(s, gw), gw, 0.21));
        out.push(hop(n, hopName(s, ip), ip, r.latencyMs));
        return ok(out);
      }
      if (r.code === 'unreachable' && !r.routed) {
        out.push(`${String(n).padStart(2)}  ${hopName(s, ip)} (${ip})  3071.245 ms !H  3071.198 ms !H  3071.188 ms !H`);
        return { stdout: out, exit: 1 };
      }
      if (r.routed) out.push(hop(n++, hopName(s, gw), gw, 0.21));
      for (; n <= 30; n++) out.push(`${String(n).padStart(2)}  * * *`);
      return { stdout: out, exit: 1 };
    },
  },
  {
    name: 'ethtool',
    summary: 'NIC link settings (ethtool IF, -i IF driver, -m IF module)',
    contexts: SHELLS,
    group: 'network',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1), []);
      const name = f.positional[0];
      if (!name) return err(['ethtool: bad command line argument(s)', "For more information run ethtool -h"], 1);
      const i = interfacesOf(ctx).find((x) => x.name === name);
      if (!i || i.kind === 'loopback') return err(`netlink error: no device matches name (offset 24)\nnetlink error: No such device`, 1);
      const port = i.port;
      if (f.has('i')) return ok([`driver: ${i.driver}`, `version: ${KERNEL}`, 'firmware-version: sim-1.0 (reference)', `bus-info: 0000:${i.bdf ?? '00:00.0'}`, 'supports-statistics: yes', 'supports-test: no']);
      if (f.has('S')) return err('ethtool: NIC statistics (-S) are not simulated yet; use ip -s link');
      const cable = port?.cableId ? ctx.state.cables[port.cableId] : undefined;
      const media = cable ? getCableModel(cable.modelId).media : undefined;
      if (f.has('m')) {
        if (!port) return err('Cannot get module EEPROM information: No such device');
        if (port.transceiver) {
          const x = getTransceiverModel(port.transceiver.modelId);
          return ok([`\tIdentifier                                : ${x.formFactor.toUpperCase()} (simulated EEPROM)`, `\tConnector                                 : ${x.receptacle === 'mpo12' ? 'MPO 1x12' : 'LC'}`, '\tVendor name                               : Generic (reference)', `\tVendor PN                                 : ${x.name}`, `\tVendor SN                                 : ${port.transceiver.serial}`, `\tLaser wavelength                          : ${x.media === 'smf' ? '1310nm' : '850nm'}`, `\tTransceiver reach                         : ${x.reachM} m`]);
        }
        if (media === 'dac' || media === 'aoc') return ok([`\tIdentifier                                : ${media === 'dac' ? 'Direct attach copper cable assembly' : 'Active optical cable assembly'} (simulated EEPROM)`, `\tVendor PN                                 : ${getCableModel((cable as { modelId: string }).modelId).name}`, `\tLength (m)                                : ${getCableModel((cable as { modelId: string }).modelId).lengthM}`]);
        return err('Cannot get Module EEPROM data: No such device or address (no module in the cage)');
      }
      const portType = i.kind === 'infiniband' ? 'FIBRE' : !cable ? 'None' : media === 'dac' ? 'Direct Attach Copper' : media === 'copper' ? 'Twisted Pair' : 'FIBRE';
      const speeds = port?.speedsGbps ?? [1];
      const mode = (g: number) => (g >= 1 ? `${g * 1000}base${portType === 'Twisted Pair' ? 'T' : 'CR'}/Full` : `${g * 1000}baseT/Full`);
      return ok([
        `Settings for ${name}:`,
        `\tSupported ports: [ ${portType === 'Twisted Pair' ? 'TP' : portType === 'None' ? 'FIBRE' : portType === 'FIBRE' ? 'FIBRE' : 'DA'} ]`,
        `\tSupported link modes:   ${speeds.map(mode).join('\n\t                        ')}`,
        `\tSpeed: ${i.operUp ? `${Math.round(i.speedGbps * 1000)}Mb/s` : 'Unknown!'}`,
        `\tDuplex: ${i.operUp ? 'Full' : 'Unknown! (255)'}`,
        `\tPort: ${portType}`,
        `\tAuto-negotiation: ${portType === 'Twisted Pair' ? 'on' : 'off'}`,
        `\tLink detected: ${i.operUp ? 'yes' : 'no'}`,
      ]);
    },
  },
  {
    name: 'ssh',
    summary: 'Secure shell to a BMC, host or switch (ssh admin@<host>-bmc)',
    contexts: SHELLS,
    group: 'network',
    run: sshCommand,
  },
  {
    name: 'console',
    summary: 'Serial console through the USB console cable (also: screen /dev/ttyUSB0)',
    contexts: ['laptop'],
    group: 'network',
    run: consoleCommand,
  },
  ...(['screen', 'minicom', 'picocom'] as const).map((name): CommandDef => ({ name, summary: 'Serial console', contexts: ['laptop'], group: 'network', hidden: true, run: consoleCommand })),
];
