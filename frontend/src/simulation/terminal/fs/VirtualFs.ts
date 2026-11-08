/**
 * Simulated, read-only filesystem. Directory entries and file contents are
 * functions of the simulation snapshot, so `cat /sys/class/net/<if>/operstate`
 * or `/var/log/syslog` always match the hardware state.
 */
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { prefixToMask } from '@/simulation/networking/ip';
import { hostsFileEntries } from '@/simulation/networking/Reachability';
import { laptopPort } from '@/simulation/workstation/Workstation';
import type { Equipment, SimulationState } from '@/types/simulation';
import {
  blockDevices,
  bootInfo,
  cpuInfo,
  formatKernelTs,
  gpuComponents,
  journal,
  KERNEL,
  kernelLog,
  loadAverage,
  memInfo,
  netInterfaces,
  syslogTime,
  wallClock,
} from '../os/HostOs';
import type { ShellFrame } from '../types';

export type FsNode =
  | { kind: 'dir'; entries: () => Record<string, FsNode> }
  | { kind: 'file'; read: () => string };

const dir = (entries: () => Record<string, FsNode>): FsNode => ({ kind: 'dir', entries });
const file = (read: () => string): FsNode => ({ kind: 'file', read });
const text = (lines: string[]): string => (lines.length ? `${lines.join('\n')}\n` : '');

export const OS_RELEASE = [
  'PRETTY_NAME="Ubuntu 24.04 LTS"',
  'NAME="Ubuntu"',
  'VERSION_ID="24.04"',
  'VERSION="24.04 LTS (Noble Numbat)"',
  'ID=ubuntu',
  'ID_LIKE=debian',
  'HOME_URL="https://www.ubuntu.com/"',
  '# DCT Simulator: simulated image, no real packages are installed.',
];

function syslogLines(s: SimulationState, eq: Equipment, kernelOnly: boolean): string[] {
  return journal(s, eq)
    .filter((j) => !kernelOnly || j.ident === 'kernel')
    .map((j) => `${syslogTime(wallClock(s, j.ms))} ${eq.hostname} ${j.ident}: ${j.text}`);
}

function sysNet(s: SimulationState, eq: Equipment | undefined, laptop: boolean): FsNode {
  return dir(() => {
    const out: Record<string, FsNode> = {};
    if (laptop) {
      const ws = s.workstation;
      const eth = laptopPort(s, 'eth0');
      const up = ws.net.adminUp && eth?.state === 'link_up';
      out.lo = dir(() => ({ operstate: file(() => 'unknown\n'), mtu: file(() => '65536\n'), address: file(() => '00:00:00:00:00:00\n') }));
      out.eth0 = dir(() => ({
        operstate: file(() => (up ? 'up\n' : 'down\n')),
        carrier: file(() => (eth?.state === 'link_up' ? '1\n' : '0\n')),
        speed: file(() => (eth?.state === 'link_up' ? `${Math.round(eth.speedGbps * 1000)}\n` : '-1\n')),
        mtu: file(() => '1500\n'),
      }));
      return out;
    }
    if (!eq) return out;
    for (const i of netInterfaces(s, eq)) {
      out[i.name] = dir(() => ({
        operstate: file(() => (i.kind === 'loopback' ? 'unknown\n' : i.operUp ? 'up\n' : 'down\n')),
        carrier: file(() => (i.kind === 'loopback' || i.port?.state === 'link_up' ? '1\n' : '0\n')),
        speed: file(() => (i.operUp && i.kind !== 'loopback' ? `${Math.round(i.speedGbps * 1000)}\n` : '-1\n')),
        address: file(() => `${i.mac}\n`),
        mtu: file(() => `${i.mtu}\n`),
        type: file(() => (i.kind === 'infiniband' ? '32\n' : i.kind === 'loopback' ? '772\n' : '1\n')),
      }));
    }
    return out;
  });
}

