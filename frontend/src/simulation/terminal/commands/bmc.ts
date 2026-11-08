/**
 * BMC commands in the IPMI vocabulary (the same subcommands as ipmitool):
 * the BMC CLI over SSH, `ipmitool -I lanplus -H <bmc> -U admin ...` from the
 * laptop, and in-band `sudo ipmitool ...` on a host. All read the BMC
 * channel of the simulation and act through engine actions.
 */
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { installedComponents, isMainPowerOn, OS_STATES } from '@/simulation/core/SimulationState';
import { macFor } from '@/simulation/core/util';
import { prefixToMask } from '@/simulation/networking/ip';
import { listEndpoints, PROFILE_BY_USER, resolveFrom, routeFrom } from '@/simulation/networking/Reachability';
import { snapshotCache } from '@/simulation/networking/Vlan';
import { consoleScreen } from '@/simulation/workstation/Console';
import type { Equipment, SimAction, SimulationState } from '@/types/simulation';
import { wallClock } from '../os/HostOs';
import { dropHost, pushFrame } from '../Session';
import type { CommandContext, CommandDef, CommandResult } from '../types';
import { err, ok } from '../types';

export type IpmiMode = 'shell' | 'lan' | 'inband';

const pad2 = (n: number) => String(n).padStart(2, '0');

function selDate(s: SimulationState, ms: number): [string, string] {
  const d = wallClock(s, ms);
  return [`${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}/${d.getUTCFullYear()}`, `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`];
}

function sensorType(msg: string): string {
  if (/PSU|power|AC input/i.test(msg)) return 'Power Supply';
  if (/fan/i.test(msg)) return 'Fan';
  if (/temperature|thermal/i.test(msg)) return 'Temperature';
  if (/link|LAN|network/i.test(msg)) return 'LAN';
  if (/DIMM|ECC|memory/i.test(msg)) return 'Memory';
  if (/POST|boot/i.test(msg)) return 'System Firmware Progress';
  if (/drive|NVMe|disk/i.test(msg)) return 'Drive Slot';
  if (/GPU|Xid/i.test(msg)) return 'Add-in Card';
  if (/intrusion|lid/i.test(msg)) return 'Physical Security';
  return 'System Event';
}

function bmcPort(s: SimulationState, eq: Equipment) {
  return eq.portIds.map((id) => s.ports[id]).find((p) => p?.role === 'bmc');
}

function powerAction(ctx: CommandContext, eq: Equipment, verb: string, mode: IpmiMode): CommandResult {
  const on = isMainPowerOn(eq);
  const labels: Record<string, string> = { on: 'Up/On', off: 'Down/Off', cycle: 'Cycle', reset: 'Reset', soft: 'Soft' };
  if (verb === 'status') return ok([`Chassis Power is ${on ? 'on' : 'off'}`]);
  if (!labels[verb]) return err('chassis power Commands: status, on, off, cycle, reset, diag, soft');
  if ((verb === 'cycle' || verb === 'reset' || verb === 'soft') && !on) return err(`Set Chassis Power Control to ${labels[verb]} failed: Command not supported in present state`);
  const action: SimAction = verb === 'on' ? { type: 'equipment/power', equipmentId: eq.id, power: 'on' } : verb === 'off' || verb === 'soft' ? { type: 'equipment/power', equipmentId: eq.id, power: 'off' } : { type: 'equipment/powerCycle', equipmentId: eq.id };
  const r = ctx.dispatch(action);
  if (!r.ok) return err(`Set Chassis Power Control to ${labels[verb]} failed: ${r.message}`);
  const lines = [`Chassis Power Control: ${labels[verb]}`];
  if (mode === 'inband' && verb !== 'on') {
    lines.push('', `${eq.hostname} is going down: this shell ends with it.`);
    return ok(lines, { session: dropHost(ctx.session, eq.id) });
  }
  return ok(lines);
}

