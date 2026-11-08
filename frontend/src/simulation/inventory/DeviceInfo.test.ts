import { describe, expect, it } from 'vitest';
import { execute } from '@/simulation/terminal/CommandExecutor';
import { stripAnsi } from '@/simulation/terminal/commands/util';
import { LAPTOP_FRAME } from '@/simulation/terminal/Session';
import { makeEngine, unplug } from '@/test/engine';
import { componentPartNumber, deviceInfo, equipmentPartNumber } from './DeviceInfo';

describe('device information', () => {
  it('lists identity, BMC and data addresses with their switch ports', () => {
    const s = makeEngine().getState();
    const info = deviceInfo(s, s.equipment['srv-r01-01']);
    expect(info).toMatchObject({ hostname: 'dh1-r01-n01', rackId: 'R01', uLabel: 'U10', serial: s.equipment['srv-r01-01'].serial, sshHint: 'ssh admin@dh1-r01-n01-bmc' });
    expect(info.partNumber).toMatch(/^SRV-\d{4}-[A-D]0[1-3]$/);
    expect(info.management).toMatchObject({ ip: '10.10.1.11', prefix: 16, gateway: '10.10.0.1', state: 'link_up' });
    expect(info.management?.peer).toMatch(/^dh1-r01-oob1 · /);
    expect(info.network[0]).toMatchObject({ iface: 'ens1f0np0', ip: '10.100.1.11', state: 'link_up' });
    expect(info.network[0].peer).toMatch(/^dh1-r01-tor1 · /);
  });

  it('uses the same MAC addresses the terminal reports', () => {
    const e = makeEngine();
    const s = e.getState();
    const info = deviceInfo(s, s.equipment['srv-r01-01']);
    const session = { frames: [LAPTOP_FRAME, { kind: 'bmc' as const, equipmentId: 'srv-r01-01', host: 'dh1-r01-n01-bmc', user: 'admin', cwd: '/', via: 'local' as const }], history: [], lastExit: 0, knownHosts: [] };
    const lan = execute({ getState: () => e.getState(), dispatch: (a) => e.dispatch(a) }, session, 'lan print').lines.map(stripAnsi).join('\n');
    expect(lan).toContain(`MAC Address             : ${info.management?.address}`);
  });

  it('part numbers are stable per model and differ between models', () => {
    expect(equipmentPartNumber('srv-1u-ref')).toBe(equipmentPartNumber('srv-1u-ref'));
    expect(equipmentPartNumber('srv-1u-ref')).not.toBe(equipmentPartNumber('srv-4u-gpu-ref'));
    expect(componentPartNumber('gpu-sxm-ref-80g')).toMatch(/^GPU-/);
    expect(componentPartNumber('psu-crps-1200')).toMatch(/^PSU-/);
  });

  it('reflects a pulled cable and staged hardware', () => {
    const e = makeEngine();
    unplug(e, 'srv-r01-01:bmc');
    const s = e.getState();
    expect(deviceInfo(s, s.equipment['srv-r01-01']).management).toMatchObject({ state: 'disconnected', peer: undefined });
    const spare = deviceInfo(s, s.equipment['spare-srv-1u-01']);
    expect(spare).toMatchObject({ location: 'Inventory / spares cage', rackId: undefined });
    expect(spare.management?.ip).toBe('10.10.1.30');
  });
});
