/**
 * Host operating-system view: what Linux on a simulated host exposes through
 * the `os` and `driver` observation channels (SIMULATION_SPEC §1.2):
 * interfaces, PCI devices, block devices, memory, CPUs, processes, services,
 * the kernel ring buffer and the journal. Every function is a pure read of
 * the simulation snapshot, so terminal output can never disagree with the
 * racks, the BMC or the GPU views.
 */
import { XID_INFO } from '@/data/faults/faultCatalog';
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { OS_STATES } from '@/simulation/core/SimulationState';
import { hash32, macFor } from '@/simulation/core/util';
import { hasGpus } from '@/simulation/diagnostics/DiagnosticEngine';
import type { Component, Equipment, Fault, Port, SimulationState } from '@/types/simulation';

export const KERNEL = '6.8.0-generic';

export const isOsUp = (eq: Equipment | undefined): boolean => !!eq && OS_STATES.has(eq.state);

export function archOf(eq: Equipment): 'x86_64' | 'aarch64' {
  return eq.software.os.includes('aarch64') ? 'aarch64' : 'x86_64';
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const pad2 = (n: number) => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export function wallClock(s: SimulationState, ms: number = s.timeMs): Date {
  return new Date(Date.parse(s.startedAt) + ms);
}

/** `Nov 08 08:00:01` (journal / syslog). */
export function syslogTime(d: Date): string {
  return `${MON[d.getUTCMonth()]} ${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/** `Sun Nov  8 08:00:01 UTC 2026` (date). */
export function dateString(d: Date): string {
  return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}`;
}

export function clockTime(d: Date): string {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

export interface BootInfo {
  /** Simulated ms at which the current boot started (negative = before the scenario). */
  bootAtMs: number;
  upMs: number;
}

/** When the running OS booted: from the last boot transition, or a seeded uptime for hosts that were already up. */
export function bootInfo(s: SimulationState, eq: Equipment): BootInfo {
  const model = getEquipmentModel(eq.modelId);
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i];
    if (e.equipmentId === eq.id && /: booting → (running|degraded)$/.test(e.message)) {
      const bootAt = e.timeMs - model.bootTimeMs;
      return { bootAtMs: bootAt, upMs: s.timeMs - bootAt };
    }
  }
  const days = 9 + (hash32(eq.id) % 50);
  const extra = (hash32(`${eq.id}#up`) % 86400) * 1000;
  const bootAt = -(days * 86_400_000 + extra);
  return { bootAtMs: bootAt, upMs: s.timeMs - bootAt };
}

export function formatUptime(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const hm = h > 0 ? `${h}:${pad2(m)}` : `${m} min`;
  return days > 0 ? `${days} day${days === 1 ? '' : 's'}, ${hm}` : hm;
}

// ---------------------------------------------------------------------------
// Components visible to the OS
// ---------------------------------------------------------------------------

export function components(s: SimulationState, eq: Equipment): { comp: Component; slotId: string }[] {
  const model = getEquipmentModel(eq.modelId);
  const out: { comp: Component; slotId: string }[] = [];
  for (const sl of model.slots) {
    const id = eq.slots[sl.id];
    if (id && s.components[id]) out.push({ comp: s.components[id], slotId: sl.id });
  }
  return out;
}

/** The OS can talk to the device (it enumerated and has not failed). */
export function visibleToOs(c: Component | undefined): boolean {
  return !!c && c.status !== 'failed' && c.status !== 'not_detected' && c.status !== 'not_powered' && c.status !== 'in_inventory';
}

const slotNum = (slotId: string) => Number(/(\d+)$/.exec(slotId)?.[1] ?? 0);

// ---------------------------------------------------------------------------
// Network interfaces
// ---------------------------------------------------------------------------

export interface NetIf {
  name: string;
  index: number;
  kind: 'loopback' | 'ether' | 'infiniband';
  port?: Port;
  mac: string;
  mtu: number;
  adminUp: boolean;
  operUp: boolean;
  speedGbps: number;
  driver: string;
  bdf?: string;
}

function ibAddress(seed: string): string {
  const h = hash32(seed);
  const h2 = hash32(`${seed}#guid`);
  const guid = [h & 255, (h >>> 8) & 255, (h >>> 16) & 255, (h >>> 24) & 255, h2 & 255, (h2 >>> 8) & 255, (h2 >>> 16) & 255, (h2 >>> 24) & 255].map(hex2);
  return ['00', '00', '10', hex2(h2 & 63), 'fe', '80', '00', '00', '00', '00', '00', '00', ...guid].join(':');
}