function sensors(s: SimulationState, eq: Equipment): string[][] {
  const rows: string[][] = [];
  const powered = isMainPowerOn(eq);
  rows.push(['Inlet Temp', eq.powerCapacityW > 0 ? `${Math.round(eq.inletC)} degrees C` : 'no reading', eq.powerCapacityW > 0 ? 'ok' : 'ns']);
  const model = getEquipmentModel(eq.modelId);
  for (const sl of model.slots) {
    const id = eq.slots[sl.id];
    const c = id ? s.components[id] : undefined;
    if (sl.category === 'cpu' || sl.category === 'gpu') {
      if (!c) continue;
      const name = sl.category === 'cpu' ? `CPU${sl.id.slice(3)} Temp` : `GPU${sl.id.slice(3)} Temp`;
      const lim = getComponentModel(c.modelId).thermal;
      const status = !powered ? 'ns' : c.temperatureC >= lim.criticalC ? 'cr' : c.temperatureC >= lim.warnC ? 'nc' : 'ok';
      rows.push([name, powered ? `${Math.round(c.temperatureC)} degrees C` : 'no reading', status]);
    }
    if (sl.category === 'fan') {
      if (!c) {
        rows.push([`${sl.label.replace(' ', '')} `.trim(), 'no reading', 'ns']);
        continue;
      }
      const failed = c.status === 'failed';
      rows.push([sl.label.replace(' ', ''), powered && !failed ? `${c.rpm ?? 0} RPM` : failed ? '0 RPM' : 'no reading', failed ? 'cr' : powered ? 'ok' : 'ns']);
    }
    if (sl.category === 'psu') {
      if (!c) {
        rows.push([`${sl.label.replace(' ', '')} Status`, 'Not present', 'ns']);
        continue;
      }
      const reading = c.conditions.some((x) => x.code === 'PSU_FAILED') ? 'Failure detected' : c.conditions.some((x) => x.code === 'PSU_NO_INPUT') ? 'Power Supply AC lost' : 'Presence detected';
      rows.push([`${sl.label.replace(' ', '')} Status`, reading, reading === 'Presence detected' ? 'ok' : 'cr']);
    }
  }
  rows.push(['Total Power', eq.powerCapacityW > 0 ? `${Math.round(eq.powerDemandW)} Watts` : 'no reading', eq.powerCapacityW > 0 ? 'ok' : 'ns']);
  return rows;
}

function solActivate(ctx: CommandContext, eq: Equipment, mode: IpmiMode, bmcAddress?: string): CommandResult {
  if (mode === 'inband') return err('Error: SOL activate is only available over the network (ipmitool -I lanplus)');
  const s = ctx.state;
  if (ctx.session.frames.some((f) => f.via === 'sol' && f.equipmentId === eq.id)) return err('Info: SOL payload already active on another session');
  const scr = consoleScreen(s, eq.id);
  const head = ['[SOL Session operational.  Use exit to return]', ''];
  if (!OS_STATES.has(eq.state)) {
    return ok([...head, ...(scr.lines.length ? scr.lines : [`(${scr.status})`]), '', `[SOL] ${scr.status}: no login prompt yet. Run 'sol activate' again once the OS is up.`]);
  }
  return ok([...head, ...scr.lines.slice(-3, -1), `${eq.hostname} login: dct`, 'Password: (vault DH01-LINUX)', '', 'Welcome to Ubuntu 24.04 LTS (simulated)'], {
    session: pushFrame(ctx.session, { kind: 'host', equipmentId: eq.id, host: eq.hostname, user: 'dct', cwd: '/home/dct', via: 'sol', address: bmcAddress }),
  });
}

