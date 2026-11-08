import { describe, expect, it } from 'vitest';
import { FAULT_DEFINITIONS, FAULT_TYPES } from '@/data/faults/faultCatalog';
import { channelStatus, displayedHealth, frontLeds, visibleEvents } from '@/simulation/diagnostics/DiagnosticEngine';
import { eligibleTargets } from '@/simulation/diagnostics/FaultInjector';
import { makeEngine, ok, rejects, unplug } from '@/test/engine';

describe('fault injection', () => {
  it('every fault type has a complete definition and at least one eligible target', () => {
    const s = makeEngine().getState();
    for (const t of FAULT_TYPES) {
      const d = FAULT_DEFINITIONS[t];
      expect(d.symptoms.length, t).toBeGreaterThan(0);
      expect(d.recovery.length, t).toBeGreaterThan(0);
      expect(d.validation.length, t).toBeGreaterThan(0);
      expect(d.rootCause, t).not.toBe('');
      expect(eligibleTargets(s, t).length, t).toBeGreaterThan(0);
    }
  });

  it('rejects a fault on the wrong kind of target', () => {
    const e = makeEngine();
    expect(rejects(e, { type: 'fault/inject', faultType: 'psu_failure', targetId: 'srv-r01-01/fan0' }, 'BAD_TARGET')).toMatch(/applies to psu/);
    rejects(e, { type: 'fault/inject', faultType: 'coolant_leak', targetId: 'R01' }, 'BAD_TARGET');
  });

  it('rejects duplicate faults and clears faults', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'psu_failure', targetId: 'srv-r01-01/psu1' });
    rejects(e, { type: 'fault/inject', faultType: 'psu_failure', targetId: 'srv-r01-01/psu1' }, 'FAULT_EXISTS');
    const id = Object.keys(e.getState().faults)[0];
    ok(e, { type: 'fault/clear', faultId: id });
    expect(e.getState().faults).toEqual({});
    expect(e.getState().equipment['srv-r01-01'].powerStatus).toBe('redundant');
  });

  it('fault injection events are developer-only so root causes stay hidden', () => {
    const e = makeEngine();
    ok(e, { type: 'fault/inject', faultType: 'gpu_fallen_off_bus', targetId: 'ct-r05-01/gpu0' });
    const events = e.getState().events;
    expect(events.some((ev) => ev.devOnly && /Fault injected/.test(ev.message))).toBe(true);
    expect(visibleEvents(events, false).some((ev) => /Fault injected|fallen off/.test(ev.message))).toBe(false);
    expect(visibleEvents(events, true).some((ev) => /Fault injected/.test(ev.message))).toBe(true);
  });
});

describe('health monitor and observation channels', () => {
  it('PSU input loss is logged to the activity feed and the BMC SEL', () => {
    const e = makeEngine();
    unplug(e, 'srv-r01-04:psu1.ac');
    const s = e.getState();
    expect(s.events.some((ev) => ev.message === 'dh1-r01-n04: PSU 1: AC input lost')).toBe(true);
    expect(s.equipment['srv-r01-04'].sel.some((x) => x.message === 'PSU 1: AC input lost')).toBe(true);
  });

  it('without standby power the BMC view is unknown but LEDs and SEL stop updating', () => {
    const e = makeEngine();
    unplug(e, 'srv-r01-05:psu1.ac');
    unplug(e, 'srv-r01-05:psu2.ac');
    const s = e.getState();
    const eq = s.equipment['srv-r01-05'];
    expect(channelStatus(s, eq, 'bmc').available).toBe(false);
    expect(channelStatus(s, eq, 'led').available).toBe(false);
    expect(displayedHealth(s, eq, false)).toBe('unknown');
    expect(displayedHealth(s, eq, true)).toBe('critical');
    expect(frontLeds(s, eq).power).toBe('off');
  });

  it('a running healthy host shows a solid green power LED; standby blinks amber', () => {
    const e = makeEngine();
    expect(frontLeds(e.getState(), e.getState().equipment['srv-r01-06']).power).toBe('green');
    ok(e, { type: 'equipment/power', equipmentId: 'srv-r01-06', power: 'off' });
    expect(frontLeds(e.getState(), e.getState().equipment['srv-r01-06']).power).toBe('blink-amber');
  });

  it('the UID locator LED can be toggled', () => {
    const e = makeEngine();
    ok(e, { type: 'equipment/setUid', equipmentId: 'srv-r01-07', on: true });
    expect(frontLeds(e.getState(), e.getState().equipment['srv-r01-07']).uid).toBe('blue');
  });

  it('mass link changes are summarised into one event', () => {
    const e = makeEngine();
    ok(e, { type: 'equipment/power', equipmentId: 'tor-r01', power: 'off' });
    expect(e.getState().events.some((ev) => /network links changed state/.test(ev.message))).toBe(true);
  });
});
