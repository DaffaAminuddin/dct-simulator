/**
 * Instance factories: build equipment, components, ports and cables from the
 * catalogs. Used by the seed scenario and by tests to compose small states.
 */
import { getCableModel, getTransceiverModel } from '@/data/cables/cableCatalog';
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { HOST_KINDS } from '@/simulation/core/SimulationState';
import { hash32, serialFor } from '@/simulation/core/util';
import { createComponentPorts } from '@/simulation/hardware/Compatibility';
import { CAGE_ACCEPTS, checkFit, requiredLengthM } from '@/simulation/networking/Cable';
import { defaultWorkstation } from '@/simulation/workstation/Workstation';
import type { PortDef, WorkloadProfile } from '@/types/catalog';
import type {
  Cable,
  Component,
  ComponentLocation,
  Equipment,
  EquipmentLocation,
  FeedId,
  Id,
  Port,
  Rack,
  SimulationState,
} from '@/types/simulation';

export function emptyState(): SimulationState {
  return {
    schemaVersion: 2,
    timeMs: 0,
    startedAt: '2026-11-08T08:00:00Z',
    seq: { event: 0, fault: 0, cable: 0, sel: 0 },
    facility: {
      id: 'DH01',
      name: 'Data Hall 01',
      site: 'AI Training Campus · Building A (simulated)',
      crahSupplyC: 22,
      dimensions: { width: 14, depth: 11 },
      feeds: {
        A: { id: 'A', name: 'Feed A (UPS-A)', capacityW: 600000, up: true, loadW: 0 },
        B: { id: 'B', name: 'Feed B (UPS-B)', capacityW: 600000, up: true, loadW: 0 },
      },
      rows: [],
      networks: [],
      firewall: [],
    },
    racks: {},
    equipment: {},
    components: {},
    ports: {},
    cables: {},
    faults: {},
    events: [],
    workstation: defaultWorkstation(),
  };
}

export function addRack(
  s: SimulationState,
  r: Pick<Rack, 'id' | 'name' | 'rowId' | 'type' | 'heightU' | 'cooling' | 'position' | 'facing' | 'maxPowerW' | 'maxWeightKg' | 'description'> & { cduId?: Id },
): Rack {
  const rack: Rack = { ...r, health: 'unknown', powerW: 0, inletC: s.facility.crahSupplyC, openU: r.heightU };
  s.racks[r.id] = rack;
  let row = s.facility.rows.find((x) => x.id === r.rowId);
  if (!row) {
    row = { id: r.rowId, name: `Row ${r.rowId}`, rackIds: [] };
    s.facility.rows.push(row);
  }
  row.rackIds.push(r.id);
  return rack;
}

export function newComponent(s: SimulationState, id: Id, modelId: string, location: ComponentLocation): Component {
  const m = getComponentModel(modelId);
  const c: Component = {
    id,
    modelId,
    category: m.category,
    serial: serialFor(id, m.category.slice(0, 3)),
    location,
    powered: false,
    status: 'not_powered',
    temperatureC: 22,
    targetTempC: 22,
    powerW: 0,
    conditions: [],
    health: 'unknown',
  };
  if (m.category === 'fan') {
    c.rpm = 0;
    c.dutyPct = 0;
  }
  if (m.category === 'psu') {
    c.delivering = false;
    c.inputLive = false;
  }
  s.components[id] = c;
  return c;
}

export interface EquipmentOptions {
  id: Id;
  modelId: string;
  hostname: string;
  location: EquipmentLocation;
  feed?: FeedId;
  workload?: WorkloadProfile;
  /** Host powered on at scenario start (default true for mounted hosts). */
  on?: boolean;
  servesRackIds?: Id[];
  /** Omit default components (bare chassis). */
  empty?: boolean;
}

function osFor(kind: string, cpu?: string): string {
  if (kind === 'switch') return 'Network OS (reference)';
  if (kind === 'nvlink_switch_tray') return 'NVLink switch firmware (reference)';
  if (cpu === 'cpu-grace') return 'Ubuntu 24.04 LTS (aarch64)';
  return 'Ubuntu 24.04 LTS (x86_64)';
}

