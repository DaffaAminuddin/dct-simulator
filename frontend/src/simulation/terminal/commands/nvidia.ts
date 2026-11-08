/**
 * nvidia-smi from the driver observation channel: GPUs the driver can see,
 * Xid-fatal GPUs with ERR! fields, GPUs that fell off the bus, and the
 * "couldn't communicate with the NVIDIA driver" error when it is unloaded.
 */
import { XID_INFO } from '@/data/faults/faultCatalog';
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { hash32 } from '@/simulation/core/util';
import type { Component, Equipment, SimulationState } from '@/types/simulation';
import { gpuComponents, wallClock } from '../os/HostOs';
import type { CommandContext, CommandDef, CommandResult } from '../types';
import { err, ok } from '../types';
import { shellHost } from './util';

const DRIVER = 'sim-3.0';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DRIVER_ERROR = [
  "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver. Make sure that the latest NVIDIA driver is installed and running.",
  '',
];

const SMI_NAME: Record<string, string> = {
  'gpu-blackwell-gb200': 'NVIDIA GB200',
  'gpu-blackwell-ultra-gb300': 'NVIDIA GB300',
  'gpu-sxm-ref-80g': 'Reference SXM 80GB',
};

export function smiName(c: Component): string {
  return SMI_NAME[c.modelId] ?? getComponentModel(c.modelId).name.slice(0, 20);
}

export function gpuUuid(c: Component): string {
  const h = (k: string) => hash32(`${c.serial}#${k}`).toString(16).padStart(8, '0');
  const a = h('a');
  const b = h('b');
  const d = h('d');
  return `GPU-${a}-${b.slice(0, 4)}-${b.slice(4)}-${d.slice(0, 4)}-${d.slice(4)}${h('e')}`;
}

