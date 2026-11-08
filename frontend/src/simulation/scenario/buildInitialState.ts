/**
 * Data Hall 01 seed scenario.
 *
 * Row A (air-cooled, fronts face the cold aisle at +z):
 *   R01 compute (8 × 1U) · R02 storage (4 × 2U + 4 × 1U) · R03 GPU (3 × 4U 8-GPU) · R04 network core
 * Row B (fronts face the same cold aisle at −z):
 *   R05 GB200 NVL72-style · R06 GB300 NVL72-style (liquid, 48U MGX) · CDU-01 · R07 empty expansion rack
 *
 * The hall starts healthy except for one real physical issue: a PSU cord on
 * dh1-r02-n04 was never reconnected after maintenance (work order DCT-0002).
 */
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import type { WorkloadProfile } from '@/types/catalog';
import type { Equipment, FeedId, Id, SimulationState } from '@/types/simulation';
import { addRack, connect, emptyState, newCable, newComponent, newEquipment } from './factory';
import { freeUnits } from '@/simulation/hardware/Rack';

const counters: Record<string, number> = {};
function take(key: string, start: number, max: number): number {
  const n = counters[key] ?? start;
  if (n > max) throw new Error(`seed: allocator ${key} exhausted`);
  counters[key] = n + 1;
  return n;
}

function mount(s: SimulationState, id: Id, modelId: string, hostname: string, rackId: Id, u: number, workload?: WorkloadProfile): Equipment {
  return newEquipment(s, { id, modelId, hostname, location: { kind: 'rack', rackId, uStart: u }, workload });
}

function addPdus(s: SimulationState, rackId: Id): void {
  for (const side of ['a', 'b'] as const) {
    const feed: FeedId = side === 'a' ? 'A' : 'B';
    newEquipment(s, {
      id: `pdu-${rackId.toLowerCase()}-${side}`,
      modelId: 'pdu-0u-ref',
      hostname: `dh1-${rackId.toLowerCase()}-pdu-${side}`,
      location: { kind: 'rack', rackId, uStart: null, side: side === 'a' ? 'left' : 'right' },
      feed,
    });
  }
}

function fillBlanks(s: SimulationState, rackId: Id, keepOpen: number[] = []): void {
  const free = freeUnits(s, rackId).filter((u) => !keepOpen.includes(u));
  const set = new Set(free);
  for (const u of free) {
    if (!set.has(u)) continue;
    if (set.has(u + 1)) {
      mount(s, `blank-${rackId.toLowerCase()}-u${u}`, 'blank-2u', `${rackId} blank U${u}-U${u + 1}`, rackId, u);
      set.delete(u);
      set.delete(u + 1);
    } else {
      mount(s, `blank-${rackId.toLowerCase()}-u${u}`, 'blank-1u', `${rackId} blank U${u}`, rackId, u);
      set.delete(u);
    }
  }
}

/** Power cords: odd PSUs to PDU-A, even PSUs to PDU-B. */
function cablePower(s: SimulationState, eq: Equipment, rackId: Id, skip: string[] = []): void {
  const model = getEquipmentModel(eq.modelId);
  let i = 0;
  for (const slot of model.slots) {
    if (slot.category !== 'psu' || !eq.slots[slot.id]) continue;
    const inlet = s.ports[`${eq.id}:${slot.id}.ac`];
    const side = i % 2 === 0 ? 'a' : 'b';
    i++;
    if (!inlet || skip.includes(slot.id)) continue;
    const pdu = `pdu-${rackId.toLowerCase()}-${side}`;
    if (inlet.type === 'psu_c20') {
      connect(s, 'pwr-c19c20-2m', inlet.id, `${pdu}:o${take(`${pdu}:c19`, 25, 30)}`);
    } else {
      connect(s, 'pwr-c13c14-2m', inlet.id, `${pdu}:o${take(`${pdu}:c13`, 1, 24)}`);
    }
  }
}