/** Link-layer address the OS reports for a port: MAC for Ethernet, a 20-byte address for InfiniBand. */
export function portLinkAddress(eq: Equipment, p: Port): string {
  if (p.role === 'bmc') return macFor(`${eq.serial}/bmc`);
  return p.type === 'osfp' ? ibAddress(`${eq.serial}/${p.id}`) : macFor(`${eq.serial}/${p.id}`);
}

export function driverFor(modelName: string): string {
  return /ConnectX|BlueField/.test(modelName) ? 'mlx5_core' : 'refnic';
}

export function netInterfaces(s: SimulationState, eq: Equipment): NetIf[] {
  const out: NetIf[] = [{ name: 'lo', index: 1, kind: 'loopback', mac: '00:00:00:00:00:00', mtu: 65536, adminUp: true, operUp: true, speedGbps: 0, driver: '' }];
  if (!isOsUp(eq)) return out;
  const pci = new Map(pciDevices(s, eq).map((d) => [d.portId ?? '', d.bdf]));
  const ports = eq.portIds
    .map((id) => s.ports[id])
    .filter((p): p is Port => !!p && !!p.componentId && !!p.osName && (p.role === 'data' || p.role === 'fabric') && visibleToOs(s.components[p.componentId]))
    .sort((a, b) => (a.osName as string).localeCompare(b.osName as string, undefined, { numeric: true }));
  ports.forEach((p, i) => {
    const ib = p.type === 'osfp';
    const comp = s.components[p.componentId as string];
    out.push({
      name: p.osName as string,
      index: i + 2,
      kind: ib ? 'infiniband' : 'ether',
      port: p,
      mac: ib ? ibAddress(`${eq.serial}/${p.id}`) : macFor(`${eq.serial}/${p.id}`),
      mtu: ib ? 4092 : 1500,
      adminUp: p.adminUp,
      operUp: p.adminUp && p.state === 'link_up',
      speedGbps: p.state === 'link_up' ? p.speedGbps : 0,
      driver: driverFor(getComponentModel(comp.modelId).name),
      bdf: pci.get(p.id),
    });
  });
  return out;
}

export function findInterface(s: SimulationState, eq: Equipment, name: string): NetIf | undefined {
  return netInterfaces(s, eq).find((i) => i.name === name);
}

// ---------------------------------------------------------------------------
// PCI devices
// ---------------------------------------------------------------------------

export interface PciDevice {
  bdf: string;
  cls: string;
  vendor: string;
  name: string;
  slotId?: string;
  comp?: Component;
  portId?: string;
  /** Device stopped answering config reads (fallen off the bus). */
  revFF: boolean;
  driver?: string;
  link?: { gen: number; width: number; maxGen: number; maxWidth: number };
}

function vendorOf(manufacturer: string): string {
  if (manufacturer.startsWith('NVIDIA')) return 'NVIDIA Corporation';
  return manufacturer.replace(/\s*\(reference\)$/, '');
}

function genFrom(spec: unknown, fallback: number): number {
  const m = /Gen\s?(\d)/i.exec(String(spec ?? ''));
  return m ? Number(m[1]) : fallback;
}

export const GT_PER_GEN: Record<number, string> = { 1: '2.5GT/s', 2: '5GT/s', 3: '8GT/s', 4: '16GT/s', 5: '32GT/s', 6: '64GT/s' };

