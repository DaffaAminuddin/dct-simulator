import { describe, expect, it } from 'vitest';
import { bmcReachability } from '@/simulation/networking/NetworkTopology';
import { httpsGet, ping, routeFromLaptop, sshConnect } from '@/simulation/networking/Reachability';
import type { SimulationEngine } from '@/simulation/core/SimulationEngine';
import { cableAt, makeEngine, ok, rejects, unplug } from '@/test/engine';

const ETH0 = 'laptop-01:eth0';

function spare(e: SimulationEngine, modelId: string): string {
  const c = Object.values(e.getState().cables).find((x) => x.modelId === modelId && !x.ends[0].portId && !x.ends[1].portId);
  if (!c) throw new Error(`no spare ${modelId}`);
  return c.id;
}

/** Patch the laptop into a port with a spare cable. */
function patchLaptop(e: SimulationEngine, portId: string, modelId = 'cat6-2m'): string {
  const id = spare(e, modelId);
  ok(e, { type: 'cable/connect', cableId: id, end: 0, portId: ETH0 });
  ok(e, { type: 'cable/connect', cableId: id, end: 1, portId });
  return id;
}

describe('technician laptop: power', () => {
  it('starts on battery, drains, and charges once the adapter is plugged into a live outlet', () => {
    const e = makeEngine();
    const ws0 = e.getState().workstation;
    expect(ws0).toMatchObject({ onAc: false, poweredOn: true, batteryPct: 80 });
    e.advance(30000);
    expect(e.getState().workstation.batteryPct).toBeLessThan(80);
    const adapter = spare(e, 'pwr-laptop-adapter');
    ok(e, { type: 'cable/connect', cableId: adapter, end: 1, portId: 'laptop-01:usbc0' });
    ok(e, { type: 'cable/connect', cableId: adapter, end: 0, portId: 'pdu-r01-b:o20' });
    expect(e.getState().workstation.onAc).toBe(true);
    const before = e.getState().workstation.batteryPct;
    e.advance(30000);
    expect(e.getState().workstation.batteryPct).toBeGreaterThan(before);
  });

  it('shuts down at 0 % battery and drops its link', () => {
    const e = makeEngine((s) => {
      s.workstation.batteryPct = 0.5;
    });
    patchLaptop(e, 'oob-r01:ge48');
    expect(e.getState().ports[ETH0].state).toBe('link_up');
    e.advance(60000);
    expect(e.getState().workstation.poweredOn).toBe(false);
    expect(e.getState().ports[ETH0].state).toBe('link_down');
    expect(e.getState().events.some((ev) => /battery empty/.test(ev.message))).toBe(true);
  });
});

describe('technician laptop: addressing', () => {
  it('gets a DHCP lease on the OOB management VLAN', () => {
    const e = makeEngine();
    patchLaptop(e, 'oob-r01:ge48');
    const ws = e.getState().workstation;
    expect(e.getState().ports[ETH0].speedGbps).toBe(1);
    expect(ws.effective).toMatchObject({ source: 'dhcp', address: '10.10.250.100', prefix: 16, gateway: '10.10.0.1', dns: '10.10.0.53', networkId: 'oob' });
    expect(e.getState().events.some((ev) => /DHCP lease 10\.10\.250\.100/.test(ev.message))).toBe(true);
  });

  it('falls back to a link-local address on a VLAN without DHCP', () => {
    const e = makeEngine();
    ok(e, { type: 'port/setVlan', portId: 'oob-r01:ge48', vlan: { mode: 'access', access: 20, allowed: [], native: 1 } });
    patchLaptop(e, 'oob-r01:ge48');
    expect(e.getState().workstation.effective.source).toBe('apipa');
    expect(e.getState().workstation.effective.address).toMatch(/^169\.254\./);
  });

  it('validates static configuration', () => {
    const e = makeEngine();
    rejects(e, { type: 'workstation/configure', net: { mode: 'static', address: '10.10.300.1' } }, 'INVALID_IP');
    rejects(e, { type: 'workstation/configure', net: { mode: 'static', address: '10.10.0.0', prefix: 16 } }, 'INVALID_IP');
    rejects(e, { type: 'workstation/configure', net: { vlan: 5000 } }, 'INVALID_VLAN');
    const r = ok(e, { type: 'workstation/configure', net: { mode: 'static', address: '10.10.1.200', prefix: 24, gateway: '10.10.0.1' } });
    expect(r.warnings.join(' ')).toMatch(/outside 10\.10\.1\.200\/24/);
  });

  it('flags a static address that duplicates a device', () => {
    const e = makeEngine();
    patchLaptop(e, 'oob-r01:ge48');
    ok(e, { type: 'workstation/configure', net: { mode: 'static', address: '10.10.1.11', prefix: 16, gateway: '10.10.0.1' } });
    expect(e.getState().workstation.conflict).toBe(true);
  });
});