function cableBmc(s: SimulationState, eq: Equipment, mgmtSwitch: Id, portId = 'bmc'): void {
  connect(s, 'mgmt-rj45-3m', `${eq.id}:${portId}`, `${mgmtSwitch}:ge${take(`${mgmtSwitch}:ge`, 1, 48)}`);
}

const IB_SWITCHES = ['ib-r04-1', 'ib-r04-2', 'ib-r04-3'];
function nextIbPort(): Id {
  for (const sw of IB_SWITCHES) {
    const n = counters[`${sw}:ib`] ?? 1;
    if (n <= 64) {
      counters[`${sw}:ib`] = n + 1;
      return `${sw}:ib${n}`;
    }
  }
  throw new Error('seed: IB fabric ports exhausted');
}

function standardRack(s: SimulationState, rackId: Id): { tor: Id; mgmt: Id } {
  const r = rackId.toLowerCase();
  const tor = mount(s, `tor-${r}`, 'sw-tor-25g-ref', `dh1-${r}-tor1`, rackId, 42);
  const mgmt = mount(s, `oob-${r}`, 'sw-mgmt-1g-ref', `dh1-${r}-oob1`, rackId, 41);
  addPdus(s, rackId);
  cablePower(s, tor, rackId);
  cablePower(s, mgmt, rackId);
  cableBmc(s, tor, mgmt.id, 'mgmt0');
  return { tor: tor.id, mgmt: mgmt.id };
}

function cableServerData(s: SimulationState, srv: Equipment, tor: Id): void {
  const n = take(`${tor}:swp`, 1, 24);
  connect(s, 'dac-sfp28-3m', `${srv.id}:ocp0.p0`, `${tor}:swp${n}`);
  connect(s, 'dac-sfp28-3m', `${srv.id}:ocp0.p1`, `${tor}:swp${n + 24}`);
}

function uplinkTor(s: SimulationState, tor: Id, firstUplink: number): void {
  connect(s, 'aoc-qsfp28-30m', `${tor}:swp${firstUplink}`, `spine-r04-1:swp${take('spine-r04-1:swp', 1, 32)}`);
  connect(s, 'aoc-qsfp28-30m', `${tor}:swp${firstUplink + 1}`, `spine-r04-2:swp${take('spine-r04-2:swp', 1, 32)}`);
}

function uplinkOob(s: SimulationState, mgmt: Id): void {
  connect(s, 'lc-om4-20m', `${mgmt}:xe1`, `agg-r04:swp${take('agg-r04:swp', 1, 48)}`, { xcvrA: 'xcvr-sfpp-sr', xcvrB: 'xcvr-sfpp-sr' });
}

function nvlRack(s: SimulationState, rackId: Id, trayModel: string, label: 'gb200' | 'gb300'): void {
  const r = rackId.toLowerCase();
  addPdus(s, rackId);
  const shelfUs = [1, 2, 3, 4, 32, 33, 34, 35];
  shelfUs.forEach((u, i) => {
    newEquipment(s, {
      id: `pshelf-${r}-${i + 1}`,
      modelId: 'pshelf-ref',
      hostname: `dh1-${r}-pshelf${i + 1}`,
      location: { kind: 'rack', rackId, uStart: u },
      feed: i % 2 === 0 ? 'A' : 'B',
    });
  });
  const mgmt = mount(s, `oob-${r}`, 'sw-mgmt-1g-ref', `dh1-${r}-oob1`, rackId, 37);
  cablePower(s, mgmt, rackId);

  const trayUs = [...Array.from({ length: 8 }, (_, i) => 5 + i), ...Array.from({ length: 10 }, (_, i) => 22 + i)];
  trayUs.forEach((u, i) => {
    const n = String(i + 1).padStart(2, '0');
    const tray = mount(s, `ct-${r}-${n}`, trayModel, `dh1-${r}-${label}-ct${n}`, rackId, u, 'training');
    cableBmc(s, tray, mgmt.id);
    for (let k = 0; k < 4; k++) {
      const x = label === 'gb300' ? 'xcvr-osfp-800-sr8' : 'xcvr-osfp-400-sr4';
      connect(s, 'mpo-om4-30m', `${tray.id}:nic${k}.p0`, nextIbPort(), { xcvrA: x, xcvrB: 'xcvr-osfp-400-sr4' });
    }
    const spine = i % 2 === 0 ? 'spine-r04-1' : 'spine-r04-2';
    connect(s, 'aoc-qsfp28-30m', `${tray.id}:dpu0.p0`, `${spine}:swp${take(`${spine}:swp`, 1, 32)}`);
  });
  for (let i = 0; i < 9; i++) {
    const sw = mount(s, `nvs-${r}-${i + 1}`, 'nvs-tray-ref', `dh1-${r}-nvsw${i + 1}`, rackId, 13 + i);
    cableBmc(s, sw, mgmt.id);
  }
  uplinkOob(s, mgmt.id);
  fillBlanks(s, rackId);
}