export function pciDevices(s: SimulationState, eq: Equipment): PciDevice[] {
  const out: PciDevice[] = [];
  if (!isOsUp(eq)) return out;
  const arch = archOf(eq);
  out.push({ bdf: '00:00.0', cls: 'Host bridge', vendor: 'Generic', name: arch === 'aarch64' ? 'Grace PCIe root complex (simulated)' : 'Root complex (simulated)', revFF: false });
  for (const { comp, slotId } of components(s, eq)) {
    const model = getComponentModel(comp.modelId);
    const vendor = vendorOf(model.manufacturer);
    const n = slotNum(slotId);
    switch (comp.category) {
      case 'bmc':
        if (comp.status === 'ok') out.push({ bdf: '0f:00.0', cls: 'VGA compatible controller', vendor: 'Generic', name: 'BMC video controller (reference)', comp, slotId, revFF: false });
        break;
      case 'riser':
        if (visibleToOs(comp)) out.push({ bdf: `${hex2(0x10 + n * 0x40)}:00.0`, cls: 'PCI bridge', vendor, name: model.name, comp, slotId, revFF: false, driver: 'pcieport' });
        break;
      case 'gpu': {
        const tel = comp.gpu;
        if (!tel) break;
        const fallen = comp.conditions.some((c) => c.code === 'GPU_FALLEN_OFF_BUS');
        if (!fallen && tel.lifecycle !== 'detected' && tel.lifecycle !== 'initialized') break;
        const pcie = String(model.specs.hostLink ?? '').includes('PCIe');
        out.push({
          bdf: tel.busId.slice(9).toLowerCase(),
          cls: '3D controller',
          // Driven by the NVIDIA driver, so the PCI vendor is NVIDIA even for the generic reference module.
          vendor: 'NVIDIA Corporation',
          name: model.name,
          comp,
          slotId,
          revFF: fallen,
          driver: !fallen && eq.software.gpuDriverLoaded ? 'nvidia' : undefined,
          link: pcie && !fallen ? { gen: tel.pcieGen, width: tel.pcieWidth, maxGen: 5, maxWidth: tel.pcieMaxWidth } : undefined,
        });
        break;
      }
      case 'nvme': {
        if (!visibleToOs(comp)) break;
        const bus = slotId === 'm2boot' ? 0x01 : 0x02 + n;
        const gen = genFrom(model.specs.interface, 4);
        out.push({ bdf: `${hex2(bus)}:00.0`, cls: 'Non-Volatile memory controller', vendor, name: model.name, comp, slotId, revFF: false, driver: 'nvme', link: { gen, width: 4, maxGen: gen, maxWidth: 4 } });
        break;
      }
      case 'raid':
        if (visibleToOs(comp)) out.push({ bdf: '98:00.0', cls: 'RAID bus controller', vendor, name: model.name, comp, slotId, revFF: false, driver: 'refraid', link: { gen: 4, width: 8, maxGen: 4, maxWidth: 8 } });
        break;
      case 'nic':
      case 'dpu': {
        if (!visibleToOs(comp)) break;
        const bus = slotId.startsWith('ocp') ? 0xa0 : slotId.startsWith('pcie') ? 0xa8 : comp.category === 'dpu' ? 0xf0 : 0xb0 + n * 0x10;
        const gen = genFrom(model.specs.hostInterface, 4);
        (model.ports ?? []).forEach((def, fn) => {
          out.push({
            bdf: `${hex2(bus)}:00.${fn}`,
            cls: def.type === 'osfp' ? 'Infiniband controller' : 'Ethernet controller',
            vendor,
            name: model.name,
            comp,
            slotId,
            portId: `${eq.id}:${slotId}.${def.id}`,
            revFF: false,
            driver: driverFor(model.name),
            link: { gen, width: 16, maxGen: gen, maxWidth: 16 },
          });
        });
        break;
      }
      default:
        break;
    }
  }
  return out.sort((a, b) => a.bdf.localeCompare(b.bdf));
}

// ---------------------------------------------------------------------------
// Block devices
// ---------------------------------------------------------------------------

export interface BlockDev {
  name: string;
  bytes: number;
  type: 'disk' | 'part' | 'raid0';
  model: string;
  serial: string;
  tran: 'nvme' | 'sas' | '';
  mount?: string;
  children?: BlockDev[];
  slotId?: string;
}

function bytesOf(specs: Record<string, string | number>): number {
  if (specs.capacityTB) return Number(specs.capacityTB) * 1e12;
  if (specs.capacityGB) return Number(specs.capacityGB) * 1e9;
  return 0;
}

