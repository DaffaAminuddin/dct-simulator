/** System and hardware inspection commands for the host shell (plus a few on the laptop). */
import { getCableModel } from '@/data/cables/cableCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { laptopPorts } from '@/simulation/workstation/Workstation';
import type { Equipment } from '@/types/simulation';
import {
  blockDevices,
  bootInfo,
  type BlockDev,
  clockTime,
  cpuBusyPct,
  cpuInfo,
  formatKernelTs,
  formatUptime,
  gpuComponents,
  GT_PER_GEN,
  humanBytes,
  journal,
  KERNEL,
  kernelLog,
  loadAverage,
  type LogLevel,
  memInfo,
  netInterfaces,
  pciDevices,
  processes,
  services,
  syslogTime,
  wallClock,
} from '../os/HostOs';
import { dropHost } from '../Session';
import type { CommandContext, CommandDef, CommandResult } from '../types';
import { err, ok } from '../types';
import { C, fmtGiB, parseFlags, shellHost, table } from './util';

const HOST: CommandDef['contexts'] = ['host'];

function hostnameOf(ctx: CommandContext): string {
  return ctx.frame.kind === 'laptop' ? 'tech-laptop' : shellHost(ctx).hostname;
}

function uptimeLine(ctx: CommandContext, eq: Equipment): string {
  const up = bootInfo(ctx.state, eq).upMs;
  const la = loadAverage(ctx.state, eq).map((x) => x.toFixed(2)).join(', ');
  return ` ${clockTime(wallClock(ctx.state))} up ${formatUptime(up)},  1 user,  load average: ${la}`;
}