function smiDate(s: SimulationState): string {
  const d = wallClock(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${d.getUTCFullYear()}`;
}

interface SmiGpu {
  index: number;
  comp: Component;
  fallen: boolean;
  /** A fatal Xid (other than double-bit ECC) leaves the GPU unusable until reset. */
  errored: boolean;
}

/** GPUs as the driver enumerates them: renumbered in bus order, missing devices skipped. */
export function smiGpus(s: SimulationState, eq: Equipment): SmiGpu[] {
  const listed = gpuComponents(s, eq).filter((c) => c.gpu && (c.gpu.lifecycle === 'initialized' || c.conditions.some((x) => x.code === 'GPU_FALLEN_OFF_BUS')));
  listed.sort((a, b) => (a.gpu?.busId ?? '').localeCompare(b.gpu?.busId ?? ''));
  return listed.map((comp, index) => ({
    index,
    comp,
    fallen: comp.conditions.some((x) => x.code === 'GPU_FALLEN_OFF_BUS'),
    errored: (comp.gpu?.xids ?? []).some((x) => x !== 48 && x !== 79 && XID_INFO[x]?.fatal),
  }));
}

const mib = (gb: number) => Math.round(gb * 1024 * 0.9955);
const W = 89;
const line = (ch = '-') => `+${ch.repeat(W)}+`;
function cell(left: string, right: string, width: number): string {
  const inner = width - 2;
  const gap = Math.max(1, inner - left.length - right.length);
  return ` ${(left + ' '.repeat(gap) + right).slice(0, inner)} `;
}
const row3 = (a: string, b: string, c: string) => `|${a}|${b}|${c}|`;
const SEP = `|${'-'.repeat(41)}+${'-'.repeat(24)}+${'-'.repeat(22)}|`;
const BOTTOM = `+${'-'.repeat(41)}+${'-'.repeat(24)}+${'-'.repeat(22)}+`;

function handleError(g: SmiGpu): string {
  return `Unable to determine the device handle for GPU${g.comp.gpu?.busId ?? ''}: Unknown Error`;
}

function smiTable(s: SimulationState, eq: Equipment, gpus: SmiGpu[]): string[] {
  const out: string[] = [];
  for (const g of gpus.filter((x) => x.fallen)) out.push(handleError(g));
  const ok_ = gpus.filter((x) => !x.fallen);
  if (!ok_.length) return [...out, 'No devices were found'];
  out.push(
    `${smiDate(s)}       `,
    line(),
    `|${cell(`NVIDIA-SMI ${DRIVER}`, `Driver Version: ${DRIVER}        CUDA Version: n/a     `, W + 2).slice(1, -1)}|`,
    SEP,
    row3(cell('GPU  Name', 'Persistence-M', 41), cell('Bus-Id', 'Disp.A', 24), cell('Volatile Uncorr. ECC', '', 22)),
    row3(cell('Fan  Temp   Perf', 'Pwr:Usage/Cap', 41), cell('', 'Memory-Usage', 24), cell('GPU-Util', 'Compute M.', 22)),
    row3(cell('', '', 41), cell('', '', 24), cell('', 'MIG M.', 22)),
    `|${'='.repeat(41)}+${'='.repeat(24)}+${'='.repeat(22)}|`,
  );
  ok_.forEach((g, i) => {
    const t = g.comp.gpu!;
    const e = g.errored;
    out.push(row3(cell(`${String(g.index).padStart(3)}  ${smiName(g.comp)}`, 'On', 41), cell('', `${t.busId} Off`, 24), cell('', e ? 'ERR!' : String(t.eccUncorrectable), 22)));
    out.push(
      row3(
        cell(`N/A  ${e ? 'ERR!' : `${Math.round(g.comp.temperatureC)}C`.padStart(4)}    ${e ? 'ERR!' : 'P0'}`, e ? 'ERR! / ERR!' : `${t.powerW}W / ${t.powerLimitW}W`, 41),
        cell('', `${mib(t.memUsedGB)}MiB / ${mib(t.memTotalGB)}MiB`, 24),
        cell(e ? 'ERR!' : `${String(t.utilizationPct).padStart(5)}%`, 'Default', 22),
      ),
    );
    out.push(row3(cell('', '', 41), cell('', '', 24), cell('', e ? 'ERR!' : 'Disabled', 22)));
    out.push(i === ok_.length - 1 ? BOTTOM : SEP);
  });
  out.push('', line(), `|${cell('Processes:', '', W + 2).slice(1, -1)}|`);
  out.push(`|  GPU   GI   CI              PID   Type   Process name                        GPU Memory |`, `|        ID   ID                                                               Usage      |`, `|${'='.repeat(W)}|`);
  const procs = eq.workload === 'training' ? ok_.filter((g) => !g.errored && g.comp.status === 'ok' && (g.comp.gpu?.utilizationPct ?? 0) > 0) : [];
  if (!procs.length) out.push(`|${cell('  No running processes found', '', W + 2).slice(1, -1)}|`);
  for (const g of procs) {
    const pid = String(4200 + (g.comp.gpu?.index ?? 0));
    out.push(`|${`    ${String(g.index).padStart(1)}   N/A  N/A          ${pid.padStart(7)}      C   python3`.padEnd(W - 11)}${`${mib(g.comp.gpu!.memUsedGB)}MiB`.padStart(10)} |`);
  }
  out.push(line());
  return out;
}

const SECTIONS = ['MEMORY', 'UTILIZATION', 'ECC', 'TEMPERATURE', 'POWER', 'CLOCK', 'PERFORMANCE', 'PCIE'] as const;
type Section = (typeof SECTIONS)[number];

function qRow(indent: number, key: string, value?: string | number): string {
  const k = `${' '.repeat(indent)}${key}`;
  return value === undefined ? k : `${k.padEnd(42)}: ${value}`;
}

function smiQuery(s: SimulationState, eq: Equipment, gpus: SmiGpu[], sections: Section[] | null): string[] {
  const want = (x: Section) => !sections || sections.includes(x);
  const out = ['', '==============NVSMI LOG==============', '', qRow(0, 'Timestamp', smiDate(s)), qRow(0, 'Driver Version', DRIVER), qRow(0, 'CUDA Version', 'n/a'), '', qRow(0, 'Attached GPUs', gpuComponents(s, eq).length)];
  for (const g of gpus) {
    const c = g.comp;
    const t = c.gpu!;
    out.push(`GPU ${t.busId}`);
    if (g.fallen) {
      out.push(`    ${handleError(g)}`, '');
      continue;
    }
    const model = getComponentModel(c.modelId);
    const active = (on: boolean) => (on ? 'Active' : 'Not Active');
    const thermal = t.throttleReasons.includes('HW Thermal Slowdown');
    const brake = t.throttleReasons.includes('HW Power Brake Slowdown');
    if (!sections) {
      out.push(
        qRow(4, 'Product Name', smiName(c)),
        qRow(4, 'Product Brand', 'NVIDIA'),
        qRow(4, 'Persistence Mode', 'Enabled'),
        qRow(4, 'Serial Number', c.serial),
        qRow(4, 'GPU UUID', gpuUuid(c)),
        qRow(4, 'Minor Number', g.index),
        qRow(4, 'GPU Part Number', 'n/a (simulated)'),
      );
    }
    if (want('PCIE')) {
      out.push(qRow(4, 'PCI'), qRow(8, 'Bus', `0x${t.busId.slice(9, 11)}`), qRow(8, 'Bus Id', t.busId), qRow(8, 'GPU Link Info'), qRow(12, 'PCIe Generation'), qRow(16, 'Max', 5), qRow(16, 'Current', t.pcieGen), qRow(12, 'Link Width'), qRow(16, 'Max', `${t.pcieMaxWidth}x`), qRow(16, 'Current', `${t.pcieWidth}x`));
    }
    if (want('PERFORMANCE')) {
      out.push(
        qRow(4, 'Performance State', g.errored ? 'Unknown Error' : 'P0'),
        qRow(4, 'Clocks Event Reasons'),
        qRow(8, 'Idle', active(t.utilizationPct === 0 && !g.errored)),
        qRow(8, 'Applications Clocks Setting', 'Not Active'),
        qRow(8, 'SW Power Cap', 'Not Active'),
        qRow(8, 'HW Slowdown', active(thermal || brake)),
        qRow(12, 'HW Thermal Slowdown', active(thermal)),
        qRow(12, 'HW Power Brake Slowdown', active(brake)),
        qRow(8, 'SW Thermal Slowdown', 'Not Active'),
      );
    }
    if (want('MEMORY')) out.push(qRow(4, 'FB Memory Usage'), qRow(8, 'Total', `${mib(t.memTotalGB)} MiB`), qRow(8, 'Used', `${mib(t.memUsedGB)} MiB`), qRow(8, 'Free', `${mib(t.memTotalGB) - mib(t.memUsedGB)} MiB`));
    if (want('UTILIZATION')) out.push(qRow(4, 'Utilization'), qRow(8, 'Gpu', `${t.utilizationPct} %`), qRow(8, 'Memory', `${Math.round(t.utilizationPct * 0.43)} %`));
    if (want('ECC')) {
      out.push(qRow(4, 'ECC Mode'), qRow(8, 'Current', 'Enabled'), qRow(8, 'Pending', 'Enabled'), qRow(4, 'ECC Errors'), qRow(8, 'Volatile'), qRow(12, 'SRAM Correctable', 0), qRow(12, 'SRAM Uncorrectable', 0), qRow(12, 'DRAM Correctable', t.eccCorrectable), qRow(12, 'DRAM Uncorrectable', t.eccUncorrectable));
    }
    if (want('TEMPERATURE')) {
      out.push(qRow(4, 'Temperature'), qRow(8, 'GPU Current Temp', g.errored ? 'ERR!' : `${Math.round(c.temperatureC)} C`), qRow(8, 'GPU Shutdown Temp', `${model.thermal.criticalC} C`), qRow(8, 'GPU Slowdown Temp', `${model.thermal.throttleC ?? model.thermal.criticalC} C`));
    }
    if (want('POWER')) out.push(qRow(4, 'GPU Power Readings'), qRow(8, 'Power Draw', g.errored ? 'ERR!' : `${t.powerW.toFixed(2)} W`), qRow(8, 'Current Power Limit', `${t.powerLimitW.toFixed(2)} W`), qRow(8, 'Max Power Limit', `${model.maxW.toFixed(2)} W`));
    if (want('CLOCK')) out.push(qRow(4, 'Clocks'), qRow(8, 'SM', `${t.smClockMHz} MHz`), qRow(4, 'Max Clocks'), qRow(8, 'SM', `${t.maxClockMHz} MHz`));
    out.push('');
  }
  return out;
}

const QUERY_FIELDS: Record<string, { head: string; unit?: string; get: (g: SmiGpu) => string | number }> = {
  index: { head: 'index', get: (g) => g.index },
  name: { head: 'name', get: (g) => smiName(g.comp) },
  uuid: { head: 'uuid', get: (g) => gpuUuid(g.comp) },
  serial: { head: 'serial', get: (g) => g.comp.serial },
  'pci.bus_id': { head: 'pci.bus_id', get: (g) => g.comp.gpu!.busId },
  'temperature.gpu': { head: 'temperature.gpu', get: (g) => Math.round(g.comp.temperatureC) },
  'utilization.gpu': { head: 'utilization.gpu', unit: '%', get: (g) => g.comp.gpu!.utilizationPct },
  'memory.used': { head: 'memory.used', unit: 'MiB', get: (g) => mib(g.comp.gpu!.memUsedGB) },
  'memory.total': { head: 'memory.total', unit: 'MiB', get: (g) => mib(g.comp.gpu!.memTotalGB) },
  'power.draw': { head: 'power.draw', unit: 'W', get: (g) => g.comp.gpu!.powerW.toFixed(2) },
  'power.limit': { head: 'power.limit', unit: 'W', get: (g) => g.comp.gpu!.powerLimitW.toFixed(2) },
  'clocks.sm': { head: 'clocks.current.sm', unit: 'MHz', get: (g) => g.comp.gpu!.smClockMHz },
  'clocks.max.sm': { head: 'clocks.max.sm', unit: 'MHz', get: (g) => g.comp.gpu!.maxClockMHz },
  'pcie.link.gen.current': { head: 'pcie.link.gen.current', get: (g) => g.comp.gpu!.pcieGen },
  'pcie.link.gen.max': { head: 'pcie.link.gen.max', get: () => 5 },
  'pcie.link.width.current': { head: 'pcie.link.width.current', get: (g) => g.comp.gpu!.pcieWidth },
  'pcie.link.width.max': { head: 'pcie.link.width.max', get: (g) => g.comp.gpu!.pcieMaxWidth },
  'ecc.errors.uncorrected.volatile.total': { head: 'ecc.errors.uncorrected.volatile.total', get: (g) => g.comp.gpu!.eccUncorrectable },
  'ecc.errors.corrected.volatile.total': { head: 'ecc.errors.corrected.volatile.total', get: (g) => g.comp.gpu!.eccCorrectable },
  pstate: { head: 'pstate', get: () => 'P0' },
  'clocks_event_reasons.hw_thermal_slowdown': { head: 'clocks_event_reasons.hw_thermal_slowdown', get: (g) => (g.comp.gpu!.throttleReasons.includes('HW Thermal Slowdown') ? 'Active' : 'Not Active') },
  'clocks_event_reasons.hw_power_brake_slowdown': { head: 'clocks_event_reasons.hw_power_brake_slowdown', get: (g) => (g.comp.gpu!.throttleReasons.includes('HW Power Brake Slowdown') ? 'Active' : 'Not Active') },
  driver_version: { head: 'driver_version', get: () => DRIVER },
};
QUERY_FIELDS['gpu_name'] = QUERY_FIELDS.name;
QUERY_FIELDS['gpu_uuid'] = QUERY_FIELDS.uuid;
QUERY_FIELDS['clocks.current.sm'] = QUERY_FIELDS['clocks.sm'];

function nvidiaSmi(ctx: CommandContext): CommandResult {
  const eq = shellHost(ctx);
  const s = ctx.state;
  if (!gpuComponents(s, eq).length) return err('nvidia-smi: command not found', 127);
  if (!eq.software.gpuDriverLoaded) return { stdout: DRIVER_ERROR, exit: 9 };
  const args = ctx.argv.slice(1);
  let gpus = smiGpus(s, eq);

  // Sub-commands.
  if (args[0] === 'nvlink') {
    if (!args.some((a) => a === '-s' || a === '--status')) return err('nvidia-smi nvlink: only --status (-s) is simulated in this phase', 1);
    const iIdx = args.indexOf('-i');
    const pick = iIdx >= 0 ? gpus.filter((g) => String(g.index) === args[iIdx + 1]) : gpus;
    const out: string[] = [];
    for (const g of pick) {
      out.push(`GPU ${g.index}: ${smiName(g.comp)} (UUID: ${gpuUuid(g.comp)})`);
      if (g.fallen) {
        out.push(`\t${handleError(g)}`);
        continue;
      }
      const t = g.comp.gpu!;
      for (let k = 0; k < t.nvlinkTotal; k++) out.push(`\t Link ${k}: ${k < t.nvlinkActive ? 'active' : '<inactive>'}`);
    }
    return ok(out);
  }
  if (args[0] === 'topo' || args[0] === '-r' || args[0] === '--gpu-reset' || args[0] === 'mig') return err(`nvidia-smi ${args[0]}: not simulated in this phase (GPU reset: reboot the host or replace the part)`, 1);

  const iIdx = args.findIndex((a) => a === '-i' || a === '--id');
  const iArg = iIdx >= 0 ? args[iIdx + 1] : args.find((a) => a.startsWith('--id='))?.slice(5);
  if (iArg !== undefined) {
    const ids = iArg.split(',');
    const sel = gpus.filter((g) => ids.some((id) => String(g.index) === id || g.comp.gpu?.busId.toLowerCase().endsWith(id.toLowerCase()) || gpuUuid(g.comp) === id));
    if (!sel.length) return { stdout: ['No devices were found'], exit: 6 };
    gpus = sel;
  }

  if (args.includes('-L') || args.includes('--list-gpus')) {
    return ok(gpus.map((g) => (g.fallen ? handleError(g) : `GPU ${g.index}: ${smiName(g.comp)} (UUID: ${gpuUuid(g.comp)})`)));
  }

  const query = args.find((a) => a.startsWith('--query-gpu='));
  if (query) {
    const fmt = args.find((a) => a.startsWith('--format='))?.slice(9) ?? '';
    if (!fmt.includes('csv')) return err('--format=csv is required with --query-gpu', 2);
    const fields = query.slice(12).split(',').map((f) => f.trim());
    const bad = fields.find((f) => !QUERY_FIELDS[f]);
    if (bad) return err(`Field "${bad}" is not a valid field to query.`, 2);
    const noUnits = fmt.includes('nounits');
    const out: string[] = [];
    if (!fmt.includes('noheader')) out.push(fields.map((f) => `${QUERY_FIELDS[f].head}${QUERY_FIELDS[f].unit && !noUnits ? ` [${QUERY_FIELDS[f].unit}]` : ''}`).join(', '));
    for (const g of gpus) {
      if (g.fallen) {
        out.push(fields.map(() => '[GPU requires reset]').join(', '));
        continue;
      }
      out.push(fields.map((f) => `${QUERY_FIELDS[f].get(g)}${QUERY_FIELDS[f].unit && !noUnits ? ` ${QUERY_FIELDS[f].unit}` : ''}`).join(', '));
    }
    return ok(out);
  }

  if (args.includes('-q') || args.includes('--query')) {
    const dIdx = args.findIndex((a) => a === '-d' || a === '--display');
    let sections: Section[] | null = null;
    if (dIdx >= 0) {
      const list = (args[dIdx + 1] ?? '').toUpperCase().split(',');
      const bad = list.find((x) => !SECTIONS.includes(x as Section));
      if (bad) return err(`Invalid display type "${bad}". Valid: ${SECTIONS.join(', ')}`, 2);
      sections = list as Section[];
    }
    return ok(smiQuery(s, eq, gpus, sections));
  }

  const unknown = args.find((a) => a.startsWith('-') && !['-i', '--id'].includes(a) && a !== iArg);
  if (unknown) return err([`Invalid combination of input arguments. Please run 'nvidia-smi -h' for help.`], 2);
  const out = smiTable(s, eq, gpus);
  return { stdout: out, exit: gpus.some((g) => !g.fallen) ? 0 : 6 };
}

export const NVIDIA_COMMANDS: CommandDef[] = [
  {
    name: 'nvidia-smi',
    summary: 'GPU status (-L, -q, -i N -q, -d ECC, --query-gpu=..., nvlink -s)',
    contexts: ['host'],
    group: 'nvidia',
    run: nvidiaSmi,
  },
];

// ---------------------------------------------------------------------------
// Tools simulated in later phases: honest about it, but only where installed.
// ---------------------------------------------------------------------------

function hasIbHca(ctx: CommandContext): boolean {
  const eq = shellHost(ctx);
  return eq.portIds.some((id) => ctx.state.ports[id]?.type === 'osfp' && ctx.state.ports[id]?.componentId);
}

function planned(name: string, phase: number, what: string, available: (ctx: CommandContext) => boolean, group: CommandDef['group'] = 'fabric'): CommandDef {
  return {
    name,
    summary: `${what} (Phase ${phase})`,
    contexts: ['host'],
    group,
    run: (ctx) => {
      if (!available(ctx)) return err(`${name}: command not found`, 127);
      if (name === 'dcgmi' && !shellHost(ctx).software.gpuDriverLoaded) {
        return err(['Error: unable to establish a connection to the specified host: localhost', 'Error: Unable to connect to host engine. Host engine connection invalid/disconnected.'], 255);
      }
      return err(`${name}: ${what} is simulated in Phase ${phase} of DCT Simulator. Until then: ${phase === 4 ? 'nvidia-smi -q, dmesg and journalctl -k' : 'ip -br link, ethtool and the Network Lab'}.`, 1);
    },
  };
}

export const PLANNED_COMMANDS: CommandDef[] = [
  planned('dcgmi', 4, 'DCGM discovery, health and diagnostics (dcgmi diag -r 1|2|3)', (ctx) => shellHost(ctx).software.dcgmInstalled, 'nvidia'),
  planned('all_reduce_perf', 5, 'NCCL collective benchmarks (nccl-tests)', (ctx) => gpuComponents(ctx.state, shellHost(ctx)).length > 0),
  planned('ibstat', 5, 'InfiniBand port state', hasIbHca),
  planned('ibv_devinfo', 5, 'RDMA device attributes', hasIbHca),
  planned('iblinkinfo', 5, 'Fabric link map', hasIbHca),
  planned('ibdiagnet', 5, 'Fabric diagnostics', hasIbHca),
  planned('rdma', 5, 'RDMA link state (rdma link)', hasIbHca),
  planned('mlxlink', 5, 'Port and cable diagnostics', hasIbHca),
  planned('mlxconfig', 5, 'Adapter firmware configuration', hasIbHca),
];