export function blockDevices(s: SimulationState, eq: Equipment): BlockDev[] {
  if (!isOsUp(eq)) return [];
  const out: BlockDev[] = [];
  const comps = components(s, eq);
  const boot = comps.find((c) => c.slotId === 'm2boot');
  if (boot && visibleToOs(boot.comp)) {
    const m = getComponentModel(boot.comp.modelId);
    const total = bytesOf(m.specs);
    const efi = 1_127_219_200;
    out.push({
      name: 'nvme0n1',
      bytes: total,
      type: 'disk',
      model: m.name,
      serial: boot.comp.serial,
      tran: 'nvme',
      slotId: 'm2boot',
      children: [
        { name: 'nvme0n1p1', bytes: efi, type: 'part', model: '', serial: '', tran: '', mount: '/boot/efi' },
        { name: 'nvme0n1p2', bytes: total - efi, type: 'part', model: '', serial: '', tran: '', mount: '/' },
      ],
    });
  }
  const dataNvme = comps.filter((c) => c.comp.category === 'nvme' && c.slotId !== 'm2boot');
  const visibleNvme = dataNvme.filter((c) => visibleToOs(c.comp));
  const raid = hasGpus(eq) && dataNvme.length >= 2 && visibleNvme.length === dataNvme.length;
  const md: BlockDev | undefined = raid
    ? { name: 'md0', bytes: visibleNvme.reduce((n, c) => n + bytesOf(getComponentModel(c.comp.modelId).specs), 0), type: 'raid0', model: '', serial: '', tran: '', mount: '/raid' }
    : undefined;
  // Names follow the bay (nvme<bay+1>n1, sd<bay letter>) so a failed drive does not rename the others.
  visibleNvme.forEach((c) => {
    const m = getComponentModel(c.comp.modelId);
    out.push({ name: `nvme${slotNum(c.slotId) + 1}n1`, bytes: bytesOf(m.specs), type: 'disk', model: m.name, serial: c.comp.serial, tran: 'nvme', slotId: c.slotId, children: md ? [md] : undefined });
  });
  const sas = comps.filter((c) => c.comp.category === 'ssd' && visibleToOs(c.comp));
  sas.forEach((c) => {
    const m = getComponentModel(c.comp.modelId);
    out.push({ name: `sd${String.fromCharCode(97 + slotNum(c.slotId))}`, bytes: bytesOf(m.specs), type: 'disk', model: m.name, serial: c.comp.serial, tran: 'sas', slotId: c.slotId });
  });
  return out;
}

