import { describe, expect, it } from 'vitest';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { isHost } from '@/simulation/core/SimulationState';
import { deepClone, deepEqual, reconcile } from '@/simulation/core/snapshot';
import { occupiedRanges } from '@/simulation/hardware/Rack';
import { buildInitialState } from '@/simulation/scenario/buildInitialState';
import { makeEngine, ok } from '@/test/engine';

describe('Data Hall 01 seed integrity', () => {
  const s = makeEngine().getState();

  it('has the expected inventory of racks and rack-scale systems', () => {
    expect(Object.keys(s.racks)).toEqual(['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07']);
    const trays = Object.values(s.equipment).filter((e) => e.kind === 'compute_tray' && e.location.kind === 'rack');
    expect(trays.filter((t) => t.location.kind === 'rack' && t.location.rackId === 'R05')).toHaveLength(18);
    const gpus = Object.values(s.components).filter((c) => c.category === 'gpu' && c.id.startsWith('ct-r05'));
    expect(gpus).toHaveLength(72);
    const graces = Object.values(s.components).filter((c) => c.modelId === 'cpu-grace' && c.id.startsWith('ct-r05'));
    expect(graces).toHaveLength(36);
    expect(Object.values(s.equipment).filter((e) => e.kind === 'nvlink_switch_tray' && e.id.includes('r05'))).toHaveLength(9);
  });

  it('no rack has overlapping equipment and nothing exceeds rack height', () => {
    for (const rack of Object.values(s.racks)) {
      const ranges = occupiedRanges(s, rack.id);
      for (let i = 1; i < ranges.length; i++) expect(ranges[i].start).toBeGreaterThan(ranges[i - 1].end);
      for (const r of ranges) expect(r.end).toBeLessThanOrEqual(rack.heightU);
    }
  });

  it('every attached cable is link-compatible', () => {
    for (const c of Object.values(s.cables)) expect(c.state === 'connected' || c.state === 'available', `${c.id} ${c.reason}`).toBe(true);
  });

  it('all mounted hosts are running; only the seeded DCT-0002 host is degraded', () => {
    const hosts = Object.values(s.equipment).filter((e) => isHost(e) && e.location.kind === 'rack');
    const notRunning = hosts.filter((h) => h.state !== 'os_running');
    expect(notRunning.map((h) => `${h.id}:${h.state}`)).toEqual(['srv-r02-n04:degraded']);
    // One of two PSUs has no input: redundancy lost.
    expect(s.equipment['srv-r02-n04'].powerStatus).toBe('degraded');
  });

  it('every link that should be up is up', () => {
    const down = Object.values(s.ports).filter((p) => p.cableId && p.peerPortId && ['data', 'fabric', 'uplink', 'bmc', 'mgmt'].includes(p.role) && p.state !== 'link_up');
    expect(down.map((p) => `${p.id}: ${p.reason}`)).toEqual([]);
  });

  it('temperatures start at equilibrium and below warning thresholds', () => {
    for (const c of Object.values(s.components)) {
      expect(Math.abs(c.temperatureC - c.targetTempC), c.id).toBeLessThan(0.2);
      expect(c.conditions.filter((x) => x.code.startsWith('TEMP')), c.id).toEqual([]);
    }
  });

  it('builds deterministically (same serials every time)', () => {
    const a = buildInitialState();
    const b = buildInitialState();
    expect(a.equipment['srv-r01-01'].serial).toBe(b.equipment['srv-r01-01'].serial);
    expect(deepEqual(a, b)).toBe(true);
  });

  it('every equipment model referenced by the seed exists with sane metadata', () => {
    for (const e of Object.values(s.equipment)) {
      const m = getEquipmentModel(e.modelId);
      expect(m.accuracy).toBeTruthy();
      expect(m.heightU).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('snapshot reconciliation', () => {
  it('shares unchanged entities between snapshots and isolates the working copy', () => {
    const e = makeEngine();
    const before = e.getState();
    ok(e, { type: 'equipment/setUid', equipmentId: 'srv-r01-01', on: true });
    const after = e.getState();
    expect(after).not.toBe(before);
    expect(after.equipment['srv-r01-01']).not.toBe(before.equipment['srv-r01-01']);
    expect(after.equipment['srv-r02-s01']).toBe(before.equipment['srv-r02-s01']);
    expect(after.components).toBe(before.components);
    expect(before.equipment['srv-r01-01'].uidLed).toBe(false);
  });

  it('reconcile returns the previous snapshot when nothing changed', () => {
    const s = buildInitialState();
    const snap = reconcile(null, s);
    expect(reconcile(snap, deepClone(s))).toBe(snap);
  });
});
