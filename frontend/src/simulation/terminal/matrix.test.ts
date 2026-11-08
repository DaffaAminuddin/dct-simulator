/**
 * Command × fault matrix (IMPLEMENTATION_ROADMAP Phase 3): host commands are
 * pure functions of the simulation state, so their output is snapshot-tested
 * for each injected fault on the GX-4800 GPU server dh1-r03-g01.
 */
import { describe, expect, it } from 'vitest';
import type { SimulationEngine } from '@/simulation/core/SimulationEngine';
import type { FaultType } from '@/types/simulation';
import { makeEngine, ok } from '@/test/engine';
import { execute } from './CommandExecutor';
import { stripAnsi } from './commands/util';
import { LAPTOP_FRAME } from './Session';
import type { TerminalSession } from './types';

const HOST = 'srv-r03-g01';

function hostSession(): TerminalSession {
  return {
    frames: [LAPTOP_FRAME, { kind: 'host', equipmentId: HOST, host: 'dh1-r03-g01', user: 'dct', cwd: '/home/dct', via: 'sol' }],
    history: [],
    lastExit: 0,
    knownHosts: [],
  };
}

function run(e: SimulationEngine, line: string): string {
  const r = execute({ getState: () => e.getState(), dispatch: (a) => e.dispatch(a) }, hostSession(), line);
  return r.lines.map(stripAnsi).join('\n');
}

const slot = (e: SimulationEngine, s: string) => e.getState().equipment[HOST].slots[s] as string;

const FAULTS: { name: string; type?: FaultType; target?: (e: SimulationEngine) => string; params?: Record<string, number> }[] = [
  { name: 'healthy' },
  { name: 'gpu0 fallen off the bus', type: 'gpu_fallen_off_bus', target: (e) => slot(e, 'gpu0') },
  { name: 'gpu2 HBM uncorrectable ECC', type: 'hbm_ecc_uncorrectable', target: (e) => slot(e, 'gpu2'), params: { count: 4 } },
  { name: 'gpu3 NVLink down', type: 'nvlink_down', target: (e) => slot(e, 'gpu3'), params: { links: 4 } },
  { name: 'gpu5 Xid 119', type: 'gpu_xid', target: (e) => slot(e, 'gpu5'), params: { xid: 119 } },
  { name: 'riser1 failed', type: 'riser_failure', target: (e) => slot(e, 'riser1') },
  { name: 'OCP NIC failed', type: 'nic_failure', target: (e) => slot(e, 'ocp0') },
  { name: 'NVMe bay 1 failed', type: 'nvme_failure', target: (e) => slot(e, 'nvme1') },
  { name: 'DIMM uncorrectable', type: 'dimm_uncorrectable', target: (e) => slot(e, 'dimm0_2') },
];

const COMMANDS = ['nvidia-smi -L', 'nvidia-smi --query-gpu=index,pci.bus_id,ecc.errors.uncorrected.volatile.total,clocks.sm --format=csv', 'lspci', 'ip -br link', 'lsblk', 'sudo dmesg -l err,warn'];

describe('command × fault matrix (dh1-r03-g01)', () => {
  for (const f of FAULTS) {
    it(f.name, () => {
      const e = makeEngine();
      if (f.type && f.target) ok(e, { type: 'fault/inject', faultType: f.type, targetId: f.target(e), params: f.params });
      const out = Object.fromEntries(COMMANDS.map((c) => [c, run(e, c)]));
      expect(out).toMatchSnapshot();
    });
  }

  it('the healthy server shows 8 GPUs, its NICs and no kernel errors', () => {
    const e = makeEngine();
    expect(run(e, 'nvidia-smi -L').split('\n')).toHaveLength(8);
    expect(run(e, 'lspci | grep -c "3D controller"')).toBe('8');
    expect(run(e, 'sudo dmesg -l err')).toBe('');
  });

  it('a failed riser hides its GPUs and NICs, and the driver renumbers the rest', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'riser_failure', targetId: slot(e, 'riser1') });
    expect(run(e, 'nvidia-smi -L').split('\n')).toHaveLength(4);
    expect(run(e, 'lspci | grep -c Infiniband')).toBe('2');
    expect(run(e, 'sudo dmesg -l err')).toMatch(/AER: PCIe switch riser 1: PCIe link failure/);
  });
});