export function buildInitialState(): SimulationState {
  for (const k of Object.keys(counters)) delete counters[k];
  const s = emptyState();

  // --- racks -------------------------------------------------------------------
  const std = { type: 'standard' as const, heightU: 42, cooling: 'air' as const, maxWeightKg: 1100 };
  addRack(s, { ...std, id: 'R01', name: 'R01 · Compute', rowId: 'A', position: { x: -1.1, z: -1.5 }, facing: 1, maxPowerW: 15000, description: 'General-purpose 1U compute nodes.' });
  addRack(s, { ...std, id: 'R02', name: 'R02 · Storage', rowId: 'A', position: { x: -0.5, z: -1.5 }, facing: 1, maxPowerW: 15000, description: '2U storage servers and 1U service nodes.' });
  addRack(s, { ...std, id: 'R03', name: 'R03 · GPU (air-cooled)', rowId: 'A', position: { x: 0.1, z: -1.5 }, facing: 1, maxPowerW: 30000, description: 'Air-cooled 8-GPU training servers.' });
  addRack(s, { ...std, id: 'R04', name: 'R04 · Network core', rowId: 'A', position: { x: 0.7, z: -1.5 }, facing: 1, maxPowerW: 15000, description: 'Spine / front-end Ethernet, InfiniBand compute fabric, OOB aggregation.' });
  const mgx = { type: 'mgx' as const, heightU: 48, cooling: 'liquid' as const, maxWeightKg: 1600, maxPowerW: 140000, cduId: 'cdu-01' };
  addRack(s, { ...mgx, id: 'R05', name: 'R05 · GB200 NVL72 (reference)', rowId: 'B', position: { x: -1.1, z: 1.5 }, facing: -1, description: 'Liquid-cooled rack-scale system: 18 GB200 compute trays, 9 NVLink switch trays, 8 power shelves.' });
  addRack(s, { ...mgx, id: 'R06', name: 'R06 · GB300 NVL72 (reference)', rowId: 'B', position: { x: -0.5, z: 1.5 }, facing: -1, description: 'Liquid-cooled rack-scale system: 18 GB300 compute trays, 9 NVLink switch trays, 8 power shelves.' });
  addRack(s, { ...std, id: 'R07', name: 'R07 · Expansion', rowId: 'B', position: { x: 0.9, z: 1.5 }, facing: -1, maxPowerW: 15000, description: 'Empty rack with PDUs, reserved for new server deployments.' });

  // --- R04 network core (cabled to by everything else) -------------------------
  addPdus(s, 'R04');
  const agg = mount(s, 'agg-r04', 'sw-tor-25g-ref', 'dh1-r04-oobagg1', 'R04', 42);
  const oob4 = mount(s, 'oob-r04', 'sw-mgmt-1g-ref', 'dh1-r04-oob1', 'R04', 41);
  const spine1 = mount(s, 'spine-r04-1', 'sw-spine-400g-ref', 'dh1-r04-spine1', 'R04', 39);
  const spine2 = mount(s, 'spine-r04-2', 'sw-spine-400g-ref', 'dh1-r04-spine2', 'R04', 38);
  const ibs = IB_SWITCHES.map((id, i) => mount(s, id, 'sw-ib-ndr-ref', `dh1-r04-ib${i + 1}`, 'R04', 30 - i * 3));
  for (const sw of [agg, oob4, spine1, spine2, ...ibs]) cablePower(s, sw, 'R04');
  for (const sw of [agg, spine1, spine2, ...ibs]) cableBmc(s, sw, oob4.id, 'mgmt0');
  connect(s, 'dac-sfpp-1m', 'oob-r04:xe1', `agg-r04:swp${take('agg-r04:swp', 1, 48)}`);

  // --- R01 compute ------------------------------------------------------------
  {
    const { tor, mgmt } = standardRack(s, 'R01');
    for (let i = 0; i < 8; i++) {
      const n = String(i + 1).padStart(2, '0');
      const srv = mount(s, `srv-r01-${n}`, 'srv-1u-ref', `dh1-r01-n${n}`, 'R01', 10 + i, 'light');
      cablePower(s, srv, 'R01');
      cableBmc(s, srv, mgmt);
      cableServerData(s, srv, tor);
    }
    uplinkTor(s, tor, 49);
    uplinkOob(s, mgmt);
    // Two open U left without blanking panels (placement exercise).
    fillBlanks(s, 'R01', [18, 19]);
  }

  // --- R02 storage --------------------------------------------------------------
  {
    const { tor, mgmt } = standardRack(s, 'R02');
    for (let i = 0; i < 4; i++) {
      const n = String(i + 1).padStart(2, '0');
      const srv = mount(s, `srv-r02-s${n}`, 'srv-2u-storage-ref', `dh1-r02-s${n}`, 'R02', 10 + i * 2, 'light');
      cablePower(s, srv, 'R02');
      cableBmc(s, srv, mgmt);
      cableServerData(s, srv, tor);
    }
    for (let i = 0; i < 4; i++) {
      const n = String(i + 1).padStart(2, '0');
      const srv = mount(s, `srv-r02-n${n}`, 'srv-1u-ref', `dh1-r02-n${n}`, 'R02', 20 + i, 'idle');
      // DCT-0002: PSU 2 cord left unplugged after maintenance on n04.
      cablePower(s, srv, 'R02', i === 3 ? ['psu2'] : []);
      cableBmc(s, srv, mgmt);
      cableServerData(s, srv, tor);
    }
    uplinkTor(s, tor, 49);
    uplinkOob(s, mgmt);
    fillBlanks(s, 'R02');
  }

  // --- R03 GPU (air) --------------------------------------------------------------
  {
    const { tor, mgmt } = standardRack(s, 'R03');
    [6, 12, 18].forEach((u, i) => {
      const n = String(i + 1).padStart(2, '0');
      const srv = mount(s, `srv-r03-g${n}`, 'srv-4u-gpu-ref', `dh1-r03-g${n}`, 'R03', u, 'training');
      cablePower(s, srv, 'R03');
      cableBmc(s, srv, mgmt);
      const q = take(`${tor}:qsfp`, 49, 54);
      connect(s, 'dac-qsfp28-3m', `${srv.id}:ocp0.p0`, `${tor}:swp${q}`);
      connect(s, 'dac-qsfp28-3m', `${srv.id}:ocp0.p1`, `${tor}:swp${take(`${tor}:qsfp`, 49, 54)}`);
      for (let k = 0; k < 4; k++) {
        connect(s, 'mpo-om4-30m', `${srv.id}:nic${k}.p0`, nextIbPort(), { xcvrA: 'xcvr-osfp-400-sr4', xcvrB: 'xcvr-osfp-400-sr4' });
      }
    });
    uplinkTor(s, tor, 55);
    uplinkOob(s, mgmt);
    fillBlanks(s, 'R03');
  }

  // --- Row B: NVL72-style racks + CDU ---------------------------------------------
  nvlRack(s, 'R05', 'ct-gb200-ref', 'gb200');
  nvlRack(s, 'R06', 'ct-gb300-ref', 'gb300');
  newEquipment(s, { id: 'cdu-01', modelId: 'cdu-inrow-ref', hostname: 'dh1-cdu01', location: { kind: 'floor', x: 0.2, z: 1.5 }, feed: 'A', servesRackIds: ['R05', 'R06'] });
  fillBlanks(s, 'R04');

  // --- R07 empty expansion rack -------------------------------------------------
  addPdus(s, 'R07');

  // --- Spares cage ---------------------------------------------------------------
  const spares: [string, string, number][] = [
    ['psu-crps-1200', 'psu1200', 2],
    ['psu-crps-2000', 'psu2000', 1],
    ['psu-3000-c20', 'psu3000', 1],
    ['psu-shelf-5500', 'shelfpsu', 1],
    ['fan-40-ref', 'fan40', 2],
    ['fan-60-ref', 'fan60', 1],
    ['fan-80-ref', 'fan80', 1],
    ['dimm-ddr5-64g', 'ddr5-64g', 2],
    ['dimm-ddr5-32g', 'ddr5-32g', 1],
    ['dimm-ddr4-32g', 'ddr4-32g', 1],
    ['nvme-u2-3t84', 'u2', 2],
    ['nvme-e1s-3t84', 'e1s', 1],
    ['nvme-m2-960g', 'm2', 1],
    ['ssd-sas-3t84', 'sas', 1],
    ['gpu-sxm-ref-80g', 'gpu-sxm', 1],
    ['riser-x16-ref', 'riser', 1],
    ['nic-cx7-400g', 'cx7', 1],
    ['nic-ocp-25g-2p', 'ocp25', 1],
    ['bmc-dcscm-ref', 'dcscm', 1],
    ['pump-cdu-ref', 'pump', 1],
  ];
  for (const [modelId, tag, count] of spares) {
    for (let i = 1; i <= count; i++) newComponent(s, `spare-${tag}-${String(i).padStart(2, '0')}`, modelId, { kind: 'inventory' });
  }
  newEquipment(s, { id: 'spare-srv-1u-01', modelId: 'srv-1u-ref', hostname: 'dh1-new-n01', location: { kind: 'inventory' } });
  newEquipment(s, { id: 'spare-ct-gb200-01', modelId: 'ct-gb200-ref', hostname: 'dh1-spare-gb200-ct', location: { kind: 'inventory' }, workload: 'training' });
  for (let i = 1; i <= 4; i++) newEquipment(s, { id: `spare-blank-1u-${i}`, modelId: 'blank-1u', hostname: `Spare blank ${i}`, location: { kind: 'inventory' } });

  const spareCables: [string, number][] = [
    ['cat6-2m', 4],
    ['cat6a-3m', 2],
    ['mgmt-rj45-1m', 2],
    ['mgmt-rj45-3m', 4],
    ['dac-sfpp-1m', 2],
    ['dac-sfp28-1m', 2],
    ['dac-sfp28-3m', 4],
    ['dac-qsfp28-3m', 2],
    ['dac-qsfpdd-2m', 2],
    ['aoc-qsfp28-30m', 2],
    ['mpo-om4-30m', 2],
    ['mpo-os2-30m', 1],
    ['lc-om4-20m', 2],
    ['lc-os2-20m', 1],
    ['pwr-c13c14-2m', 4],
    ['pwr-c19c20-2m', 2],
    ['pwr-laptop-adapter', 1],
    ['usb-a-c-1m', 1],
    ['console-rj45-usb', 1],
  ];
  for (const [modelId, count] of spareCables) for (let i = 0; i < count; i++) newCable(s, modelId);

  return s;
}
