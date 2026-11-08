import { describe, expect, it } from 'vitest';
import { getWorkOrder, resolveSetup, WORK_ORDERS } from '@/data/workorders/workOrders';
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
