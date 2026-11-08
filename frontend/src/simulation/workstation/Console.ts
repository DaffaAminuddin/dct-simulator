/**
 * Serial console screen (simulated): what a technician sees on a host's
 * RS-232 console, derived from host state. Kernel messages show OS-channel
 * conditions (XIDs, ECC), which is why the console is a key diagnostic tool.
 */
import { XID_INFO } from '@/data/faults/faultCatalog';
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { installedComponents } from '@/simulation/core/SimulationState';
import type { Equipment, SimulationState } from '@/types/simulation';

function ts(sec: number): string {
  return `[${sec.toFixed(6).padStart(12, ' ')}]`;
}

function postLines(s: SimulationState, eq: Equipment): string[] {
  const model = getEquipmentModel(eq.modelId);
  const comps = installedComponents(s, eq);
  const cpus = comps.filter((c) => c.category === 'cpu');
  const dimms = comps.filter((c) => c.category === 'dimm' && c.status !== 'failed');
  const memGB = dimms.reduce((n, d) => n + Number(getComponentModel(d.modelId).specs.capacityGB ?? 0), 0);
  const lines = [`Reference UEFI firmware 2.4 (simulated) - ${model.shortName}`, `System serial: ${eq.serial}`];
  cpus.forEach((c, i) => lines.push(`CPU${i}: ${getComponentModel(c.modelId).name}${c.status === 'failed' ? '  [FAILED]' : '  OK'}`));
  if (dimms.length) lines.push(`Memory: ${dimms.length} DIMMs, ${memGB} GB  OK`);
  lines.push('Initializing PCIe devices ...', `BMC: ${eq.bmcAlive ? 'ready' : 'not responding'}`);
  return lines;
}

export function consoleScreen(s: SimulationState, equipmentId: string): { lines: string[]; status: string } {
  const eq = s.equipment[equipmentId];
  if (!eq) return { lines: [], status: 'No device' };
  if (eq.state === 'powered_off') return { lines: [], status: 'No output: the device has no power' };
  if (eq.state === 'standby') return { lines: [], status: 'No output: host is in standby (powered off)' };

  if (eq.kind === 'switch') {
    if (eq.state === 'powered_on' || eq.state === 'booting') return { lines: ['Loading network OS (reference) ...'], status: 'Booting' };
    return { lines: ['Network OS (reference)', '', `${eq.hostname} login: `], status: 'Login prompt' };
  }

  const post = postLines(s, eq);
  if (eq.state === 'powered_on') return { lines: [...post, 'POST in progress ...'], status: 'POST' };
  if (eq.state === 'boot_failed') {
    return { lines: [...post, '', ...eq.postFailures.map((f) => `!! ${f}`), '', 'System halted. Press <F1> to retry boot.'], status: 'Boot failed' };
  }
  const boot = [...post, '', 'Booting from M.2 boot drive ...', `${ts(0)} Linux version 6.8.0-generic (simulated)`, `${ts(0.84)} PCI: Using configuration type 1 for base access`];
  if (eq.state === 'booting') return { lines: [...boot, `${ts(3.1)} systemd[1]: Starting system services ...`], status: 'Booting OS' };

  // OS running: kernel messages for OS-visible conditions, then the login prompt.
  const kernel: string[] = [];
  let t = 42.1;
  for (const c of installedComponents(s, eq)) {
    const tel = c.gpu;
    for (const cond of c.conditions) {
      if (!cond.channels.includes('os')) continue;
      t += 3.7;
      if (tel && /^GPU_(XID|FALLEN|HBM)/.test(cond.code)) {
        for (const x of tel.xids) kernel.push(`${ts(t)} NVRM: Xid (PCI:${tel.busId}): ${x}, ${XID_INFO[x]?.name ?? 'GPU error'}`);
      } else if (cond.code === 'DIMM_UNCORRECTABLE') kernel.push(`${ts(t)} EDAC MC0: 1 UE memory read error on ${cond.message.replace('Uncorrectable ECC error on ', '')}`);
      else if (cond.code === 'DRIVE_FAILED' || cond.code === 'DRIVE_NOT_VISIBLE') kernel.push(`${ts(t)} blk_update_request: I/O error (${cond.message})`);
      else if (cond.code === 'NIC_FAILED' || cond.code === 'NIC_NOT_ENUMERATED' || cond.code === 'GPU_NOT_ENUMERATED' || cond.code === 'RISER_FAILED') kernel.push(`${ts(t)} pcieport: AER: ${cond.message}`);
      else if (cond.code === 'GPU_DRIVER_NOT_LOADED') kernel.push(`${ts(t)} nvidia: module not loaded`);
    }
  }
  return { lines: [...boot, `${ts(6.2)} systemd[1]: Reached target Multi-User System.`, ...[...new Set(kernel)], '', eq.software.os, '', `${eq.hostname} login: `], status: 'Login prompt' };
}
