import { describe, expect, it } from 'vitest';
import { computeAirflow } from '@/simulation/hardware/Fan';
import { advanceS, makeEngine, ok } from '@/test/engine';

describe('air cooling', () => {
  it('N+1 fans compensate for one failure; remaining fans speed up', () => {
    const healthy = computeAirflow(6, 6, 1, false);
    const oneDown = computeAirflow(6, 5, 1, false);
    const twoDown = computeAirflow(6, 4, 1, false);
    expect(oneDown.airflowFactor).toBe(1);
    expect(oneDown.duty).toBeGreaterThan(healthy.duty);
    expect(twoDown.airflowFactor).toBeLessThan(1);
  });

  it('a failed fan module stops and raises a fan condition', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'fan_failure', targetId: 'srv-r03-g01/fan0' });
    const s = e.getState();
    expect(s.components['srv-r03-g01/fan0'].rpm).toBe(0);
    expect(s.components['srv-r03-g01/fan1'].dutyPct).toBeGreaterThan(0);
    expect(s.equipment['srv-r03-g01'].state).toBe('degraded');
  });

  it('losing every fan overheats the host until thermal protection trips it', () => {
    const e = makeEngine();
    const start = e.getState().components['srv-r01-01/cpu0'].temperatureC;
    for (let i = 0; i < 6; i++) ok(e, { type: 'fault/inject', faultType: 'fan_failure', targetId: `srv-r01-01/fan${i}` });
    advanceS(e, 5);
    expect(e.getState().components['srv-r01-01/cpu0'].temperatureC).toBeGreaterThan(start + 10);
    advanceS(e, 30);
    const eq = e.getState().equipment['srv-r01-01'];
    expect(eq.thermalTrip).toBe(true);
    expect(eq.state).toBe('standby');
    expect(e.getState().events.some((ev) => /thermal trip/.test(ev.message))).toBe(true);
  });

  it('an open chassis on a running host reduces airflow and logs intrusion', () => {
    const e = makeEngine();
    ok(e, { type: 'equipment/setChassisOpen', equipmentId: 'srv-r03-g01', open: true });
    const eq = e.getState().equipment['srv-r03-g01'];
    expect(eq.airflowFactor).toBeLessThan(1);
    expect(eq.conditions.map((c) => c.code)).toContain('CHASSIS_INTRUSION');
    const before = e.getState().components['srv-r03-g01/gpu0'].temperatureC;
    advanceS(e, 30);
    expect(e.getState().components['srv-r03-g01/gpu0'].temperatureC).toBeGreaterThan(before);
  });

  it('a degraded GPU cooling path makes one GPU run hotter than its peers and throttle', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'gpu_cooling_degraded', targetId: 'srv-r03-g01/gpu3' });
    advanceS(e, 60);
    const s = e.getState();
    const hot = s.components['srv-r03-g01/gpu3'];
    const peer = s.components['srv-r03-g01/gpu2'];
    expect(hot.temperatureC).toBeGreaterThan(peer.temperatureC + 20);
    expect(hot.gpu?.throttleReasons).toContain('HW Thermal Slowdown');
  });
});

describe('liquid cooling', () => {
  it('a single pump failure keeps flow (N+1) but raises a redundancy warning', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'pump_failure', targetId: 'cdu-01/pump0' });
    const s = e.getState();
    expect(s.racks.R05.coolant?.flowPct).toBe(100);
    expect(s.racks.R05.coolant?.status).toBe('warning');
    expect(s.equipment['cdu-01'].conditions.map((c) => c.code)).toContain('CDU_PUMP_REDUNDANCY');
  });

  it('losing all pumps stops flow and liquid-cooled GPUs overheat and trip', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'pump_failure', targetId: 'cdu-01/pump0' });
    ok(e, { type: 'fault/inject', faultType: 'pump_failure', targetId: 'cdu-01/pump1' });
    expect(e.getState().racks.R05.coolant?.flowPct).toBe(0);
    advanceS(e, 20);
    const s = e.getState();
    expect(s.equipment['ct-r05-01'].thermalTrip).toBe(true);
    expect(s.equipment['ct-r06-01'].thermalTrip).toBe(true);
    // Air-cooled racks are unaffected.
    expect(s.equipment['srv-r03-g01'].state).toBe('os_running');
  });

  it('a coolant leak reduces flow and triggers leak detection', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'coolant_leak', targetId: 'R05' });
    const s = e.getState();
    expect(s.racks.R05.coolant).toMatchObject({ flowPct: 70, leak: true, status: 'critical' });
    expect(s.racks.R06.coolant?.leak).toBe(false);
    expect(s.equipment['ct-r05-03'].conditions.map((c) => c.code)).toContain('LEAK_DETECTED');
  });

  it('raising the CRAH supply temperature raises air-cooled inlet temperatures', () => {
    const e = makeEngine();
    const before = e.getState().equipment['srv-r01-01'].inletC;
    ok(e, { type: 'facility/setCrahSupply', tempC: 27 });
    expect(e.getState().equipment['srv-r01-01'].inletC).toBeCloseTo(before + 5, 1);
  });
});