/** Run one IPMI subcommand against `eq`'s BMC. */
export function ipmi(ctx: CommandContext, eq: Equipment, args: string[], mode: IpmiMode, bmcAddress?: string): CommandResult {
  const s = ctx.state;
  const [cmd = '', sub = '', ...rest] = args;
  switch (cmd) {
    case 'power':
      return powerAction(ctx, eq, sub || 'status', mode);
    case 'chassis': {
      if (sub === 'power') return powerAction(ctx, eq, rest[0] || 'status', mode);
      if (sub === 'identify') {
        const off = rest[0] === '0' || rest[0] === 'off';
        const r = ctx.dispatch({ type: 'equipment/setUid', equipmentId: eq.id, on: !off });
        return r.ok ? ok([`Chassis identify interval: ${off ? 'off' : rest[0] === 'force' || !rest[0] ? 'indefinite' : `${rest[0]} seconds`}`]) : err(r.message);
      }
      if (sub !== 'status') return err('Chassis Commands:  status, power, identify');
      const comps = installedComponents(s, eq);
      const has = (code: RegExp) => comps.some((c) => c.conditions.some((x) => code.test(x.code))) || eq.conditions.some((x) => code.test(x.code));
      return ok([
        `System Power         : ${isMainPowerOn(eq) ? 'on' : 'off'}`,
        `Power Overload       : ${eq.powerBrake ? 'true' : 'false'}`,
        'Power Interlock      : inactive',
        `Main Power Fault     : ${has(/^PSU_FAILED$/) ? 'true' : 'false'}`,
        'Power Control Fault  : false',
        'Power Restore Policy : always-on',
        `Last Power Event     : ${eq.thermalTrip ? 'Thermal trip' : ''}`,
        `Chassis Intrusion    : ${eq.chassisOpen ? 'active' : 'inactive'}`,
        'Front-Panel Lockout  : inactive',
        `Drive Fault          : ${has(/^DRIVE_FAILED$/) ? 'true' : 'false'}`,
        `Cooling/Fan Fault    : ${has(/^FAN_(FAILED|SLOT_EMPTY)$/) ? 'true' : 'false'}`,
      ]);
    }
    case 'sel': {
      const verb = sub || 'list';
      if (verb === 'info') {
        const last = eq.sel.at(-1);
        return ok(['SEL Information', 'Version          : 1.5 (v1.5, v2 compliant)', `Entries          : ${eq.sel.length}`, `Free Space       : ${(200 - eq.sel.length) * 16} bytes`, `Last Add Time    : ${last ? selDate(s, last.timeMs).join(' ') : 'Not Available'}`, 'Overflow         : false']);
      }
      if (verb === 'clear') return err('Clearing the SEL is disabled in the training lab: the log is evidence for work orders.');
      if (verb !== 'list' && verb !== 'elist') return err('SEL Commands:  info clear list elist');
      if (!eq.sel.length) return ok(['SEL has no entries']);
      return ok(
        eq.sel.map((e) => {
          const [date, time] = selDate(s, e.timeMs);
          const cleared = e.message.startsWith('cleared: ');
          return `${e.id.toString(16).padStart(4, ' ')} | ${date} | ${time} | ${sensorType(e.message)} | ${cleared ? e.message.slice(9) : e.message} | ${cleared ? 'Deasserted' : 'Asserted'}`;
        }),
      );
    }
    case 'sdr':
    case 'sensor': {
      const rows = sensors(s, eq);
      const want = sub === 'type' ? rest.join(' ').toLowerCase() : '';
      const filtered = want ? rows.filter((r) => (want.startsWith('temp') ? /Temp/.test(r[0]) : want.startsWith('fan') ? /^Fan/.test(r[0]) : want.startsWith('power') ? /PSU|Power/.test(r[0]) : true)) : rows;
      return ok(filtered.map((r) => `${r[0].padEnd(16)} | ${r[1].padEnd(19)} | ${r[2]}`));
    }
    case 'fru': {
      const model = getEquipmentModel(eq.modelId);
      const mb = installedComponents(s, eq).find((c) => c.category === 'motherboard');
      const out = [
        'FRU Device Description : Builtin FRU Device (ID 0)',
        ' Chassis Type          : Rack Mount Chassis',
        ` Chassis Serial        : ${eq.serial}`,
        ` Board Mfg             : ${model.manufacturer}`,
        ` Board Product         : ${mb ? getComponentModel(mb.modelId).name : model.name}`,
        ` Board Serial          : ${mb?.serial ?? 'Not available'}`,
        ` Product Manufacturer  : ${model.manufacturer}`,
        ` Product Name          : ${model.name}`,
        ` Product Serial        : ${eq.serial}`,
        ` Product Asset Tag     : ${eq.assetTag}`,
      ];
      let id = 1;
      for (const sl of model.slots) {
        if (sl.category !== 'psu') continue;
        const c = eq.slots[sl.id] ? s.components[eq.slots[sl.id] as string] : undefined;
        out.push('', `FRU Device Description : ${sl.label} (ID ${id++})`);
        if (!c) out.push(' Device not present (Requested sensor, data, or record not found)');
        else out.push(` Product Name          : ${getComponentModel(c.modelId).name}`, ` Product Serial        : ${c.serial}`);
      }
      return ok(out);
    }
    case 'mc': {
      if (sub === 'reset') return err('simulator: BMC resets are not modelled (the BMC keeps running).');
      if (sub !== 'info') return err('MC Commands:\n  reset <warm|cold>\n  info');
      return ok(['Device ID                 : 32', 'Device Revision           : 1', 'Firmware Revision         : 2.40', 'IPMI Version              : 2.0', 'Manufacturer ID           : 0', 'Manufacturer Name         : Generic (reference)', 'Product Name              : DC-SCM BMC (reference, simulated)', 'Device Available          : yes', 'Provides Device SDRs      : yes']);
    }
    case 'lan': {
      if (sub !== 'print') return err('LAN Commands:\n  print [<channel number>]');
      const p = bmcPort(s, eq);
      const ip = p?.ip;
      return ok([
        'Set in Progress         : Set Complete',
        `IP Address Source       : ${ip ? 'Static Address' : 'Unspecified'}`,
        `IP Address              : ${ip?.address ?? '0.0.0.0'}`,
        `Subnet Mask             : ${ip ? prefixToMask(ip.prefix) : '0.0.0.0'}`,
        `MAC Address             : ${macFor(`${eq.serial}/bmc`)}`,
        `Default Gateway IP      : ${ip?.gateway ?? '0.0.0.0'}`,
        `802.1q VLAN ID          : ${ip?.vlan ? ip.vlan : 'Disabled'}`,
        `Link                    : ${p?.state === 'link_up' ? `up (${p.speedGbps * 1000} Mb/s)` : `down${p?.reason ? ` (${p.reason})` : ''}`}`,
      ]);
    }
    case 'sol': {
      if (sub === 'activate') return solActivate(ctx, eq, mode, bmcAddress);
      if (sub === 'deactivate') return ok(['Info: SOL payload already de-activated']);
      if (sub === 'info') return ok(['Set in progress                 : set-complete', 'Enabled                         : true', 'Force Encryption                : true', 'Volatile Bit Rate (kbps)        : 115.2', 'Non-Volatile Bit Rate (kbps)    : 115.2']);
      return err('SOL Commands: info, activate, deactivate');
    }
    case '':
    case 'help':
      return ok(['Commands:', '\tpower      status | on | off | cycle | reset | soft', '\tchassis    status | identify [off]', '\tsel        list | elist | info', '\tsdr        [type temperature|fan|power]', '\tsensor     same as sdr', '\tfru        print', '\tmc         info', '\tlan        print', '\tsol        activate | info']);
    default:
      return err(`Invalid command: ${cmd}`);
  }
}

