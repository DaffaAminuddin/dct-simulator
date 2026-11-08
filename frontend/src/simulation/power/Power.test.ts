import { describe, expect, it } from 'vitest';
import { advanceS, makeEngine, ok, unplug } from '@/test/engine';

describe('power dependencies', () => {
  it('losing one PSU cord degrades redundancy but the host keeps running', () => {
    const e = makeEngine();
    expect(e.getState().equipment['srv-r01-01'].powerStatus).toBe('redundant');
    unplug(e, 'srv-r01-01:psu1.ac');
    const s = e.getState();
    expect(s.components['srv-r01-01/psu1'].inputLive).toBe(false);
    expect(s.equipment['srv-r01-01'].powerStatus).toBe('degraded');
    expect(s.equipment['srv-r01-01'].state).toBe('degraded');
    expect(s.components['srv-r01-01/psu1'].conditions.map((c) => c.code)).toContain('PSU_NO_INPUT');
  });

  it('losing both cords powers the host off; restoring power reboots it (restore last state)', () => {
    const e = makeEngine();
    const a = unplug(e, 'srv-r01-01:psu1.ac');
    const b = unplug(e, 'srv-r01-01:psu2.ac');
    let eq = e.getState().equipment['srv-r01-01'];
    expect(eq.state).toBe('powered_off');
    expect(eq.bmcAlive).toBe(false);
    expect(eq.conditions.map((c) => c.code)).toContain('NO_POWER');
    ok(e, { type: 'cable/connect', cableId: a.cableId, end: a.end, portId: 'srv-r01-01:psu1.ac' });
    ok(e, { type: 'cable/connect', cableId: b.cableId, end: b.end, portId: 'srv-r01-01:psu2.ac' });
    eq = e.getState().equipment['srv-r01-01'];
    expect(eq.state).toBe('powered_on'); // POST
    advanceS(e, 10);
    expect(e.getState().equipment['srv-r01-01'].state).toBe('booting');
    advanceS(e, 12);
    expect(e.getState().equipment['srv-r01-01'].state).toBe('os_running');
  });

  it('a PDU failure drops one feed for every device in the rack', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'pdu_failure', targetId: 'pdu-r01-a' });
    const s = e.getState();
    expect(s.ports['pdu-r01-a:o1'].live).toBe(false);
    for (let i = 1; i <= 8; i++) {
      const eq = s.equipment[`srv-r01-0${i}`];
      expect(eq.powerStatus).toBe('degraded');
      expect(eq.state).toBe('degraded');
    }
    expect(s.equipment['pdu-r01-b'].powerDemandW).toBeGreaterThan(s.equipment['pdu-r01-a'].powerDemandW);
  });

  it('a facility feed loss degrades the busbar but rack-scale systems keep running', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'feed_loss', targetId: 'feed:A' });
    const s = e.getState();
    expect(s.facility.feeds.A.up).toBe(false);
    expect(s.racks.R05.busbar?.capacityW).toBe(132000);
    expect(s.racks.R05.busbar?.status).toBe('degraded');
    expect(s.equipment['ct-r05-01'].state).toBe('degraded');
    expect(s.equipment['cdu-01'].powerStatus).toBe('available'); // dual-fed via ATS
    expect(s.facility.feeds.B.loadW).toBeGreaterThan(200000);
  });

  it('busbar capacity below demand engages the GPU power brake', () => {
    const e = makeEngine();
    for (let i = 1; i <= 8; i++) {
      for (let p = 0; p < 6; p++) {
        if (i <= 6 || p > 2) ok(e, { type: 'fault/inject', faultType: 'psu_failure', targetId: `pshelf-r05-${i}/psu${p}` });
      }
    }
    // 2 shelves × 3 PSUs × 5.5 kW = 33 kW for a ~100 kW rack
    const s = e.getState();
    expect(s.racks.R05.busbar?.capacityW).toBe(33000);
    const gpu = s.components['ct-r05-01/gpu0'].gpu!;
    expect(gpu.throttleReasons).toContain('HW Power Brake Slowdown');
    expect(gpu.powerLimitW).toBeLessThan(1200);
    expect(s.equipment['ct-r05-01'].state).toBe('degraded');
  });

  it('a host cannot be powered on without input power', () => {
    const e = makeEngine();
    ok(e, { type: 'equipment/power', equipmentId: 'srv-r01-02', power: 'off' });
    unplug(e, 'srv-r01-02:psu1.ac');
    unplug(e, 'srv-r01-02:psu2.ac');
    const r = e.dispatch({ type: 'equipment/power', equipmentId: 'srv-r01-02', power: 'on' });
    expect(r).toMatchObject({ ok: false, code: 'NO_POWER' });
  });
});