describe('technician laptop: reachability', () => {
  it('pings and SSHes to a BMC by address and by DNS name', () => {
    const e = makeEngine();
    patchLaptop(e, 'oob-r01:ge48');
    const s = e.getState();
    expect(ping(s, '10.10.1.11').ok).toBe(true);
    expect(ping(s, 'dh1-r01-n01-bmc').lines.at(-1)).toMatch(/4 received, 0% packet loss/);
    expect(sshConnect(s, 'dh1-r01-n01-bmc', 'bmc-admin').ok).toBe(true);
    const denied = sshConnect(s, '10.10.1.11', 'linux-dct');
    expect(denied).toMatchObject({ ok: false, code: 'auth' });
    expect(denied.lines[0]).toMatch(/Permission denied/);
  });

  it('reaches BMCs in other racks through the OOB aggregation (routed path not needed in one /16)', () => {
    const e = makeEngine();
    patchLaptop(e, 'oob-r01:ge48');
    const r = routeFromLaptop(e.getState(), '10.10.5.11');
    expect(r.ok).toBe(true);
    expect(sshConnect(e.getState(), 'dh1-r05-gb200-ct01-bmc', 'bmc-admin').ok).toBe(true);
  });

  it('SSH fails while the management cable is out and works again once it is reconnected', () => {
    const e = makeEngine();
    patchLaptop(e, 'oob-r01:ge48');
    const c = unplug(e, 'srv-r01-01:bmc');
    const fail = sshConnect(e.getState(), '10.10.1.11', 'bmc-admin');
    expect(fail.ok).toBe(false);
    expect(fail.lines[0]).toMatch(/No route to host/);
    ok(e, { type: 'cable/connect', cableId: c.cableId, end: c.end, portId: 'srv-r01-01:bmc' });
    expect(sshConnect(e.getState(), '10.10.1.11', 'bmc-admin').ok).toBe(true);
  });

  it('the firewall isolates the OOB network from the data network', () => {
    const e = makeEngine();
    patchLaptop(e, 'oob-r01:ge48');
    const r = ping(e.getState(), 'dh1-r01-n01');
    expect(r.code).toBe('timeout');
    expect(r.why).toMatch(/FW-OOB-ISOLATION/);
  });

  it('a wrong access VLAN on the switch port isolates a BMC although the link stays up', () => {
    const e = makeEngine();
    patchLaptop(e, 'oob-r01:ge48');
    const swPort = e.getState().ports['srv-r01-03:bmc'].peerPortId!;
    ok(e, { type: 'port/setVlan', portId: swPort, vlan: { mode: 'access', access: 20, allowed: [], native: 1 } });
    const s = e.getState();
    expect(s.ports['srv-r01-03:bmc'].state).toBe('link_up');
    expect(ping(s, '10.10.1.13').code).toBe('unreachable');
    const noc = bmcReachability(s, 'srv-r01-03');
    expect(noc.reachable).toBe(false);
    expect(noc.reason).toMatch(/VLAN 10 path/);
  });

  it('a direct laptop-to-BMC cable works with a static address in the BMC subnet', () => {
    const e = makeEngine();
    unplug(e, 'srv-r01-02:bmc');
    patchLaptop(e, 'srv-r01-02:bmc');
    expect(e.getState().workstation.effective.source).toBe('apipa');
    expect(ping(e.getState(), '10.10.1.12').ok).toBe(false);
    ok(e, { type: 'workstation/configure', net: { mode: 'static', address: '10.10.1.200', prefix: 16, gateway: '' } });
    expect(ping(e.getState(), '10.10.1.12').ok).toBe(true);
    expect(ping(e.getState(), '10.10.1.11').ok).toBe(false);
  });

  it('a VLAN tag on an access port is dropped', () => {
    const e = makeEngine();
    patchLaptop(e, 'oob-r01:ge48');
    ok(e, { type: 'workstation/configure', net: { mode: 'static', address: '10.10.250.50', prefix: 16, gateway: '10.10.0.1', vlan: 10 } });
    expect(routeFromLaptop(e.getState(), '10.10.1.11').why).toMatch(/dropped/);
  });

  it('an address in the wrong subnet without a gateway cannot reach the BMCs', () => {
    const e = makeEngine();
    patchLaptop(e, 'oob-r01:ge48');
    ok(e, { type: 'workstation/configure', net: { mode: 'static', address: '192.168.1.50', prefix: 24, gateway: '' } });
    expect(ping(e.getState(), '10.10.1.11').lines[0]).toMatch(/Network is unreachable/);
  });

  it('with the OOB router down, monitoring loses the BMCs but local layer 2 still works', () => {
    const e = makeEngine();
    patchLaptop(e, 'oob-r01:ge48');
    ok(e, { type: 'workstation/configure', net: { mode: 'static', address: '10.10.250.60', prefix: 16, gateway: '10.10.0.1' } });
    ok(e, { type: 'equipment/power', equipmentId: 'agg-r04', power: 'off' });
    const s = e.getState();
    expect(bmcReachability(s, 'srv-r01-01').reachable).toBe(false);
    expect(ping(s, '10.10.1.11').ok).toBe(true);
    expect(ping(s, '10.10.5.11').ok).toBe(false);
  });

  it('DNS fails without a DNS server; HTTPS works only on BMCs', () => {
    const e = makeEngine();
    patchLaptop(e, 'oob-r01:ge48');
    expect(httpsGet(e.getState(), 'https://10.10.1.11').ok).toBe(true);
    expect(httpsGet(e.getState(), 'https://10.10.1.2').code).toBe('refused');
    ok(e, { type: 'workstation/configure', net: { mode: 'static', address: '10.10.250.61', prefix: 16, gateway: '10.10.0.1', dns: '' } });
    expect(ping(e.getState(), 'dh1-r01-n01-bmc').lines[0]).toMatch(/Temporary failure in name resolution/);
  });

  it('reports no carrier while unplugged', () => {
    const e = makeEngine();
    expect(ping(e.getState(), '10.10.1.11').lines[0]).toMatch(/no carrier/);
  });
});