/** `ipmitool` in any shell: local CLI (BMC), lanplus (laptop/host) or in-band (host). */
function ipmitool(ctx: CommandContext): CommandResult {
  const args = ctx.argv.slice(1);
  let host: string | undefined;
  let user = 'dct';
  let iface = '';
  const sub: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-H') host = args[++i];
    else if (a === '-U') user = args[++i] ?? '';
    else if (a === '-I') iface = args[++i] ?? '';
    else if (a === '-P' || a === '-f' || a === '-p' || a === '-C' || a === '-L') i++;
    else if (a === '-E' || a === '-v') continue;
    else sub.push(a);
  }
  const s = ctx.state;
  if (ctx.frame.kind === 'bmc') return ipmi(ctx, s.equipment[ctx.frame.equipmentId], sub, 'shell');
  if (!host) {
    if (ctx.frame.kind === 'laptop') return err('Could not open device at /dev/ipmi0 or /dev/ipmi/0 or /dev/ipmidev/0: No such file or directory (the laptop has no BMC: use -I lanplus -H <bmc> -U admin)');
    if (!ctx.root) return err('Could not open device at /dev/ipmi0 or /dev/ipmi/0 or /dev/ipmidev/0: Permission denied');
    const eq = s.equipment[ctx.frame.equipmentId];
    if (!eq.bmcAlive) return err('Get Device ID command failed: 0xff Unspecified error (BMC not responding)');
    return ipmi(ctx, eq, sub, 'inband');
  }
  if (iface && iface !== 'lanplus' && iface !== 'lan') return err(`Invalid interface: ${iface}`);
  const cache = snapshotCache(s);
  const src = ctx.frame.kind === 'host' ? { kind: 'host' as const, equipmentId: ctx.frame.equipmentId } : { kind: 'laptop' as const };
  const res = resolveFrom(s, src, host, cache);
  const fail = err('Error: Unable to establish IPMI v2 / RMCP+ session');
  if (res.fail || !res.ip) return err(`Address lookup for ${host} failed`);
  const r = routeFrom(s, src, res.ip, cache);
  const e = listEndpoints(s).find((x) => x.ip === res.ip);
  if (!r.ok || !e || e.kind !== 'bmc' || !e.alive) return fail;
  if (PROFILE_BY_USER[user] !== 'bmc-admin') return fail;
  return ipmi(ctx, s.equipment[e.equipmentId], sub, 'lan', res.ip);
}

const SHELL_BMC = (name: string, summary: string): CommandDef => ({
  name,
  summary,
  contexts: ['bmc'],
  group: 'bmc',
  run: (ctx) => ipmi(ctx, ctx.state.equipment[ctx.frame.equipmentId], ctx.argv, 'shell'),
});

export const BMC_COMMANDS: CommandDef[] = [
  SHELL_BMC('power', 'Host power: status | on | off | cycle | reset | soft'),
  SHELL_BMC('chassis', 'Chassis status, identify LED'),
  SHELL_BMC('sel', 'System event log: list | elist | info'),
  SHELL_BMC('sdr', 'Sensor readings (temperatures, fans, PSUs, power)'),
  { ...SHELL_BMC('sensor', 'Sensor readings'), hidden: true },
  SHELL_BMC('fru', 'Field-replaceable unit inventory'),
  SHELL_BMC('mc', 'Management controller info'),
  SHELL_BMC('lan', 'BMC network settings: lan print'),
  SHELL_BMC('sol', 'Serial-over-LAN to the host OS: sol activate'),
  {
    name: 'ipmitool',
    summary: 'IPMI client: ipmitool -I lanplus -H <host>-bmc -U admin power status',
    contexts: ['laptop', 'host', 'bmc'],
    group: 'bmc',
    run: ipmitool,
  },
];