export function newEquipment(s: SimulationState, o: EquipmentOptions): Equipment {
  const model = getEquipmentModel(o.modelId);
  const host = HOST_KINDS.has(model.kind);
  const on = host && o.location.kind !== 'inventory' && (o.on ?? true);
  const hasGpu = model.slots.some((sl) => sl.category === 'gpu');
  const eq: Equipment = {
    id: o.id,
    modelId: o.modelId,
    kind: model.kind,
    hostname: o.hostname,
    serial: serialFor(o.id, model.shortName),
    assetTag: `DCT-${hash32(`${o.id}@asset`).toString(16).slice(0, 6).toUpperCase().padStart(6, '0')}`,
    location: o.location,
    slots: {},
    portIds: [],
    desiredPower: on ? 'on' : 'off',
    chassisOpen: false,
    uidLed: false,
    workload: o.workload ?? (model.kind === 'switch' || model.kind === 'nvlink_switch_tray' ? 'light' : 'idle'),
    bootElapsedMs: on ? model.bootTimeMs : 0,
    feed: o.feed,
    software: { os: osFor(model.kind, model.defaults.cpu0), gpuDriverLoaded: hasGpu, dcgmInstalled: hasGpu },
    thermalTrip: false,
    servesRackIds: o.servesRackIds,
    state: host ? 'powered_off' : 'passive',
    powerStatus: 'disconnected',
    powerCapacityW: 0,
    powerDemandW: 0,
    powerBrake: false,
    bmcAlive: false,
    inletC: 22,
    airflowFactor: 1,
    postFailures: [],
    conditions: [],
    health: 'unknown',
    sel: [],
  };
  s.equipment[o.id] = eq;
  for (const slot of model.slots) {
    eq.slots[slot.id] = null;
    const dm = o.empty ? undefined : model.defaults[slot.id];
    if (!dm) continue;
    const comp = newComponent(s, `${o.id}/${slot.id}`, dm, { kind: 'equipment', equipmentId: o.id, slotId: slot.id });
    eq.slots[slot.id] = comp.id;
    createComponentPorts(s, eq, slot.id, comp.id);
  }
  for (const pd of model.ports) createOnboardPort(s, eq, pd);
  return eq;
}

function createOnboardPort(s: SimulationState, eq: Equipment, pd: PortDef): Port {
  const id = `${eq.id}:${pd.id}`;
  const port: Port = {
    id,
    equipmentId: eq.id,
    defId: pd.id,
    label: pd.label,
    osName: pd.osName,
    type: pd.type,
    role: pd.role,
    speedsGbps: pd.speedsGbps,
    side: pd.side,
    adminUp: true,
    cableId: null,
    cableEnd: null,
    state: 'disconnected',
    speedGbps: 0,
    peerPortId: null,
  };
  s.ports[id] = port;
  eq.portIds.push(id);
  return port;
}

export function newCable(s: SimulationState, modelId: string, label?: string): Cable {
  getCableModel(modelId);
  s.seq.cable += 1;
  const id = `cbl-${String(s.seq.cable).padStart(4, '0')}`;
  const cable: Cable = {
    id,
    modelId,
    serial: serialFor(id, 'CBL'),
    label: label ?? id.toUpperCase(),
    ends: [{ portId: null }, { portId: null }],
    state: 'available',
  };
  s.cables[id] = cable;
  return cable;
}

export function installTransceiver(s: SimulationState, portId: Id, modelId: string): void {
  const port = s.ports[portId];
  if (!port) throw new Error(`seed: unknown port ${portId}`);
  const x = getTransceiverModel(modelId);
  if (!CAGE_ACCEPTS[port.type].includes(x.formFactor)) throw new Error(`seed: ${x.name} does not fit ${port.type} (${portId})`);
  port.transceiver = { modelId, serial: serialFor(`${portId}#xcvr`, 'XCV') };
}

/** Seed-time cabling with the same mechanical/length validation as the connect action. */
export function connect(s: SimulationState, modelId: string, portA: Id, portB: Id, opts: { xcvrA?: string; xcvrB?: string; label?: string } = {}): Cable {
  const a = s.ports[portA];
  const b = s.ports[portB];
  if (!a) throw new Error(`seed: unknown port ${portA}`);
  if (!b) throw new Error(`seed: unknown port ${portB}`);
  if (a.cableId || b.cableId) throw new Error(`seed: port already cabled (${portA} / ${portB})`);
  if (opts.xcvrA) installTransceiver(s, portA, opts.xcvrA);
  if (opts.xcvrB) installTransceiver(s, portB, opts.xcvrB);
  const model = getCableModel(modelId);
  const fa = checkFit(a, model.ends[0]);
  const fb = checkFit(b, model.ends[1]);
  if (!fa.ok || !fb.ok) throw new Error(`seed: ${modelId} does not fit ${portA}/${portB}: ${fa.reason ?? fb.reason}`);
  const need = requiredLengthM(s, a, b);
  if (need > model.lengthM) throw new Error(`seed: ${modelId} too short for ${portA} → ${portB} (${need.toFixed(1)} m)`);
  const cable = newCable(s, modelId, opts.label);
  cable.ends[0].portId = portA;
  cable.ends[1].portId = portB;
  a.cableId = cable.id;
  a.cableEnd = 0;
  b.cableId = cable.id;
  b.cableEnd = 1;
  return cable;
}