function hostRoot(s: SimulationState, eq: Equipment, frame: ShellFrame): FsNode {
  const home = frame.user === 'root' ? 'root' : frame.user;
  return dir(() => ({
    etc: dir(() => ({
      hostname: file(() => `${eq.hostname}\n`),
      'os-release': file(() => text(OS_RELEASE)),
      hosts: file(() => text(['127.0.0.1 localhost', `127.0.1.1 ${eq.hostname}`, '', '# Cluster data network (managed by DCIM)', ...hostsFileEntries(s).map((h) => `${h.ip.padEnd(15)} ${h.name}`)])),
      'resolv.conf': file(() => text(['# The data network has no DNS server: names resolve through /etc/hosts.', 'nameserver 127.0.0.53', 'options edns0 trust-ad'])),
      fstab: file(() => text(['# <file system>  <mount point>  <type>  <options>  <dump>  <pass>', '/dev/nvme0n1p2   /              ext4    errors=remount-ro  0  1', '/dev/nvme0n1p1   /boot/efi      vfat    umask=0077         0  1'])),
      'machine-id': file(() => `${eq.serial.replace(/[^0-9A-Z]/g, '').toLowerCase().padEnd(32, '0').slice(0, 32)}\n`),
    })),
    proc: dir(() => {
      const entries: Record<string, FsNode> = {
        version: file(() => `Linux version ${KERNEL} (simulated build) #1 SMP PREEMPT_DYNAMIC\n`),
        cmdline: file(() => `BOOT_IMAGE=/vmlinuz-${KERNEL} root=/dev/nvme0n1p2 ro quiet\n`),
        uptime: file(() => {
          const up = bootInfo(s, eq).upMs / 1000;
          return `${up.toFixed(2)} ${(up * cpuInfo(s, eq).cpus * 0.92).toFixed(2)}\n`;
        }),
        loadavg: file(() => `${loadAverage(s, eq).map((x) => x.toFixed(2)).join(' ')} 3/812 9011\n`),
        meminfo: file(() => {
          const m = memInfo(s, eq);
          const row = (k: string, v: number) => `${`${k}:`.padEnd(16)}${String(v).padStart(10)} kB`;
          return text([row('MemTotal', m.totalKiB), row('MemFree', m.freeKiB), row('MemAvailable', m.availableKiB), row('Buffers', Math.round(m.cacheKiB * 0.04)), row('Cached', Math.round(m.cacheKiB * 0.96)), row('Shmem', m.sharedKiB)]);
        }),
        cpuinfo: file(() => {
          const c = cpuInfo(s, eq);
          const out: string[] = [];
          for (let i = 0; i < c.cpus; i++) {
            if (c.arch === 'aarch64') out.push(`processor\t: ${i}`, 'BogoMIPS\t: 2000.00', 'Features\t: fp asimd evtstrm sha3 sm4 sve sve2 (simulated)', 'CPU implementer\t: 0x41', `model name\t: ${c.model}`, '');
            else out.push(`processor\t: ${i}`, `model name\t: ${c.model}`, `cpu MHz\t\t: ${c.mhz}.000`, `physical id\t: ${Math.floor(i / (c.cpus / c.sockets))}`, `cpu cores\t: ${c.coresPerSocket}`, '');
          }
          return text(out);
        }),
      };
      if (gpuComponents(s, eq).length && eq.software.gpuDriverLoaded) {
        entries.driver = dir(() => ({
          nvidia: dir(() => ({
            version: file(() => text([`NVRM version: NVIDIA UNIX Open Kernel Module for ${cpuInfo(s, eq).arch}  sim-3.0 (simulated driver)`, 'GCC version:  gcc version 13.2.0 (Ubuntu 13.2.0-23ubuntu4)'])),
          })),
        }));
      }
      return entries;
    }),
    sys: dir(() => ({ class: dir(() => ({ net: sysNet(s, eq, false) })) })),
    var: dir(() => ({
      log: dir(() => ({
        syslog: file(() => text(syslogLines(s, eq, false))),
        'kern.log': file(() => text(syslogLines(s, eq, true))),
        dmesg: file(() => text(kernelLog(s, eq).map((k) => `${formatKernelTs(k.t)} ${k.text}`))),
      })),
    })),
    dev: dir(() => {
      const out: Record<string, FsNode> = { null: file(() => ''), ttyS0: file(() => ''), ipmi0: file(() => '') };
      for (const b of blockDevices(s, eq)) {
        out[b.name] = file(() => '');
        for (const c of b.children ?? []) out[c.name] = file(() => '');
      }
      return out;
    }),
    home: dir(() => (home === 'root' ? {} : { [home]: dir(() => ({})) })),
    root: dir(() => ({})),
    tmp: dir(() => ({})),
    boot: dir(() => ({ [`vmlinuz-${KERNEL}`]: file(() => '') })),
    opt: dir(() => ({})),
    usr: dir(() => ({ bin: dir(() => ({})), lib: dir(() => ({})) })),
  }));
}

