import { describe, expect, it } from 'vitest';
import { freeUnits, occupiedRanges, placementChecks } from '@/simulation/hardware/Rack';
import { newEquipment } from '@/simulation/scenario/factory';
import { advanceS, makeEngine, ok, rejects } from '@/test/engine';

describe('rack U-position constraints', () => {
  it('mounts inventory equipment into a free position', () => {
    const e = makeEngine();
    const r = ok(e, { type: 'equipment/mount', equipmentId: 'spare-srv-1u-01', rackId: 'R07', uStart: 10 });
    expect(r.warnings).toEqual([]);
    const eq = e.getState().equipment['spare-srv-1u-01'];
    expect(eq.location).toEqual({ kind: 'rack', rackId: 'R07', uStart: 10 });
    expect(eq.desiredPower).toBe('off');
    expect(freeUnits(e.getState(), 'R07')).not.toContain(10);
  });

  it('rejects overlapping equipment', () => {
    const e = makeEngine();
    const msg = rejects(e, { type: 'equipment/mount', equipmentId: 'spare-srv-1u-01', rackId: 'R01', uStart: 12 }, 'OVERLAP');
    expect(msg).toMatch(/overlaps dh1-r01-n03/);
  });

  it('rejects positions beyond the top of the rack', () => {
    const e = makeEngine();
    rejects(e, { type: 'equipment/mount', equipmentId: 'spare-srv-1u-01', rackId: 'R07', uStart: 43 }, 'OUT_OF_RANGE');
    rejects(e, { type: 'equipment/mount', equipmentId: 'spare-srv-1u-01', rackId: 'R07', uStart: 0 }, 'OUT_OF_RANGE');
  });

  it('rejects compute trays in a standard rack and standard servers in an MGX rack', () => {
    const e = makeEngine();
    expect(rejects(e, { type: 'equipment/mount', equipmentId: 'spare-ct-gb200-01', rackId: 'R07', uStart: 5 }, 'RACK_TYPE')).toMatch(/needs an MGX rack/);
    expect(rejects(e, { type: 'equipment/mount', equipmentId: 'spare-srv-1u-01', rackId: 'R05', uStart: 36 }, 'RACK_TYPE')).toMatch(/standard 19-inch rails/);
  });

  it('warns when heavy equipment is mounted high', () => {
    const e = makeEngine((s) => {
      newEquipment(s, { id: 'spare-gpu-srv', modelId: 'srv-4u-gpu-ref', hostname: 'dh1-new-g01', location: { kind: 'inventory' } });
    });
    const r = ok(e, { type: 'equipment/mount', equipmentId: 'spare-gpu-srv', rackId: 'R07', uStart: 30 });
    expect(r.warnings.join(' ')).toMatch(/Heavy equipment \(75 kg\) above U20/);
  });

  it('a 4U chassis occupies four contiguous units', () => {
    const e = makeEngine();
    const r = occupiedRanges(e.getState(), 'R03').find((x) => x.equipmentId === 'srv-r03-g01');
    expect(r).toEqual({ equipmentId: 'srv-r03-g01', start: 6, end: 9 });
  });

  it('removal requires power off and all cables disconnected', () => {
    const e = makeEngine();
    rejects(e, { type: 'equipment/unmount', equipmentId: 'srv-r01-01' }, 'POWERED_ON');
    ok(e, { type: 'equipment/power', equipmentId: 'srv-r01-01', power: 'off' });
    advanceS(e, 1);
    expect(rejects(e, { type: 'equipment/unmount', equipmentId: 'srv-r01-01' }, 'CABLES_ATTACHED')).toMatch(/Disconnect 5 cable/);
  });

  it('placement checks flag open U and single-feed power', () => {
    const e = makeEngine();
    const r01 = placementChecks(e.getState(), 'R01').map((i) => i.message).join('\n');
    expect(r01).toMatch(/2 open U without blanking panels/);
    const r02 = placementChecks(e.getState(), 'R02').map((i) => i.message).join('\n');
    expect(r02).toMatch(/dh1-r02-n04: 1 PSU\(s\) without a power cord/);
  });
});