/** Linux-style binary size: `3.5T`, `894.3G`, `1G`. */
export function humanBytes(bytes: number, opts: { si?: boolean } = {}): string {
  const base = opts.si ? 1000 : 1024;
  const units = ['B', 'K', 'M', 'G', 'T', 'P'];
  let v = bytes;
  let u = 0;
  while (v >= base && u < units.length - 1) {
    v /= base;
    u++;
  }
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}${units[u]}`;
}

// ---------------------------------------------------------------------------
// CPU and memory
// ---------------------------------------------------------------------------

export interface CpuInfo {
  arch: 'x86_64' | 'aarch64';
  model: string;
  sockets: number;
  coresPerSocket: number;
  threadsPerCore: number;
  cpus: number;
  mhz: number;
}

export function cpuInfo(s: SimulationState, eq: Equipment): CpuInfo {
  const cpus = components(s, eq).filter((c) => c.comp.category === 'cpu' && visibleToOs(c.comp));
  const m = cpus[0] ? getComponentModel(cpus[0].comp.modelId) : undefined;
  const cores = Number(m?.specs.cores ?? 1);
  const threads = Number(m?.specs.threads ?? cores);
  const sockets = Math.max(1, cpus.length);
  return {
    arch: archOf(eq),
    model: m ? (m.id === 'cpu-grace' ? 'Neoverse-V2' : m.name) : 'unknown',
    sockets,
    coresPerSocket: cores,
    threadsPerCore: Math.max(1, Math.round(threads / cores)),
    cpus: sockets * threads,
    mhz: Math.round(Number(m?.specs.baseClockGHz ?? 3.1) * 1000),
  };
}

export interface MemInfo {
  totalKiB: number;
  usedKiB: number;
  freeKiB: number;
  sharedKiB: number;
  cacheKiB: number;
  availableKiB: number;
}

export function memInfo(s: SimulationState, eq: Equipment): MemInfo {
  let gib = 0;
  for (const { comp } of components(s, eq)) {
    if (!visibleToOs(comp)) continue;
    const m = getComponentModel(comp.modelId);
    if (comp.category === 'dimm') gib += Number(m.specs.capacityGB ?? 0);
    if (comp.category === 'cpu' && m.specs.memoryGB) gib += Number(m.specs.memoryGB);
  }
  const totalKiB = Math.round(gib * 1024 * 1024 * 0.984);
  const usedFrac = eq.workload === 'training' ? 0.58 : eq.workload === 'light' ? 0.27 : 0.05;
  const jitter = (hash32(eq.id) % 50) / 1000;
  const usedKiB = Math.round(totalKiB * (usedFrac + jitter));
  const cacheKiB = Math.round(totalKiB * 0.11);
  const sharedKiB = Math.round(totalKiB * 0.002);
  const freeKiB = Math.max(0, totalKiB - usedKiB - cacheKiB);
  return { totalKiB, usedKiB, freeKiB, sharedKiB, cacheKiB, availableKiB: freeKiB + Math.round(cacheKiB * 0.8) };
}

export function loadAverage(s: SimulationState, eq: Equipment): [number, number, number] {
  const cores = cpuInfo(s, eq).cpus;
  const base = eq.workload === 'training' ? cores * 0.31 : eq.workload === 'light' ? cores * 0.09 : 0.04;
  const j = (hash32(eq.id) % 20) / 100;
  return [base + j, base * 0.97 + j, base * 0.95 + j];
}

export function cpuBusyPct(eq: Equipment): number {
  return eq.workload === 'training' ? 34.2 : eq.workload === 'light' ? 11.6 : 0.7;
}

// ---------------------------------------------------------------------------
// Processes and services
// ---------------------------------------------------------------------------

export interface Proc {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  vszKiB: number;
  rssKiB: number;
  tty: string;
  stat: string;
  start: string;
  time: string;
  cmd: string;
}

export function gpuComponents(s: SimulationState, eq: Equipment): Component[] {
  return components(s, eq)
    .filter((c) => c.comp.category === 'gpu')
    .map((c) => c.comp)
    .sort((a, b) => (a.gpu?.index ?? 0) - (b.gpu?.index ?? 0));
}

/** GPUs that the driver can use (initialized and not in a fatal state). */
export function workingGpus(s: SimulationState, eq: Equipment): Component[] {
  return gpuComponents(s, eq).filter((g) => g.gpu?.lifecycle === 'initialized' && g.status === 'ok');
}

export function processes(s: SimulationState, eq: Equipment, user: string): Proc[] {
  const boot = bootInfo(s, eq);
  const start = clockTime(wallClock(s, boot.bootAtMs)).slice(0, 5);
  const p = (pid: number, u: string, cmd: string, o: Partial<Proc> = {}): Proc => ({ pid, user: u, cpu: 0, mem: 0, vszKiB: 0, rssKiB: 0, tty: '?', stat: 'S', start, time: '0:00', cmd, ...o });
  const list: Proc[] = [
    p(1, 'root', '/sbin/init', { vszKiB: 167_940, rssKiB: 13_112, stat: 'Ss', time: '0:42' }),
    p(2, 'root', '[kthreadd]'),
    p(3, 'root', '[rcu_gp]', { stat: 'I<' }),
    p(412, 'root', '/usr/lib/systemd/systemd-journald', { vszKiB: 64_412, rssKiB: 18_200, stat: 'Ss', time: '0:08' }),
    p(455, 'root', '/usr/lib/systemd/systemd-udevd', { vszKiB: 27_312, rssKiB: 7_204, stat: 'Ss' }),
    p(702, 'systemd-network', '/usr/lib/systemd/systemd-networkd', { vszKiB: 18_340, rssKiB: 8_104, stat: 'Ss' }),
    p(744, 'syslog', '/usr/sbin/rsyslogd -n -iNONE', { vszKiB: 222_404, rssKiB: 6_208, stat: 'Ssl' }),
    p(751, 'root', '/usr/sbin/cron -f -P', { vszKiB: 7_204, rssKiB: 2_700, stat: 'Ss' }),
    p(812, 'root', 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', { vszKiB: 12_196, rssKiB: 7_840, stat: 'Ss' }),
  ];
  const gpus = gpuComponents(s, eq);
  if (gpus.length && eq.software.gpuDriverLoaded) {
    list.push(p(1093, 'nvidia-persistenced', '/usr/bin/nvidia-persistenced --user nvidia-persistenced --no-persistence-mode --verbose', { vszKiB: 5_420, rssKiB: 1_904, stat: 'Ss' }));
    if (eq.software.dcgmInstalled) list.push(p(1120, 'root', '/usr/bin/nv-hostengine -n --service-account nvidia-dcgm', { vszKiB: 1_240_112, rssKiB: 52_880, stat: 'Ssl', time: '3:14' }));
  }
  if (eq.workload === 'training') {
    workingGpus(s, eq).forEach((g, i) => {
      list.push(p(4200 + i, 'svc-ml', `python3 train.py --local-rank=${g.gpu?.index ?? i}`, { cpu: 98.4, mem: 1.9, vszKiB: 48_212_004, rssKiB: 9_812_004, stat: 'Rl', time: '812:05' }));
    });
  } else if (eq.workload === 'light') {
    list.push(p(3100, 'svc-app', 'app-server --workers 8', { cpu: 11.4, mem: 3.1, vszKiB: 2_912_404, rssKiB: 1_204_880, stat: 'Ssl', time: '95:41' }));
  }
  const now = clockTime(wallClock(s)).slice(0, 5);
  list.push(p(9001, 'root', `sshd: ${user} [priv]`, { vszKiB: 17_204, rssKiB: 10_880, stat: 'Ss', start: now }));
  list.push(p(9010, user, `sshd: ${user}@pts/0`, { vszKiB: 17_480, rssKiB: 6_904, stat: 'S', start: now }));
  list.push(p(9011, user, '-bash', { vszKiB: 8_804, rssKiB: 5_412, tty: 'pts/0', stat: 'Ss', start: now }));
  return list;
}

export interface Service {
  unit: string;
  description: string;
  active: 'active' | 'failed' | 'inactive';
  sub: 'running' | 'exited' | 'failed' | 'dead';
  pid?: number;
  /** Extra status lines (failure reason). */
  notes: string[];
}

export function services(s: SimulationState, eq: Equipment): Service[] {
  const list: Service[] = [
    { unit: 'cron.service', description: 'Regular background program processing daemon', active: 'active', sub: 'running', pid: 751, notes: [] },
    { unit: 'rsyslog.service', description: 'System Logging Service', active: 'active', sub: 'running', pid: 744, notes: [] },
    { unit: 'ssh.service', description: 'OpenBSD Secure Shell server', active: 'active', sub: 'running', pid: 812, notes: [] },
    { unit: 'systemd-journald.service', description: 'Journal Service', active: 'active', sub: 'running', pid: 412, notes: [] },
    { unit: 'systemd-networkd.service', description: 'Network Configuration', active: 'active', sub: 'running', pid: 702, notes: [] },
    { unit: 'systemd-udevd.service', description: 'Rule-based Manager for Device Events and Files', active: 'active', sub: 'running', pid: 455, notes: [] },
  ];
  if (gpuComponents(s, eq).length) {
    const loaded = eq.software.gpuDriverLoaded;
    list.push(
      loaded
        ? { unit: 'nvidia-persistenced.service', description: 'NVIDIA Persistence Daemon', active: 'active', sub: 'running', pid: 1093, notes: [] }
        : { unit: 'nvidia-persistenced.service', description: 'NVIDIA Persistence Daemon', active: 'failed', sub: 'failed', notes: ['nvidia-persistenced failed to initialize. Check syslog for more details.'] },
    );
    if (eq.software.dcgmInstalled) {
      list.push(
        loaded
          ? { unit: 'nvidia-dcgm.service', description: 'NVIDIA DCGM service', active: 'active', sub: 'running', pid: 1120, notes: [] }
          : { unit: 'nvidia-dcgm.service', description: 'NVIDIA DCGM service', active: 'failed', sub: 'failed', notes: ['DCGM failed to connect to the NVIDIA driver (driver not loaded).'] },
      );
    }
  }
  return list.sort((a, b) => a.unit.localeCompare(b.unit));
}

// ---------------------------------------------------------------------------
// Kernel ring buffer
// ---------------------------------------------------------------------------

export type LogLevel = 'emerg' | 'err' | 'warn' | 'notice' | 'info';

export interface KernelLine {
  /** Seconds since boot. */
  t: number;
  level: LogLevel;
  text: string;
}

function xidOf(f: Fault): number | null {
  if (f.type === 'gpu_fallen_off_bus') return 79;
  if (f.type === 'gpu_xid') return Number(f.params.xid ?? 79);
  if (f.type === 'hbm_ecc_uncorrectable') return 48;
  if (f.type === 'nvlink_down') return 74;
  return null;
}

/** When the OS saw a condition appear: its activity event if logged this boot, otherwise early in boot. */
function seenAt(s: SimulationState, eq: Equipment, message: string, bootAtMs: number, fallbackS: number): number {
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i];
    if (e.equipmentId === eq.id && e.message === `${eq.hostname}: ${message}`) return Math.max(fallbackS, (e.timeMs - bootAtMs) / 1000);
  }
  return fallbackS;
}

export function kernelLog(s: SimulationState, eq: Equipment): KernelLine[] {
  if (!isOsUp(eq)) return [];
  const model = getEquipmentModel(eq.modelId);
  const { bootAtMs } = bootInfo(s, eq);
  const cpu = cpuInfo(s, eq);
  const mem = memInfo(s, eq);
  const ifs = netInterfaces(s, eq);
  const pci = pciDevices(s, eq);
  const lines: KernelLine[] = [];
  const L = (t: number, text: string, level: LogLevel = 'info') => lines.push({ t, level, text });

  L(0, `Linux version ${KERNEL} (simulated build) #1 SMP PREEMPT_DYNAMIC`, 'notice');
  L(0, `Command line: BOOT_IMAGE=/vmlinuz-${KERNEL} root=/dev/nvme0n1p2 ro quiet`);
  L(0, `DMI: ${model.manufacturer} ${model.name}, BIOS 2.4 (simulated)`);
  L(0.002, `Memory: ${mem.totalKiB}K/${Math.round(mem.totalKiB / 0.984)}K available`);
  L(0.112, `smpboot: CPU0: ${cpu.model}`);
  L(0.481, `smp: Brought up ${cpu.sockets} node${cpu.sockets === 1 ? '' : 's'}, ${cpu.cpus} CPUs`);
  L(0.84, 'PCI: Using configuration type 1 for base access');
  pci.forEach((d, i) => L(1.2 + i * 0.004, `pci 0000:${d.bdf}: ${d.cls}: ${d.name}`));
  let nvmeIdx = 0;
  for (const d of pci) {
    if (d.driver === 'nvme') {
      L(1.6 + nvmeIdx * 0.01, `nvme nvme${nvmeIdx}: pci function 0000:${d.bdf}`);
      nvmeIdx++;
    }
  }
  if (nvmeIdx > 0) L(1.7, ' nvme0n1: p1 p2');
  L(1.92, 'EXT4-fs (nvme0n1p2): mounted filesystem with ordered data mode. Quota mode: none.');
  let eth = 0;
  for (const i of ifs) {
    if (i.kind === 'ether' && i.bdf) L(2.41 + eth * 0.01, `${i.driver} 0000:${i.bdf} ${i.name}: renamed from eth${eth++}`);
  }
  L(3.1, 'systemd[1]: systemd 255 running in system mode');
  if (gpuComponents(s, eq).length && eq.software.gpuDriverLoaded) {
    L(4.62, 'nvidia: loading out-of-tree module taints kernel.', 'warn');
    L(4.71, `NVRM: loading NVIDIA UNIX Open Kernel Module for ${cpu.arch}  sim-3.0 (simulated driver)`);
    L(4.73, 'nvidia-nvlink: Nvlink Core is being initialized, major device number 234');
  }
  ifs.filter((i) => i.operUp && i.kind !== 'loopback').forEach((i, k) => L(5.2 + k * 0.02, `IPv6: ADDRCONF(NETDEV_CHANGE): ${i.name}: link becomes ready`));

  // Link changes logged since this boot.
  const byLabel = new Map(ifs.filter((i) => i.port).map((i) => [`${eq.hostname} ${i.port?.label}:`, i]));
  for (const e of s.events) {
    if (e.equipmentId !== eq.id || e.timeMs < bootAtMs || e.category !== 'network') continue;
    const key = [...byLabel.keys()].find((k) => e.message.startsWith(k));
    if (!key) continue;
    const i = byLabel.get(key) as NetIf;
    const t = (e.timeMs - bootAtMs) / 1000;
    if (/link down/.test(e.message)) L(t, `${i.driver} 0000:${i.bdf ?? '00:00.0'} ${i.name}: Link down`, 'warn');
    else if (/link up/.test(e.message)) L(t, `${i.driver} 0000:${i.bdf ?? '00:00.0'} ${i.name}: Link up`);
  }

  // Component conditions visible to the OS.
  const comps = components(s, eq);
  for (const { comp, slotId } of comps) {
    const tel = comp.gpu;
    if (tel && eq.software.gpuDriverLoaded) {
      const faults = Object.values(s.faults)
        .filter((f) => f.targetId === comp.id)
        .sort((a, b) => a.injectedAtMs - b.injectedAtMs);
      for (const f of faults) {
        const x = xidOf(f);
        if (x === null || !tel.xids.includes(x)) continue;
        const t = Math.max(8.2, (f.injectedAtMs - bootAtMs) / 1000);
        const bus = `0000:${tel.busId.slice(9, 14).toLowerCase()}`;
        L(t, `NVRM: Xid (PCI:${bus}): ${x}, pid='<unknown>', name=<unknown>, ${XID_INFO[x]?.name ?? 'GPU error'}`, XID_INFO[x]?.fatal ? 'err' : 'warn');
      }
    }
    for (const c of comp.conditions) {
      if (!c.channels.includes('os')) continue;
      const t = seenAt(s, eq, c.message, bootAtMs, 9.4);
      switch (c.code) {
        case 'GPU_FALLEN_OFF_BUS':
          if (!eq.software.gpuDriverLoaded) L(t, `pcieport 0000:${hex2(0x10 + (slotNum(slotId) < 4 ? 0 : 0x40))}:00.0: AER: Uncorrectable (Fatal) error received: 0000:${tel?.busId.slice(9, 16).toLowerCase() ?? '00:00.0'}`, 'err');
          break;
        case 'GPU_XID_13':
        case 'GPU_HBM_UNCORRECTABLE':
          break; // reported as NVRM Xid lines above
        case 'DIMM_UNCORRECTABLE':
          L(t, `EDAC MC${slotId.startsWith('dimm1') ? 1 : 0}: 1 UE memory read error on ${c.message.replace('Uncorrectable ECC error on ', '')} (page:0x${(hash32(comp.id) % 0xfffff).toString(16)} offset:0x0 grain:64)`, 'err');
          break;
        case 'DRIVE_FAILED':
          if (comp.category === 'nvme') L(t, `nvme nvme${slotNum(slotId) + 1}: controller is down; will reset: CSTS=0xffffffff, PCI_STATUS=0xffff`, 'err');
          else L(t, `sd 0:0:${slotNum(slotId)}:0: rejecting I/O to offline device (${c.message})`, 'err');
          break;
        case 'DRIVE_NOT_VISIBLE':
          L(t, `scsi host0: ${c.message}`, 'warn');
          break;
        case 'NIC_FAILED':
        case 'NIC_NOT_ENUMERATED':
        case 'GPU_NOT_ENUMERATED':
        case 'RISER_FAILED':
        case 'PCIE_DEVICE_MISSING':
          L(t, `pcieport 0000:00:01.0: AER: ${c.message}`, 'err');
          break;
        case 'BMC_UNRESPONSIVE':
          L(t, `ipmi_si IPI0001:00: ${c.message}`, 'warn');
          break;
        case 'TEMP_CRITICAL':
          L(t, `mce: [Hardware Error]: ${c.message}`, 'err');
          break;
        case 'TEMP_WARNING':
          L(t, `thermal thermal_zone0: ${c.message}`, 'warn');
          break;
        default:
          if (!c.code.startsWith('GPU_XID') && c.code !== 'GPU_DRIVER_NOT_LOADED') L(t, c.message, c.severity === 'critical' ? 'err' : 'warn');
      }
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

export function formatKernelTs(t: number): string {
  return `[${t.toFixed(6).padStart(12, ' ')}]`;
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export interface JournalEntry {
  ms: number;
  ident: string;
  unit?: string;
  level: LogLevel;
  text: string;
}

export function journal(s: SimulationState, eq: Equipment): JournalEntry[] {
  if (!isOsUp(eq)) return [];
  const { bootAtMs } = bootInfo(s, eq);
  const out: JournalEntry[] = kernelLog(s, eq).map((k) => ({ ms: bootAtMs + k.t * 1000, ident: 'kernel', level: k.level, text: k.text }));
  const sys = (dt: number, text: string, unit?: string, level: LogLevel = 'info') => out.push({ ms: bootAtMs + dt * 1000, ident: 'systemd[1]', unit, level, text });
  let t = 5.6;
  for (const svc of services(s, eq)) {
    t += 0.07;
    if (svc.active === 'active') sys(t, `Started ${svc.unit} - ${svc.description}.`, svc.unit);
    else {
      out.push({ ms: bootAtMs + t * 1000, ident: svc.unit.replace('.service', ''), unit: svc.unit, level: 'err', text: svc.notes[0] ?? 'failed' });
      sys(t + 0.01, `${svc.unit}: Main process exited, code=exited, status=1/FAILURE`, svc.unit, 'warn');
      sys(t + 0.02, `${svc.unit}: Failed with result 'exit-code'.`, svc.unit, 'warn');
      sys(t + 0.03, `Failed to start ${svc.unit} - ${svc.description}.`, svc.unit, 'err');
    }
  }
  sys(t + 0.2, 'Reached target multi-user.target - Multi-User System.');
  const svcs = services(s, eq);
  if (svcs.some((x) => x.unit === 'nvidia-persistenced.service' && x.active === 'active')) {
    out.push({ ms: bootAtMs + 5.9 * 1000, ident: 'nvidia-persistenced[1093]', unit: 'nvidia-persistenced.service', level: 'info', text: `Started (1093)` });
  }
  if (svcs.some((x) => x.unit === 'nvidia-dcgm.service' && x.active === 'active')) {
    out.push({ ms: bootAtMs + 6.1 * 1000, ident: 'nv-hostengine[1120]', unit: 'nvidia-dcgm.service', level: 'info', text: 'DCGM initialized (simulated)' });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

export function hostById(s: SimulationState, id: string): Equipment | undefined {
  return s.equipment[id];
}