const LEVEL_RANK: Record<LogLevel, number> = { emerg: 0, err: 3, warn: 4, notice: 5, info: 6 };
const PRIORITY: Record<string, number> = { emerg: 0, alert: 1, crit: 2, err: 3, warning: 4, warn: 4, notice: 5, info: 6, debug: 7, '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7 };

function unitName(name: string): string {
  const n = name === 'sshd' || name === 'sshd.service' ? 'ssh' : name;
  return n.includes('.') ? n : `${n}.service`;
}

/** Reboot / power-off from the OS: dispatch, then the connection to this host ends. */
function osPower(ctx: CommandContext, kind: 'reboot' | 'poweroff', label: string): CommandResult {
  if (!ctx.root) return err(['Failed to set wall message, ignoring: Interactive authentication required.', `Call to ${kind === 'reboot' ? 'Reboot' : 'PowerOff'} failed: Interactive authentication required.`], 1);
  const eq = shellHost(ctx);
  const r = ctx.dispatch(kind === 'reboot' ? { type: 'equipment/powerCycle', equipmentId: eq.id } : { type: 'equipment/power', equipmentId: eq.id, power: 'off' });
  if (!r.ok) return err(`${label}: ${r.message}`);
  const d = wallClock(ctx.state);
  const lines = [
    '',
    `Broadcast message from root@${eq.hostname} on pts/0 (${d.toISOString().slice(0, 19).replace('T', ' ')} UTC):`,
    '',
    `The system will ${kind === 'reboot' ? 'reboot' : 'power off'} now!`,
    '',
  ];
  const hostFrame = ctx.session.frames.find((f, i) => i > 0 && f.kind === 'host' && f.equipmentId === eq.id && !f.sudoShell);
  if (hostFrame?.via === 'ssh') lines.push(`Connection to ${hostFrame.address ?? hostFrame.host} closed by remote host.`, `Connection to ${hostFrame.address ?? hostFrame.host} closed.`);
  else if (hostFrame?.via === 'sol') lines.push(`[SOL] ${eq.hostname} is going down. Run 'sol activate' again once the OS is back up.`);
  else if (hostFrame?.via === 'serial') lines.push(`${eq.hostname}: console output continues during ${kind === 'reboot' ? 'POST and boot' : 'shutdown'}. Run 'console' again once the OS is up.`, '[screen is terminating]');
  return ok(lines, { session: dropHost(ctx.session, eq.id) });
}

function lsblkRows(devs: BlockDev[], cols: string[], noDeps: boolean): string[][] {
  const rows: string[][] = [cols];
  let minor = 0;
  const walk = (d: BlockDev, prefix: string) => {
    const cells: Record<string, string> = {
      NAME: prefix + d.name,
      'MAJ:MIN': d.type === 'raid0' ? '9:0' : `259:${minor++}`,
      RM: '0',
      SIZE: humanBytes(d.bytes),
      RO: '0',
      TYPE: d.type,
      MOUNTPOINTS: d.mount ?? '',
      MOUNTPOINT: d.mount ?? '',
      MODEL: d.model,
      SERIAL: d.serial,
      TRAN: d.tran,
    };
    rows.push(cols.map((c) => cells[c] ?? ''));
    if (noDeps) return;
    (d.children ?? []).forEach((c, i, a) => walk(c, `${prefix.replace(/[├└]─$/, (m) => (m === '├─' ? '│ ' : '  '))}${i === a.length - 1 ? '└─' : '├─'}`));
  };
  devs.forEach((d) => walk(d, ''));
  return rows;
}

export const SYSTEM_COMMANDS: CommandDef[] = [
  {
    name: 'uname',
    summary: 'Kernel and machine information (-a -r -m -n)',
    contexts: ['laptop', 'host'],
    group: 'system',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1));
      const arch = ctx.frame.kind === 'laptop' ? 'x86_64' : cpuInfo(ctx.state, shellHost(ctx)).arch;
      const host = hostnameOf(ctx);
      if (f.has('a', 'all')) return ok([`Linux ${host} ${KERNEL} #1 SMP PREEMPT_DYNAMIC (simulated) ${arch} ${arch} ${arch} GNU/Linux`]);
      const parts: string[] = [];
      if (f.has('s') || (!f.has('n', 'r', 'm', 'o'))) parts.push('Linux');
      if (f.has('n')) parts.push(host);
      if (f.has('r')) parts.push(KERNEL);
      if (f.has('m')) parts.push(arch);
      if (f.has('o')) parts.push('GNU/Linux');
      return ok([parts.join(' ')]);
    },
  },
  {
    name: 'hostname',
    summary: 'Host name (-I for addresses)',
    contexts: ['laptop', 'host'],
    group: 'system',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1));
      if (f.has('I', 'i')) {
        if (ctx.frame.kind === 'laptop') return ok([ctx.state.workstation.effective.address ? `${ctx.state.workstation.effective.address} ` : '']);
        const ips = netInterfaces(ctx.state, shellHost(ctx))
          .filter((i) => i.port?.ip && i.operUp)
          .map((i) => i.port?.ip?.address);
        return ok([ips.length ? `${ips.join(' ')} ` : '']);
      }
      if (f.has('f')) return ok([`${hostnameOf(ctx)}.dh01.lab`]);
      return ok([hostnameOf(ctx)]);
    },
  },
  {
    name: 'uptime',
    summary: 'Time since boot and load average',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      const eq = shellHost(ctx);
      if (parseFlags(ctx.argv.slice(1)).has('p')) {
        const ms = bootInfo(ctx.state, eq).upMs;
        const d = Math.floor(ms / 86_400_000);
        const h = Math.floor((ms % 86_400_000) / 3_600_000);
        const m = Math.floor((ms % 3_600_000) / 60_000);
        return ok([`up ${[d ? `${d} day${d === 1 ? '' : 's'}` : '', h ? `${h} hour${h === 1 ? '' : 's'}` : '', `${m} minute${m === 1 ? '' : 's'}`].filter(Boolean).join(', ')}`]);
      }
      return ok([uptimeLine(ctx, eq)]);
    },
  },
  {
    name: 'ps',
    summary: 'Process list (ps aux, ps -ef)',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      const eq = shellHost(ctx);
      const procs = processes(ctx.state, eq, ctx.frame.user);
      const arg = ctx.argv.slice(1).join(' ');
      const self = { pid: 9050, user: ctx.root ? 'root' : ctx.frame.user, cmd: ctx.argv.join(' ') };
      if (/aux|-e/.test(arg) || arg.includes('ax')) {
        if (arg.includes('-ef') || arg.includes('-e')) {
          const rows = [['UID', 'PID', 'PPID', 'C', 'STIME', 'TTY', 'TIME', 'CMD']];
          for (const p of procs) rows.push([p.user.slice(0, 8), String(p.pid), p.pid === 1 ? '0' : '1', String(Math.round(p.cpu)), p.start, p.tty, `00:${p.time.padStart(5, '0')}`, p.cmd]);
          rows.push([self.user, String(self.pid), '9011', '0', clockTime(wallClock(ctx.state)).slice(0, 5), 'pts/0', '00:00:00', self.cmd]);
          return ok(table(rows, [1, 2, 3]));
        }
        const rows = [['USER', 'PID', '%CPU', '%MEM', 'VSZ', 'RSS', 'TTY', 'STAT', 'START', 'TIME', 'COMMAND']];
        for (const p of procs) rows.push([p.user.slice(0, 8), String(p.pid), p.cpu.toFixed(1), p.mem.toFixed(1), String(p.vszKiB), String(p.rssKiB), p.tty, p.stat, p.start, p.time, p.cmd]);
        rows.push([self.user, String(self.pid), '0.0', '0.0', '11004', '4480', 'pts/0', 'R+', clockTime(wallClock(ctx.state)).slice(0, 5), '0:00', self.cmd]);
        return ok(table(rows, [1, 2, 3, 4, 5]));
      }
      return ok(table([['PID', 'TTY', 'TIME', 'CMD'], ['9011', 'pts/0', '00:00:00', 'bash'], ['9050', 'pts/0', '00:00:00', 'ps']], [0]));
    },
  },
  {
    name: 'top',
    summary: 'One snapshot of load, memory and top processes',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      const eq = shellHost(ctx);
      const m = memInfo(ctx.state, eq);
      const procs = processes(ctx.state, eq, ctx.frame.user).sort((a, b) => b.cpu - a.cpu);
      const busy = cpuBusyPct(eq);
      const mib = (k: number) => (k / 1024).toFixed(1).padStart(9);
      const lines = [
        `top - ${uptimeLine(ctx, eq).trim()}`,
        `Tasks: ${procs.length + 290} total,   ${procs.filter((p) => p.stat.startsWith('R')).length + 1} running, ${procs.length + 289} sleeping,   0 stopped,   0 zombie`,
        `%Cpu(s): ${(busy * 0.9).toFixed(1).padStart(4)} us,  ${(busy * 0.1).toFixed(1)} sy,  0.0 ni, ${(100 - busy).toFixed(1).padStart(4)} id,  0.0 wa,  0.0 hi,  0.1 si,  0.0 st`,
        `MiB Mem : ${mib(m.totalKiB)} total, ${mib(m.freeKiB)} free, ${mib(m.usedKiB)} used, ${mib(m.cacheKiB)} buff/cache`,
        `MiB Swap:       0.0 total,       0.0 free,       0.0 used. ${mib(m.availableKiB)} avail Mem`,
        '',
      ];
      const rows = [['PID', 'USER', 'PR', 'NI', 'VIRT', 'RES', 'SHR', 'S', '%CPU', '%MEM', 'TIME+', 'COMMAND']];
      for (const p of procs.slice(0, 18)) rows.push([String(p.pid), p.user.slice(0, 8), '20', '0', String(p.vszKiB), String(p.rssKiB), String(Math.round(p.rssKiB * 0.2)), p.stat[0], p.cpu.toFixed(1), p.mem.toFixed(1), `${p.time}.00`, p.cmd.split(' ')[0].split('/').at(-1) ?? p.cmd]);
      return ok([...lines, ...table(rows, [0, 4, 5, 6, 8, 9, 10]), '', `${C.dim}(one batch iteration, like top -b -n 1: interactive top is not simulated)${C.reset}`]);
    },
  },
  {
    name: 'free',
    summary: 'Memory usage (-h -m -g)',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1));
      const unit = f.has('h', 'human') ? 'h' : f.has('g') ? 'g' : f.has('m') ? 'm' : 'k';
      const m = memInfo(ctx.state, shellHost(ctx));
      const v = (k: number) => fmtGiB(k, unit);
      return ok(table([['', 'total', 'used', 'free', 'shared', 'buff/cache', 'available'], ['Mem:', v(m.totalKiB), v(m.usedKiB), v(m.freeKiB), v(m.sharedKiB), v(m.cacheKiB), v(m.availableKiB)], ['Swap:', v(0), v(0), v(0)]], [1, 2, 3, 4, 5, 6], 3).map((l) => l.replace(/^ {3}/, '')));
    },
  },
  {
    name: 'df',
    summary: 'Filesystem usage (-h)',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      const human = parseFlags(ctx.argv.slice(1)).has('h');
      const eq = shellHost(ctx);
      const devs = blockDevices(ctx.state, eq);
      const m = memInfo(ctx.state, eq);
      const rows: [string, number, number, string][] = [['tmpfs', m.totalKiB * 1024 * 0.1, 3_500_000, '/run']];
      for (const d of devs) {
        for (const c of d.children ?? []) {
          if (c.mount === '/') rows.push([`/dev/${c.name}`, c.bytes, c.bytes * (0.04 + (eq.id.length % 7) / 100), '/']);
          if (c.mount === '/boot/efi') rows.push([`/dev/${c.name}`, c.bytes, 6_400_000, '/boot/efi']);
          if (c.mount === '/raid' && !rows.some((r) => r[3] === '/raid')) rows.push(['/dev/md0', c.bytes, c.bytes * 0.38, '/raid']);
        }
      }
      rows.push(['tmpfs', m.totalKiB * 1024 * 0.5, 0, '/dev/shm']);
      const out = [[human ? 'Filesystem' : 'Filesystem', human ? 'Size' : '1K-blocks', 'Used', 'Avail', 'Use%', 'Mounted on']];
      for (const [fs, size, used, mnt] of rows) {
        const fmt = (b: number) => (human ? humanBytes(b) : String(Math.round(b / 1024)));
        out.push([fs, fmt(size), fmt(used), fmt(size - used), `${Math.max(used > 0 ? 1 : 0, Math.round((used / size) * 100))}%`, mnt]);
      }
      return ok(table(out, [1, 2, 3, 4], 1));
    },
  },
  {
    name: 'lsblk',
    summary: 'Block devices (-d, -o NAME,SIZE,MODEL,SERIAL,...)',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1), ['o', 'output']);
      const cols = (f.value('o', 'output') ?? 'NAME,MAJ:MIN,RM,SIZE,RO,TYPE,MOUNTPOINTS').toUpperCase().split(',');
      const rows = lsblkRows(blockDevices(ctx.state, shellHost(ctx)), cols, f.has('d', 'nodeps'));
      return ok(table(rows, cols.map((c, i) => (['SIZE', 'RM', 'RO', 'MAJ:MIN'].includes(c) ? i : -1)).filter((i) => i >= 0), 1));
    },
  },
  {
    name: 'lscpu',
    summary: 'CPU architecture',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      const c = cpuInfo(ctx.state, shellHost(ctx));
      const row = (k: string, v: string | number, indent = 0) => `${' '.repeat(indent)}${`${k}:`.padEnd(26 - indent)}${v}`;
      return ok([
        row('Architecture', c.arch),
        row('CPU op-mode(s)', c.arch === 'x86_64' ? '32-bit, 64-bit' : '64-bit', 2),
        row('Byte Order', 'Little Endian', 2),
        row('CPU(s)', c.cpus),
        row('On-line CPU(s) list', `0-${c.cpus - 1}`, 2),
        row('Vendor ID', c.arch === 'aarch64' ? 'ARM' : 'Generic'),
        row('Model name', c.model, 2),
        row('Thread(s) per core', c.threadsPerCore, 4),
        row('Core(s) per socket', c.coresPerSocket, 4),
        row('Socket(s)', c.sockets, 4),
        ...(c.arch === 'x86_64' ? [row('CPU max MHz', `${c.mhz}.0000`, 4)] : []),
        'NUMA:',
        row('NUMA node(s)', c.sockets, 2),
        ...Array.from({ length: c.sockets }, (_, i) => row(`NUMA node${i} CPU(s)`, `${(i * c.cpus) / c.sockets}-${((i + 1) * c.cpus) / c.sockets - 1}`, 2)),
      ]);
    },
  },
  {
    name: 'lspci',
    summary: 'PCI devices (-v, -vv link status, -k drivers, -s BUS)',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1), ['s', 'd']);
      if (f.has('n', 'nn')) return err('lspci: numeric vendor/device IDs are not simulated (reference hardware has no real PCI IDs). Use lspci, lspci -v or lspci -k.');
      const sel = f.value('s')?.toLowerCase().replace(/^0000:/, '');
      const verbose = f.has('v') ? (ctx.argv.some((a) => a.includes('vv')) ? 2 : 1) : 0;
      const devs = pciDevices(ctx.state, shellHost(ctx)).filter((d) => !sel || d.bdf.startsWith(sel));
      const out: string[] = [];
      for (const d of devs) {
        out.push(`${d.bdf} ${d.cls}: ${d.vendor} ${d.name}${d.revFF ? ' (rev ff)' : ''}`);
        if (d.revFF && (verbose || f.has('k'))) {
          out.push('\t!!! Unknown header type 7f', '');
          continue;
        }
        if (verbose) {
          out.push(`\tSubsystem: ${d.vendor} Device (simulated)`, '\tFlags: bus master, fast devsel, latency 0');
          if (verbose >= 2 && d.link) {
            const down = d.link.width < d.link.maxWidth ? ' (downgraded)' : '';
            out.push('\tCapabilities: [40] Express Endpoint, MSI 00', `\t\tLnkCap:\tPort #0, Speed ${GT_PER_GEN[d.link.maxGen]}, Width x${d.link.maxWidth}`, `\t\tLnkSta:\tSpeed ${GT_PER_GEN[d.link.gen] ?? 'unknown'}, Width x${d.link.width}${down}`);
          }
        }
        if ((verbose || f.has('k')) && d.driver) out.push(`\tKernel driver in use: ${d.driver}`, `\tKernel modules: ${d.driver}`);
        if (verbose) out.push('');
      }
      return ok(out);
    },
  },
  {
    name: 'lsusb',
    summary: 'USB devices',
    contexts: ['laptop', 'host'],
    group: 'system',
    run: (ctx) => {
      const out = ['Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub'];
      if (ctx.frame.kind === 'laptop') {
        const consoleCable = laptopPorts(ctx.state).some((p) => p.type === 'usb_a' && p.cableId && getCableModel(ctx.state.cables[p.cableId].modelId).console);
        if (consoleCable) out.push('Bus 001 Device 003: ID 0000:0000 Generic USB-to-serial console adapter (reference)');
      } else out.push('Bus 001 Device 002: ID 0000:0000 Generic BMC virtual keyboard and mouse (reference)');
      out.push('Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub');
      return ok(out);
    },
  },
  {
    name: 'dmesg',
    summary: 'Kernel ring buffer (needs sudo; -T, -l err,warn)',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      if (!ctx.root) return err('dmesg: read kernel buffer failed: Operation not permitted', 1);
      const f = parseFlags(ctx.argv.slice(1), ['l', 'level']);
      if (f.has('w', 'follow')) return err('dmesg: following the log (-w) is not supported in the simulator; run it again instead');
      const eq = shellHost(ctx);
      const levels = f.value('l', 'level')?.split(',').map((l) => (l === 'warning' ? 'warn' : l));
      const { bootAtMs } = bootInfo(ctx.state, eq);
      const lines = kernelLog(ctx.state, eq).filter((k) => !levels || levels.includes(k.level) || (levels.includes('err') && k.level === 'emerg'));
      return ok(
        lines.map((k) => {
          const ts = f.has('T') ? `[${wallClock(ctx.state, bootAtMs + k.t * 1000).toUTCString().replace(' GMT', '')}]` : formatKernelTs(k.t);
          const color = ctx.tty && (k.level === 'err' || k.level === 'emerg') ? C.red : ctx.tty && k.level === 'warn' ? C.yellow : '';
          return `${ts} ${color}${k.text}${color ? C.reset : ''}`;
        }),
      );
    },
  },
  {
    name: 'journalctl',
    summary: 'System journal (-k, -u UNIT, -p err, -n N, -r)',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1), ['u', 'unit', 'p', 'priority', 'n', 'lines', 'since']);
      if (f.has('f', 'follow')) return err('journalctl: following the journal (-f) is not supported in the simulator; run it again instead');
      const eq = shellHost(ctx);
      let entries = journal(ctx.state, eq);
      if (f.has('k', 'dmesg')) entries = entries.filter((e) => e.ident === 'kernel');
      const unit = f.value('u', 'unit');
      if (unit) entries = entries.filter((e) => e.unit === unitName(unit));
      const prio = f.value('p', 'priority');
      if (prio !== undefined) {
        const max = PRIORITY[prio.split('..').at(-1) ?? prio];
        if (max === undefined) return err(`Failed to parse priority value: ${prio}`);
        entries = entries.filter((e) => LEVEL_RANK[e.level] <= max);
      }
      const n = f.value('n', 'lines');
      if (n !== undefined || f.has('e')) entries = entries.slice(-Number(n ?? 1000));
      if (f.has('r', 'reverse')) entries = [...entries].reverse();
      if (!entries.length) return ok(['-- No entries --']);
      return ok(
        entries.map((e) => {
          const color = ctx.tty && (e.level === 'err' || e.level === 'emerg') ? C.red : ctx.tty && e.level === 'warn' ? C.yellow : '';
          return `${syslogTime(wallClock(ctx.state, e.ms))} ${eq.hostname} ${e.ident}: ${color}${e.text}${color ? C.reset : ''}`;
        }),
      );
    },
  },
  {
    name: 'systemctl',
    summary: 'Services: status UNIT, list-units, --failed, is-active, reboot',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1), ['type', 'state']);
      const eq = shellHost(ctx);
      const [verb = 'list-units', ...units] = f.positional;
      const svcs = services(ctx.state, eq);
      const since = (svc: { active: string }) => {
        const d = wallClock(ctx.state, bootInfo(ctx.state, eq).bootAtMs + 5800);
        void svc;
        return `${d.toUTCString().slice(0, 3)} ${d.toISOString().slice(0, 19).replace('T', ' ')} UTC; ${formatUptime(ctx.state.timeMs - (bootInfo(ctx.state, eq).bootAtMs + 5800))} ago`;
      };
      if (verb === 'reboot') return osPower(ctx, 'reboot', 'systemctl');
      if (verb === 'poweroff' || verb === 'halt') return osPower(ctx, 'poweroff', 'systemctl');
      if (verb === 'list-units' || f.has('failed')) {
        const list = svcs.filter((s) => !(f.has('failed') || f.value('state') === 'failed') || s.active === 'failed');
        const rows = [['  UNIT', 'LOAD', 'ACTIVE', 'SUB', 'DESCRIPTION']];
        for (const s of list) rows.push([`${s.active === 'failed' ? '●' : ' '} ${s.unit}`, 'loaded', s.active, s.sub, s.description]);
        return ok([...table(rows), '', 'LOAD   = Reflects whether the unit definition was properly loaded.', 'ACTIVE = The high-level unit activation state, i.e. generalization of SUB.', 'SUB    = The low-level unit activation state, values depend on unit type.', '', `${list.length} loaded units listed.`]);
      }
      if (!units.length) return err(`Too few arguments.`);
      const name = unitName(units[0]);
      const svc = svcs.find((s) => s.unit === name);
      if (verb === 'is-active') return svc ? { stdout: [svc.active], exit: svc.active === 'active' ? 0 : 3 } : { stdout: ['inactive'], exit: 4 };
      if (!svc) return err(`Unit ${name} could not be found.`, 4);
      if (verb === 'status') {
        const dot = svc.active === 'active' ? (ctx.tty ? `${C.green}●${C.reset}` : '●') : ctx.tty ? `${C.red}×${C.reset}` : '×';
        const lines = [
          `${dot} ${svc.unit} - ${svc.description}`,
          `     Loaded: loaded (/usr/lib/systemd/system/${svc.unit}; enabled; preset: enabled)`,
          svc.active === 'active' ? `     Active: active (running) since ${since(svc)}` : `     Active: failed (Result: exit-code) since ${since(svc)}`,
        ];
        if (svc.pid) lines.push(`   Main PID: ${svc.pid} (${svc.unit.replace('.service', '').replace('ssh', 'sshd').replace('nvidia-dcgm', 'nv-hostengine')})`);
        const j = journal(ctx.state, eq).filter((e) => e.unit === svc.unit).slice(-5);
        if (j.length) lines.push('', ...j.map((e) => `${syslogTime(wallClock(ctx.state, e.ms))} ${eq.hostname} ${e.ident}: ${e.text}`));
        return { stdout: lines, exit: svc.active === 'active' ? 0 : 3 };
      }
      if (['start', 'restart', 'reload', 'try-restart'].includes(verb)) {
        if (!ctx.root) return err(`Failed to ${verb} ${name}: Interactive authentication required.`);
        if (svc.active === 'failed') return err([`Job for ${name} failed because the control process exited with error code.`, `See "systemctl status ${name}" and "journalctl -xeu ${name}" for details.`]);
        return ok([]);
      }
      if (['stop', 'disable', 'mask', 'enable'].includes(verb)) {
        if (!ctx.root) return err(`Failed to ${verb} ${name}: Interactive authentication required.`);
        return err(`${C.dim}simulator: '${verb}' is not modelled; service state follows the hardware and driver state.${C.reset}`);
      }
      return err(`Unknown command verb '${verb}'.`);
    },
  },
  {
    name: 'reboot',
    summary: 'Reboot the host (needs sudo)',
    contexts: HOST,
    group: 'system',
    run: (ctx) => osPower(ctx, 'reboot', 'reboot'),
  },
  ...(['poweroff', 'halt'] as const).map(
    (name): CommandDef => ({ name, summary: 'Power the host off (needs sudo)', contexts: HOST, group: 'system', hidden: name === 'halt', run: (ctx) => osPower(ctx, 'poweroff', name) }),
  ),
  {
    name: 'shutdown',
    summary: 'shutdown -r now | shutdown -h now (needs sudo)',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1));
      if (f.has('c')) return err('No scheduled shutdown to cancel.');
      const when = f.positional[0] ?? '+1';
      if (when !== 'now' && when !== '+0' && when !== '0') return err(`shutdown: scheduled shutdowns are not simulated; use 'shutdown ${f.has('r') ? '-r' : '-h'} now'`);
      return osPower(ctx, f.has('r', 'reboot') ? 'reboot' : 'poweroff', 'shutdown');
    },
  },
  {
    name: 'modprobe',
    summary: 'Load / unload kernel modules (modprobe [-r] nvidia)',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1));
      const mod = f.positional[0];
      if (!mod) return err('modprobe: ERROR: missing parameters. See -h.');
      const eq = shellHost(ctx);
      const nvidia = /^nvidia(_uvm|_drm|_modeset|_peermem)?$/.test(mod) || mod === 'nvidia-uvm';
      const known = nvidia || ['nvme', 'mlx5_core', 'mlx5_ib', 'ipmi_si', 'ipmi_devintf', 'ext4', 'refnic', 'refraid'].includes(mod);
      if (!known || (nvidia && !gpuComponents(ctx.state, eq).length)) return err(`modprobe: FATAL: Module ${mod} not found in directory /lib/modules/${KERNEL}`);
      if (!ctx.root) return err(`modprobe: ERROR: could not ${f.has('r') ? 'remove' : 'insert'} '${mod}': Operation not permitted`);
      if (!nvidia) return ok([]);
      const r = ctx.dispatch({ type: 'host/setGpuDriver', equipmentId: eq.id, loaded: !f.has('r', 'remove') });
      return r.ok ? ok([]) : err(`modprobe: ERROR: ${r.message}`);
    },
  },
  {
    name: 'lsmod',
    summary: 'Loaded kernel modules',
    contexts: HOST,
    group: 'system',
    run: (ctx) => {
      const eq = shellHost(ctx);
      const mods: [string, number, string][] = [
        ['ext4', 1_032_192, ''],
        ['nvme', 61_440, ''],
        ['ipmi_si', 86_016, ''],
        ['ipmi_devintf', 20_480, ''],
      ];
      const drivers = new Set(netInterfaces(ctx.state, eq).map((i) => i.driver).filter(Boolean));
      for (const d of drivers) mods.push([d, 2_330_624, '']);
      if (gpuComponents(ctx.state, eq).length && eq.software.gpuDriverLoaded) mods.push(['nvidia_uvm', 1_802_240, ''], ['nvidia_modeset', 1_634_304, ''], ['nvidia', 9_469_952, 'nvidia_uvm,nvidia_modeset']);
      return ok(table([['Module', 'Size', 'Used by'], ...mods.map(([m, sz, by]) => [m, String(sz), `${by ? by.split(',').length : 0} ${by}`.trim()])], [1]));
    },
  },
];

/** Hostname-independent model label (used by `hostnamectl`). */
export function modelLabel(eq: Equipment): string {
  const m = getEquipmentModel(eq.modelId);
  return `${m.manufacturer} ${m.name}`;
}
