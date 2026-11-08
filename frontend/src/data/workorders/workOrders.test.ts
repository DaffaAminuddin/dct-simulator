import { describe, expect, it } from 'vitest';
import { DIFFICULTY_ORDER, getWorkOrder, resolveSetup, WORK_ORDERS, workOrderDevice } from '@/data/workorders/workOrders';
import { makeEngine, ok } from '@/test/engine';

describe('work orders', () => {
  it('every ticket has unique ids, tasks and resolvable setup', () => {
    const e = makeEngine();
    const ids = new Set(WORK_ORDERS.map((w) => w.id));
    expect(ids.size).toBe(WORK_ORDERS.length);
    for (const w of WORK_ORDERS) {
      expect(w.tasks.length, w.id).toBeGreaterThan(0);
      for (const a of w.setup ?? []) expect(resolveSetup(e.getState(), a), w.id).not.toBeNull();
    }
  });

  it('the queue runs from the easiest ticket to the hardest', () => {
    const ranks = WORK_ORDERS.map((w) => DIFFICULTY_ORDER.indexOf(w.difficulty));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(WORK_ORDERS[0].difficulty).toBe('beginner');
    expect(WORK_ORDERS.at(-1)?.difficulty).toBe('advanced');
    for (let i = 1; i < WORK_ORDERS.length; i++) {
      if (WORK_ORDERS[i].difficulty === WORK_ORDERS[i - 1].difficulty) expect(WORK_ORDERS[i].targetTimeS).toBeGreaterThanOrEqual(WORK_ORDERS[i - 1].targetTimeS);
    }
  });

  it('every ticket names a device that exists', () => {
    const s = makeEngine().getState();
    for (const w of WORK_ORDERS) {
      const id = workOrderDevice(w);
      expect(id, w.id).toBeDefined();
      expect(s.equipment[id as string], w.id).toBeDefined();
    }
  });

  it('DCT-0007: wrong VLAN breaks BMC access; restoring VLAN 10 validates', () => {
    const e = makeEngine();
    const w = getWorkOrder('DCT-0007')!;
    for (const a of w.setup!) ok(e, resolveSetup(e.getState(), a)!);
    expect(w.validate(e.getState()).every((c) => c.ok)).toBe(false);
    const sw = e.getState().ports['srv-r03-g02:bmc'].peerPortId!;
    ok(e, { type: 'port/setVlan', portId: sw, vlan: { mode: 'access', access: 10, allowed: [], native: 1 } });
    expect(w.validate(e.getState()).every((c) => c.ok)).toBe(true);
  });

  it('DCT-0008: laptop power, DHCP and SSH make the onboarding ticket pass', () => {
    const e = makeEngine();
    const w = getWorkOrder('DCT-0008')!;
    expect(w.validate(e.getState()).some((c) => c.ok)).toBe(false);
    const free = (m: string) => Object.values(e.getState().cables).find((c) => c.modelId === m && !c.ends[0].portId && !c.ends[1].portId)!.id;
    const adapter = free('pwr-laptop-adapter');
    ok(e, { type: 'cable/connect', cableId: adapter, end: 1, portId: 'laptop-01:usbc0' });
    ok(e, { type: 'cable/connect', cableId: adapter, end: 0, portId: 'pdu-r01-a:o20' });
    const cat6 = free('cat6-2m');
    ok(e, { type: 'cable/connect', cableId: cat6, end: 0, portId: 'laptop-01:eth0' });
    ok(e, { type: 'cable/connect', cableId: cat6, end: 1, portId: 'oob-r01:ge47' });
    expect(w.validate(e.getState()).every((c) => c.ok)).toBe(true);
  });
});
