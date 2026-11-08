import { describe, expect, it } from 'vitest';
import { getCableModel } from '@/data/cables/cableCatalog';
import { checkFit, evaluateLink } from '@/simulation/networking/Cable';
import { makeEngine, rejects, unplug, ok } from '@/test/engine';
import type { Port } from '@/types/simulation';

function port(p: Partial<Port>): Port {
  return {
    id: p.id ?? 'x:p',
    equipmentId: 'x',
    defId: 'p',
    label: p.label ?? 'port',
    type: p.type ?? 'rj45',
    role: p.role ?? 'data',
    speedsGbps: p.speedsGbps ?? [1],
    side: 'rear',
    adminUp: true,
    cableId: null,
    cableEnd: null,
    state: 'disconnected',
    speedGbps: 0,
    peerPortId: null,
    ...p,
  };
}

describe('connector mechanical fit', () => {
  it('rejects an RJ45 plug in an SFP28 cage', () => {
    const r = checkFit(port({ type: 'sfp28' }), 'rj45');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not fit this SFP28 port/);
  });

  it('rejects a power plug in an Ethernet port', () => {
    expect(checkFit(port({ type: 'rj45' }), 'c13').ok).toBe(false);
    expect(checkFit(port({ type: 'rj45' }), 'c14').ok).toBe(false);
  });

  it('accepts IEC C13 into a PSU C14 inlet and C14 into a PDU C13 outlet', () => {
    expect(checkFit(port({ type: 'psu_c14', role: 'power_in' }), 'c13').ok).toBe(true);
    expect(checkFit(port({ type: 'pdu_c13', role: 'power_out' }), 'c14').ok).toBe(true);
    expect(checkFit(port({ type: 'psu_c20', role: 'power_in' }), 'c13').ok).toBe(false);
  });

  it('QSFP-DD cages are backward compatible with QSFP28 plugs, not the reverse', () => {
    expect(checkFit(port({ type: 'qsfp_dd' }), 'qsfp28').ok).toBe(true);
    expect(checkFit(port({ type: 'qsfp28' }), 'qsfp_dd').ok).toBe(false);
  });

  it('fibre connectors need a matching transceiver', () => {
    expect(checkFit(port({ type: 'sfp28' }), 'lc_duplex').reason).toMatch(/needs an optical transceiver/);
    const withSr = port({ type: 'sfp28', transceiver: { modelId: 'xcvr-sfp28-sr', serial: 'X' } });
    expect(checkFit(withSr, 'lc_duplex').ok).toBe(true);
    expect(checkFit(withSr, 'mpo12').ok).toBe(false);
    expect(checkFit(withSr, 'sfp28').reason).toMatch(/occupied by an optical transceiver/);
  });
});

describe('link compatibility', () => {
  it('an Ethernet cord in a serial console port fits but carries no console', () => {
    const cat6 = getCableModel('cat6-2m');
    expect(checkFit(port({ type: 'serial_rj45', role: 'console' }), 'rj45').ok).toBe(true);
    const r = evaluateLink(port({ type: 'serial_rj45', role: 'console' }), port({ type: 'rj45' }), cat6);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/console \(rollover\) cable/);
  });

  it('a 25G-only DAC cannot link in a 1G SFP port', () => {
    const r = evaluateLink(port({ type: 'sfp', speedsGbps: [1] }), port({ type: 'sfp28', speedsGbps: [25, 10] }), getCableModel('dac-sfp28-1m'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/No common speed/);
  });

  it('negotiates the highest common speed', () => {
    const r = evaluateLink(port({ type: 'sfp28', speedsGbps: [25, 10] }), port({ type: 'sfp_plus', speedsGbps: [10, 1] }), getCableModel('dac-sfp28-1m'));
    expect(r).toMatchObject({ ok: true, speedGbps: 10 });
  });

  it('multimode optics on single-mode fibre do not link', () => {
    const a = port({ type: 'sfp28', speedsGbps: [25, 10], transceiver: { modelId: 'xcvr-sfp28-sr', serial: 'A' } });
    const b = port({ type: 'sfp28', speedsGbps: [25, 10], transceiver: { modelId: 'xcvr-sfp28-sr', serial: 'B' } });
    expect(evaluateLink(a, b, getCableModel('lc-os2-20m')).reason).toMatch(/Multimode optics on single-mode fibre/);
    expect(evaluateLink(a, b, getCableModel('lc-om4-20m'))).toMatchObject({ ok: true, speedGbps: 25 });
  });

  it('an 800G SuperNIC on a 400G fabric switch links at 400G', () => {
    const nic = port({ type: 'osfp', speedsGbps: [800, 400, 200], transceiver: { modelId: 'xcvr-osfp-800-sr8', serial: 'A' } });
    const sw = port({ type: 'osfp', speedsGbps: [400, 200], transceiver: { modelId: 'xcvr-osfp-400-sr4', serial: 'B' } });
    expect(evaluateLink(nic, sw, getCableModel('mpo-om4-30m'))).toMatchObject({ ok: true, speedGbps: 400 });
  });
});

describe('cable/connect action', () => {
  it('rejects plugging an RJ45 cable into an SFP28 switch port', () => {
    const e = makeEngine();
    const cat6 = Object.values(e.getState().cables).find((c) => c.modelId === 'cat6-2m' && c.state === 'available')!;
    const msg = rejects(e, { type: 'cable/connect', cableId: cat6.id, end: 0, portId: 'tor-r07:swp1' in e.getState().ports ? 'tor-r07:swp1' : 'tor-r01:swp20' }, 'CONNECTOR_MISMATCH');
    expect(msg).toMatch(/RJ45 plug does not fit/);
  });

  it('rejects a cable that is too short for the run', () => {
    const e = makeEngine();
    const short = Object.values(e.getState().cables).find((c) => c.modelId === 'mgmt-rj45-1m' && c.state === 'available')!;
    ok(e, { type: 'cable/connect', cableId: short.id, end: 0, portId: 'oob-r01:ge48' });
    const msg = rejects(e, { type: 'cable/connect', cableId: short.id, end: 1, portId: 'oob-r04:ge48' }, 'CABLE_TOO_SHORT');
    expect(msg).toMatch(/needs about/);
  });

  it('rejects an occupied port and keeps state unchanged', () => {
    const e = makeEngine();
    const before = e.getState();
    const spare = Object.values(before.cables).find((c) => c.modelId === 'mgmt-rj45-3m' && c.state === 'available')!;
    rejects(e, { type: 'cable/connect', cableId: spare.id, end: 0, portId: 'srv-r01-01:bmc' }, 'PORT_OCCUPIED');
    expect(e.getState()).toBe(before);
  });

  it('connecting both ends brings the link up and updates cable state', () => {
    const e = makeEngine();
    const old = unplug(e, 'srv-r01-01:bmc');
    expect(e.getState().ports['srv-r01-01:bmc'].state).toBe('disconnected');
    expect(e.getState().cables[old.cableId].state).toBe('connected'); // one end still in the switch
    ok(e, { type: 'cable/connect', cableId: old.cableId, end: old.end, portId: 'srv-r01-01:bmc' });
    expect(e.getState().ports['srv-r01-01:bmc'].state).toBe('link_up');
  });
});