export const LAPTOP_README = [
  'Technician laptop (simulated)',
  '=============================',
  '',
  'Credentials are injected from the site vault; no passwords are typed:',
  '  admin   BMC / Redfish            (vault DH01-BMC)',
  '  dct     host operating systems   (vault DH01-LINUX)',
  '  netops  network switches         (vault DH01-NET)',
  '',
  'Typical paths into a server:',
  '  ssh admin@<host>-bmc       BMC CLI over the OOB network, then: sol activate',
  '  console                    serial console cable in a USB port',
  '  ssh dct@<data-ip>          only from the data network (OOB is firewalled)',
  '',
  'Type "help" for the command list.',
];

function laptopRoot(s: SimulationState): FsNode {
  return dir(() => ({
    etc: dir(() => ({
      hostname: file(() => 'tech-laptop\n'),
      'os-release': file(() => text(OS_RELEASE)),
      hosts: file(() => text(['127.0.0.1 localhost', '127.0.1.1 tech-laptop'])),
      'resolv.conf': file(() => {
        const dns = s.workstation.effective.dns;
        return text([`# ${s.workstation.effective.source === 'dhcp' ? 'Provided by DHCP' : 'Static configuration'}`, dns ? `nameserver ${dns}` : '# no DNS server configured', 'search dh01.lab']);
      }),
      netplan: dir(() => ({
        '01-eth0.yaml': file(() => {
          const n = s.workstation.net;
          return text([
            'network:',
            '  version: 2',
            '  ethernets:',
            '    eth0:',
            n.mode === 'dhcp' ? '      dhcp4: true' : `      addresses: [${n.address}/${n.prefix}]  # netmask ${prefixToMask(n.prefix)}`,
            ...(n.mode === 'static' && n.gateway ? [`      routes: [{to: default, via: ${n.gateway}}]`] : []),
            ...(n.vlan ? [`  # 802.1Q tag ${n.vlan} applied by the Network settings app`] : []),
          ]);
        }),
      })),
    })),
    home: dir(() => ({ dct: dir(() => ({ 'README.txt': file(() => text(LAPTOP_README)) })) })),
    proc: dir(() => ({ version: file(() => `Linux version ${KERNEL} (simulated build) #1 SMP PREEMPT_DYNAMIC\n`) })),
    sys: dir(() => ({ class: dir(() => ({ net: sysNet(s, undefined, true) })) })),
    dev: dir(() => {
      const out: Record<string, FsNode> = { null: file(() => '') };
      if (s.workstation.consoleEquipmentId) out.ttyUSB0 = file(() => '');
      return out;
    }),
    tmp: dir(() => ({})),
  }));
}

export function rootFor(s: SimulationState, frame: ShellFrame): FsNode | null {
  if (frame.kind === 'laptop') return laptopRoot(s);
  if (frame.kind === 'host') {
    const eq = s.equipment[frame.equipmentId];
    return eq ? hostRoot(s, eq, frame) : null;
  }
  return null;
}

export function homeOf(frame: ShellFrame): string {
  if (frame.kind === 'bmc') return '/';
  return frame.user === 'root' ? '/root' : `/home/${frame.user}`;
}

/** Normalize `path` against `cwd`; returns absolute path segments. */
export function resolvePath(cwd: string, path: string): string[] {
  const parts = (path.startsWith('/') ? path : `${cwd}/${path}`).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out;
}

export const toPath = (segs: string[]): string => `/${segs.join('/')}`;

export function lookup(root: FsNode, segs: string[]): FsNode | null {
  let node: FsNode = root;
  for (const seg of segs) {
    if (node.kind !== 'dir') return null;
    const next: FsNode | undefined = node.entries()[seg];
    if (!next) return null;
    node = next;
  }
  return node;
}

/** Human description used by `ls -l` style output. */
export function fsModel(eq: Equipment): string {
  return getEquipmentModel(eq.modelId).shortName;
}
