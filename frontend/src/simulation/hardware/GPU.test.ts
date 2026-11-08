import { describe, expect, it } from 'vitest';
import { componentHealthVia, equipmentHealthVia } from '@/simulation/diagnostics/DiagnosticEngine';
import { advanceS, makeEngine, ok } from '@/test/engine';

describe('GPU discovery and health', () => {
  it('a healthy GPU node has all GPUs initialized with 18/18 NVLinks', () => {
    const s = makeEngine().getState();
    for (let i = 0; i < 4; i++) {
      const g = s.components[`ct-r05-01/gpu${i}`].gpu!;
      expect(g.lifecycle).toBe('initialized');
      expect(g.nvlinkActive).toBe(18);
      expect(g.memTotalGB).toBe(186);
    }
    expect(s.components['ct-r06-01/gpu0'].gpu?.memTotalGB).toBe(288);
  });

  it('a GPU that fell off the bus is not enumerated and only the OS/driver can tell', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'gpu_fallen_off_bus', targetId: 'ct-r05-07/gpu2' });
    const s = e.getState();
    const gpu = s.components['ct-r05-07/gpu2'];
    expect(gpu.gpu?.lifecycle).toBe('installed');
    expect(gpu.gpu?.xids).toContain(79);
    expect(gpu.status).toBe('not_detected');
    expect(s.equipment['ct-r05-07'].state).toBe('degraded');
    // Hidden from the BMC, visible to the driver channel.
    expect(componentHealthVia(s, gpu, 'bmc')).toBe('ok');
    expect(componentHealthVia(s, gpu, 'driver')).toBe('critical');
    expect(equipmentHealthVia(s, s.equipment['ct-r05-07'], 'bmc')).toBe('ok');
  });

  it('GPUs are not detected while the host is off', () => {
    const e = makeEngine();
    ok(e, { type: 'equipment/power', equipmentId: 'srv-r03-g02', power: 'off' });
    expect(e.getState().components['srv-r03-g02/gpu0'].gpu?.lifecycle).toBe('not_powered');
  });

  it('a failed PCIe riser hides the GPUs and NICs behind it', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'riser_failure', targetId: 'srv-r03-g01/riser0' });
    const s = e.getState();
    for (let i = 0; i < 4; i++) expect(s.components[`srv-r03-g01/gpu${i}`].gpu?.lifecycle).toBe('installed');
    for (let i = 4; i < 8; i++) expect(s.components[`srv-r03-g01/gpu${i}`].gpu?.lifecycle).toBe('initialized');
    expect(s.components['srv-r03-g01/nic0'].status).toBe('not_detected');
    expect(s.ports['srv-r03-g01:nic0.p0'].state).toBe('link_down');
    expect(s.ports['srv-r03-g01:nic2.p0'].state).toBe('link_up');
  });

  it('an HBM uncorrectable ECC error fails the GPU with XID 48', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'hbm_ecc_uncorrectable', targetId: 'ct-r06-02/gpu1', params: { count: 7 } });
    const g = e.getState().components['ct-r06-02/gpu1'];
    expect(g.status).toBe('failed');
    expect(g.gpu?.eccUncorrectable).toBe(7);
    expect(g.gpu?.xids).toContain(48);
    expect(g.gpu?.utilizationPct).toBe(0);
  });

  it('non-fatal XIDs warn without failing the GPU', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'gpu_xid', targetId: 'srv-r03-g01/gpu5', params: { xid: 13 } });
    const g = e.getState().components['srv-r03-g01/gpu5'];
    expect(g.status).toBe('ok');
    expect(g.health).toBe('warning');
  });

  it('an NVLink switch tray failure removes 2 links from every GPU in that rack only', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'nvswitch_failure', targetId: 'nvs-r05-4' });
    const s = e.getState();
    expect(s.components['ct-r05-01/gpu0'].gpu?.nvlinkActive).toBe(16);
    expect(s.components['ct-r05-18/gpu3'].gpu?.nvlinkActive).toBe(16);
    expect(s.components['ct-r06-01/gpu0'].gpu?.nvlinkActive).toBe(18);
  });

  it('powering off NVLink switch trays degrades NVLink rack-wide', () => {
    const e = makeEngine();
    ok(e, { type: 'equipment/power', equipmentId: 'nvs-r05-1', power: 'off' });
    ok(e, { type: 'equipment/power', equipmentId: 'nvs-r05-2', power: 'off' });
    expect(e.getState().components['ct-r05-05/gpu1'].gpu?.nvlinkActive).toBe(14);
  });

  it('a power cycle recovers a GPU after the fault is cleared', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'gpu_fallen_off_bus', targetId: 'srv-r03-g03/gpu6' });
    const faultId = Object.keys(e.getState().faults)[0];
    ok(e, { type: 'fault/clear', faultId });
    ok(e, { type: 'equipment/powerCycle', equipmentId: 'srv-r03-g03' });
    advanceS(e, 31);
    expect(e.getState().components['srv-r03-g03/gpu6'].gpu?.lifecycle).toBe('initialized');
    expect(e.getState().equipment['srv-r03-g03'].state).toBe('os_running');
  });
});
