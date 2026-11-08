import { describe, expect, it } from 'vitest';
import { UNSAFE_STANDBY_WARNING } from '@/simulation/hardware/Compatibility';
import { advanceS, makeEngine, ok, rejects, unplug } from '@/test/engine';

const host = 'srv-r01-01';

function serviceMode(e: ReturnType<typeof makeEngine>) {
  ok(e, { type: 'equipment/power', equipmentId: host, power: 'off' });
  ok(e, { type: 'equipment/setChassisOpen', equipmentId: host, open: true });
}

describe('component compatibility and servicing rules', () => {
  it('internal parts need the lid open', () => {
    const e = makeEngine();
    expect(rejects(e, { type: 'component/remove', componentId: `${host}/dimm0_0` }, 'CHASSIS_CLOSED')).toMatch(/Open the chassis lid/);
  });

  it('non-hot-swap parts need the host powered off', () => {
    const e = makeEngine();
    ok(e, { type: 'equipment/setChassisOpen', equipmentId: host, open: true });
    rejects(e, { type: 'component/remove', componentId: `${host}/dimm0_0` }, 'HOST_RUNNING');
  });

  it('a DDR4 DIMM cannot be installed in a DDR5 slot', () => {
    const e = makeEngine();
    serviceMode(e);
    const msg = rejects(e, { type: 'component/install', componentId: 'spare-ddr4-32g-01', equipmentId: host, slotId: 'dimm0_4' }, 'INCOMPATIBLE');
    expect(msg).toMatch(/accepts DDR5-RDIMM.*DDR4-RDIMM/);
  });

  it('servicing with standby power present succeeds with an unsafe-procedure warning', () => {
    const e = makeEngine();
    serviceMode(e);
    const r = ok(e, { type: 'component/install', componentId: 'spare-ddr5-64g-01', equipmentId: host, slotId: 'dimm0_4' });
    expect(r.warnings).toContain(UNSAFE_STANDBY_WARNING);
    expect(e.getState().events.some((ev) => ev.category === 'procedure' && /Unsafe procedure/.test(ev.message))).toBe(true);
  });

  it('servicing with AC removed produces no warning', () => {
    const e = makeEngine();
    serviceMode(e);
    unplug(e, `${host}:psu1.ac`);
    unplug(e, `${host}:psu2.ac`);
    expect(e.getState().equipment[host].state).toBe('powered_off');
    const r = ok(e, { type: 'component/install', componentId: 'spare-ddr5-64g-01', equipmentId: host, slotId: 'dimm0_4' });
    expect(r.warnings).toEqual([]);
  });

  it('GPUs in GB200 compute trays are not field-replaceable', () => {
    const e = makeEngine();
    expect(rejects(e, { type: 'component/remove', componentId: 'ct-r05-01/gpu0' }, 'NOT_FRU')).toMatch(/replace the compute tray/);
  });

  it('PSUs must match the installed model; cords must be unplugged first', () => {
    const e = makeEngine();
    rejects(e, { type: 'component/remove', componentId: `${host}/psu1` }, 'CABLES_ATTACHED');
    const cord = unplug(e, `${host}:psu1.ac`);
    ok(e, { type: 'component/remove', componentId: `${host}/psu1` });
    expect(e.getState().ports[`${host}:psu1.ac`]).toBeUndefined();
    expect(rejects(e, { type: 'component/install', componentId: 'spare-psu2000-01', equipmentId: host, slotId: 'psu1' }, 'PSU_MISMATCH')).toMatch(/1200 W CRPS/);
    ok(e, { type: 'component/install', componentId: 'spare-psu1200-01', equipmentId: host, slotId: 'psu1' });
    ok(e, { type: 'cable/connect', cableId: cord.cableId, end: cord.end, portId: `${host}:psu1.ac` });
    expect(e.getState().components['spare-psu1200-01'].delivering).toBe(true);
    expect(e.getState().equipment[host].powerStatus).toBe('redundant');
  });

  it('hot-swapping the last working PSU drops the host', () => {
    const e = makeEngine();
    unplug(e, `${host}:psu2.ac`);
    expect(e.getState().equipment[host].state).toBe('degraded');
    unplug(e, `${host}:psu1.ac`);
    expect(e.getState().equipment[host].state).toBe('powered_off');
  });

  it('a faulty part keeps its fault after removal; the repaired host is healthy', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'dimm_uncorrectable', targetId: `${host}/dimm0_0` });
    expect(e.getState().equipment[host].state).toBe('degraded');
    serviceMode(e);
    ok(e, { type: 'component/remove', componentId: `${host}/dimm0_0` });
    ok(e, { type: 'component/install', componentId: 'spare-ddr5-64g-01', equipmentId: host, slotId: 'dimm0_0' });
    ok(e, { type: 'equipment/setChassisOpen', equipmentId: host, open: false });
    ok(e, { type: 'equipment/power', equipmentId: host, power: 'on' });
    advanceS(e, 25);
    const s = e.getState();
    expect(s.equipment[host].state).toBe('os_running');
    expect(Object.values(s.faults).some((f) => f.targetId === `${host}/dimm0_0`)).toBe(true);
    expect(s.components[`${host}/dimm0_0`].location.kind).toBe('inventory');
  });
});