describe('technician laptop: cart, cabling and console', () => {
  it('cable length is checked from the cart', () => {
    const e = makeEngine();
    const id = spare(e, 'cat6-2m');
    ok(e, { type: 'cable/connect', cableId: id, end: 0, portId: ETH0 });
    rejects(e, { type: 'cable/connect', cableId: id, end: 1, portId: 'oob-r04:ge40' }, 'CABLE_TOO_SHORT');
  });

  it('the cart can only move once the laptop is unplugged', () => {
    const e = makeEngine();
    patchLaptop(e, 'oob-r01:ge48');
    rejects(e, { type: 'workstation/move', rackId: 'R04', side: 'rear' }, 'CABLES_ATTACHED');
    unplug(e, ETH0);
    const c = cableAt(e, 'oob-r01:ge48');
    ok(e, { type: 'cable/disconnect', cableId: c.cableId, end: c.end });
    ok(e, { type: 'workstation/move', rackId: 'R04', side: 'rear' });
    expect(e.getState().equipment['laptop-01'].location).toEqual({ kind: 'cart', rackId: 'R04', side: 'rear' });
  });

  it('a console cable from USB-A to a host console port opens a serial console', () => {
    const e = makeEngine();
    const id = spare(e, 'console-rj45-usb');
    ok(e, { type: 'cable/connect', cableId: id, end: 1, portId: 'laptop-01:usb0' });
    expect(e.getState().workstation.consoleReason).toMatch(/far end loose/);
    ok(e, { type: 'cable/connect', cableId: id, end: 0, portId: 'srv-r01-01:console' });
    expect(e.getState().workstation.consoleEquipmentId).toBe('srv-r01-01');
  });

  it('an Ethernet cord in a console port carries no console', () => {
    const e = makeEngine();
    const id = spare(e, 'cat6-2m');
    ok(e, { type: 'cable/connect', cableId: id, end: 0, portId: 'srv-r01-01:console' });
    rejects(e, { type: 'cable/connect', cableId: id, end: 1, portId: 'laptop-01:usb0' }, 'CONNECTOR_MISMATCH');
  });

  it('VLAN changes are limited to Ethernet switch ports and validated', () => {
    const e = makeEngine();
    rejects(e, { type: 'port/setVlan', portId: 'srv-r01-01:bmc', vlan: { mode: 'access', access: 10, allowed: [], native: 1 } }, 'NOT_A_SWITCH_PORT');
    rejects(e, { type: 'port/setVlan', portId: 'oob-r01:ge1', vlan: { mode: 'access', access: 0, allowed: [], native: 1 } }, 'INVALID_VLAN');
    rejects(e, { type: 'port/setVlan', portId: 'ib-r04-1:ib1', vlan: { mode: 'access', access: 10, allowed: [], native: 1 } }, 'NOT_A_SWITCH_PORT');
  });
});
