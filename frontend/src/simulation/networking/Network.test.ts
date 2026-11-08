import { describe, expect, it } from 'vitest';
import { bmcReachability } from '@/simulation/networking/NetworkTopology';
import { advanceS, cableAt, makeEngine, ok, rejects, unplug } from '@/test/engine';

describe('network reachability and link state', () => {
  it('disconnecting the management cable removes remote BMC access; reconnecting restores it', () => {
    const e = makeEngine();
    expect(bmcReachability(e.getState(), 'srv-r01-01').reachable).toBe(true);
    const c = unplug(e, 'srv-r01-01:bmc');
    const r = bmcReachability(e.getState(), 'srv-r01-01');
    expect(r.reachable).toBe(false);
    expect(r.reason).toMatch(/Management port disconnected/);
    // The far end on the switch still has the cable: "connected", no link.
    const sw = e.getState().ports[e.getState().cables[c.cableId].ends[c.end === 0 ? 1 : 0].portId!];
    expect(sw.state).toBe('connected');
    ok(e, { type: 'cable/connect', cableId: c.cableId, end: c.end, portId: 'srv-r01-01:bmc' });
    expect(bmcReachability(e.getState(), 'srv-r01-01').reachable).toBe(true);
  });

  it('a disconnected data cable takes the NIC link down on both ends', () => {
    const e = makeEngine();
    const c = cableAt(e, 'srv-r01-01:ocp0.p0');
    const peer = e.getState().cables[c.cableId].ends[1].portId!;
    unplug(e, 'srv-r01-01:ocp0.p0');
    expect(e.getState().ports['srv-r01-01:ocp0.p0'].state).toBe('disconnected');
    expect(e.getState().ports[peer].state).toBe('connected');
  });

  it('an administratively disabled switch port takes the server link down', () => {
    const e = makeEngine();
    const swPort = e.getState().ports['srv-r01-01:bmc'].peerPortId!;
    ok(e, { type: 'port/setAdmin', portId: swPort, up: false });
    expect(e.getState().ports[swPort].state).toBe('disabled');
    const p = e.getState().ports['srv-r01-01:bmc'];
    expect(p.state).toBe('link_down');
    expect(p.reason).toMatch(/administratively down/);
    expect(bmcReachability(e.getState(), 'srv-r01-01').reachable).toBe(false);
  });

  it('host ports cannot be admin-toggled from the switch API', () => {
    const e = makeEngine();
    rejects(e, { type: 'port/setAdmin', portId: 'srv-r01-01:ocp0.p0', up: false }, 'NOT_A_SWITCH_PORT');
  });

  it('BMC ports stay up in standby; data ports need main power', () => {
    const e = makeEngine();
    ok(e, { type: 'equipment/power', equipmentId: 'srv-r01-01', power: 'off' });
    const s = e.getState();
    expect(s.equipment['srv-r01-01'].state).toBe('standby');
    expect(s.ports['srv-r01-01:bmc'].state).toBe('link_up');
    expect(s.ports['srv-r01-01:ocp0.p0'].state).toBe('link_down');
  });

  it('a powered-off management switch takes every BMC link in the rack down', () => {
    const e = makeEngine();
    ok(e, { type: 'equipment/power', equipmentId: 'oob-r01', power: 'off' });
    const s = e.getState();
    for (let i = 1; i <= 8; i++) expect(s.ports[`srv-r01-0${i}:bmc`].state).toBe('link_down');
  });

  it('damaged cable, faulty port and failed NIC each take the link down', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'cable_damaged', targetId: cableAt(e, 'srv-r01-01:ocp0.p0').cableId });
    expect(e.getState().ports['srv-r01-01:ocp0.p0'].reason).toMatch(/cable fault/);
    ok(e, { type: 'fault/inject', faultType: 'port_faulty', targetId: 'srv-r01-02:ocp0.p0' });
    expect(e.getState().ports['srv-r01-02:ocp0.p0'].state).toBe('faulty');
    ok(e, { type: 'fault/inject', faultType: 'nic_failure', targetId: 'srv-r01-03/ocp0' });
    expect(e.getState().ports['srv-r01-03:ocp0.p1'].state).toBe('faulty');
  });

  it('seeded links negotiate expected speeds (backward-compatible cages, 800G NIC on 400G fabric)', () => {
    const e = makeEngine();
    const s = e.getState();
    expect(s.ports['srv-r01-01:ocp0.p0'].speedGbps).toBe(25);
    expect(s.ports['tor-r01:swp49'].speedGbps).toBe(100); // QSFP28 AOC into QSFP-DD spine
    expect(s.ports['ct-r06-01:nic0.p0'].speedGbps).toBe(400);
    expect(s.ports['oob-r01:xe1'].speedGbps).toBe(10); // SFP+ optic in SFP28 aggregation port
  });

  it('booting a host brings its data links up', () => {
    const e = makeEngine();
    ok(e, { type: 'equipment/power', equipmentId: 'srv-r01-01', power: 'off' });
    ok(e, { type: 'equipment/power', equipmentId: 'srv-r01-01', power: 'on' });
    expect(e.getState().ports['srv-r01-01:ocp0.p0'].state).toBe('link_up');
    advanceS(e, 21);
    expect(e.getState().equipment['srv-r01-01'].state).toBe('os_running');
  });
});
