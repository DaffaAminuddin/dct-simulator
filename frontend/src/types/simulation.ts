/**
 * Simulation state types. `SimulationState` is plain serializable data:
 * no classes, no functions. Fields marked "derived" are written only by the
 * derivation pipeline (simulation/core/derive.ts); everything else is a base
 * input written by action handlers.
 */
import type {
  ComponentCategory,
  CoolingMode,
  EquipmentKind,
  PanelSide,
  PortRole,
  PortType,
  RackType,
  WorkloadProfile,
} from './catalog';

export type Id = string;

export type Severity = 'info' | 'warning' | 'critical';
export type Health = 'ok' | 'warning' | 'critical' | 'unknown';

/** Where a learner can observe a condition from. See SIMULATION_SPEC §1.2. */
export type Channel = 'led' | 'bmc' | 'os' | 'driver' | 'dcgm';

export interface Condition {
  code: string;
  severity: Severity;
  message: string;
  channels: Channel[];
  /** True if the condition puts a running host into `degraded`. */
  degradesHost?: boolean;
}

export type ServerState =
  | 'powered_off'
  | 'standby'
  | 'powered_on'
  | 'booting'
  | 'boot_failed'
  | 'os_running'
  | 'degraded';

/** Passive equipment (PDU, blanking panel, power shelf) has no host state. */
export type EquipmentState = ServerState | 'passive';

export type PowerStatus = 'redundant' | 'available' | 'degraded' | 'failed' | 'disconnected' | 'not_applicable';
export type PortState = 'disconnected' | 'connected' | 'link_up' | 'link_down' | 'disabled' | 'faulty';
export type CableState = 'available' | 'connected' | 'damaged' | 'incompatible';
export type CoolingStatus = 'normal' | 'warning' | 'critical' | 'failed';
export type GpuLifecycle = 'not_powered' | 'installed' | 'detected' | 'initialized';
export type FeedId = 'A' | 'B';

export interface RackLocation {
  kind: 'rack';
  rackId: Id;
  /** Lowest occupied U; null for 0U side-mounted equipment. */
  uStart: number | null;
  /** 0U equipment side. */
  side?: 'left' | 'right';
}
export interface FloorLocation {
  kind: 'floor';
  x: number;
  z: number;
}
export interface InventoryLocation {
  kind: 'inventory';
}
export type EquipmentLocation = RackLocation | FloorLocation | InventoryLocation;

export interface SelEntry {
  id: number;
  timeMs: number;
  severity: Severity;
  message: string;
}

export interface EquipmentSoftware {
  os: string;
  gpuDriverLoaded: boolean;
  dcgmInstalled: boolean;
}

export interface Equipment {
  id: Id;
  modelId: string;
  kind: EquipmentKind;
  hostname: string;
  serial: string;
  assetTag: string;
  location: EquipmentLocation;
  /** Slot id -> installed component id. */
  slots: Record<string, Id | null>;
  /** All port ids currently present on this equipment (onboard + component ports). */
  portIds: Id[];

  // --- base inputs ---
  desiredPower: 'on' | 'off';
  chassisOpen: boolean;
  uidLed: boolean;
  workload: WorkloadProfile;
  bootElapsedMs: number;
  /** Feed for hard-wired equipment (PDU, power shelf, CDU). */
  feed?: FeedId;
  software: EquipmentSoftware;
  /** Set when a thermal trip powered the host off. Cleared on next power-on. */
  thermalTrip: boolean;
  /** Racks served (CDU only). */
  servesRackIds?: Id[];

  // --- derived ---
  state: EquipmentState;
  powerStatus: PowerStatus;
  powerCapacityW: number;
  powerDemandW: number;
  powerBrake: boolean;
  bmcAlive: boolean;
  inletC: number;
  airflowFactor: number;
  postFailures: string[];
  conditions: Condition[];
  health: Health;
  sel: SelEntry[];
}

export type ComponentLocation = { kind: 'equipment'; equipmentId: Id; slotId: string } | { kind: 'inventory' };

export interface GpuTelemetry {
  index: number;
  lifecycle: GpuLifecycle;
  busId: string;
  utilizationPct: number;
  memTotalGB: number;
  memUsedGB: number;
  powerW: number;
  powerLimitW: number;
  smClockMHz: number;
  maxClockMHz: number;
  eccCorrectable: number;
  eccUncorrectable: number;
  xids: number[];
  pcieGen: number;
  pcieWidth: number;
  pcieMaxWidth: number;
  nvlinkTotal: number;
  nvlinkActive: number;
  throttleReasons: string[];
}

export interface Component {
  id: Id;
  modelId: string;
  category: ComponentCategory;
  serial: string;
  location: ComponentLocation;

  // --- derived ---
  powered: boolean;
  /** Category-specific status: ok | failed | no_input | stopped | not_powered | not_detected. */
  status: string;
  temperatureC: number;
  targetTempC: number;
  powerW: number;
  /** Fans. */
  rpm?: number;
  dutyPct?: number;
  /** PSUs: delivering output. */
  delivering?: boolean;
  inputLive?: boolean;
  gpu?: GpuTelemetry;
  conditions: Condition[];
  health: Health;
}

export interface PortTransceiver {
  modelId: string;
  serial: string;
}

export interface Port {
  id: Id;
  equipmentId: Id;
  /** Owning component and slot for component-bound ports (NIC cages, PSU inlets). */
  componentId?: Id;
  slotId?: string;
  defId: string;
  label: string;
  osName?: string;
  type: PortType;
  role: PortRole;
  speedsGbps: number[];
  side: PanelSide;

  // --- base inputs ---
  adminUp: boolean;
  transceiver?: PortTransceiver;
  cableId: Id | null;
  cableEnd: 0 | 1 | null;

  // --- derived ---
  state: PortState;
  speedGbps: number;
  peerPortId: Id | null;
  reason?: string;
  /** Power outlets: energised. */
  live?: boolean;
}

export interface CableEnd {
  portId: Id | null;
}

export interface Cable {
  id: Id;
  modelId: string;
  serial: string;
  label: string;
  ends: [CableEnd, CableEnd];
  // --- derived ---
  state: CableState;
  reason?: string;
}

export type FaultTargetKind = 'component' | 'port' | 'cable' | 'equipment' | 'feed' | 'rack';

export type FaultType =
  | 'psu_failure'
  | 'fan_failure'
  | 'dimm_uncorrectable'
  | 'nvme_failure'
  | 'cpu_failure'
  | 'gpu_fallen_off_bus'
  | 'gpu_xid'
  | 'hbm_ecc_uncorrectable'
  | 'gpu_cooling_degraded'
  | 'nvlink_down'
  | 'riser_failure'
  | 'nvswitch_failure'
  | 'nic_failure'
  | 'port_faulty'
  | 'cable_damaged'
  | 'pdu_failure'
  | 'feed_loss'
  | 'pump_failure'
  | 'coolant_leak'
  | 'bmc_failure';

export interface Fault {
  id: Id;
  type: FaultType;
  targetId: Id;
  targetKind: FaultTargetKind;
  injectedAtMs: number;
  /** Hidden faults never surface their root cause outside developer mode. */
  hidden: boolean;
  source: 'developer' | 'scenario';
  params: Record<string, number | string>;
}

export interface BusbarState {
  capacityW: number;
  demandW: number;
  status: PowerStatus;
}

export interface CoolantLoopState {
  flowPct: number;
  flowLpm: number;
  supplyC: number;
  returnC: number;
  leak: boolean;
  status: CoolingStatus;
}

export interface Rack {
  id: Id;
  name: string;
  rowId: string;
  type: RackType;
  heightU: number;
  cooling: CoolingMode;
  /** Floor position of the rack centre in metres. */
  position: { x: number; z: number };
  /** +1: front faces +z; -1: front faces -z. */
  facing: 1 | -1;
  maxPowerW: number;
  maxWeightKg: number;
  cduId?: Id;
  description: string;

  // --- derived ---
  health: Health;
  powerW: number;
  inletC: number;
  openU: number;
  busbar?: BusbarState;
  coolant?: CoolantLoopState;
}

export interface Feed {
  id: FeedId;
  name: string;
  capacityW: number;
  // --- derived ---
  up: boolean;
  loadW: number;
}

export interface Row {
  id: string;
  name: string;
  rackIds: Id[];
}

export interface Facility {
  id: string;
  name: string;
  site: string;
  /** CRAH supply air temperature (°C), base input. */
  crahSupplyC: number;
  dimensions: { width: number; depth: number };
  feeds: Record<FeedId, Feed>;
  rows: Row[];
}

export type EventCategory =
  | 'power'
  | 'thermal'
  | 'network'
  | 'hardware'
  | 'system'
  | 'gpu'
  | 'cooling'
  | 'procedure'
  | 'fault';

export interface SimEvent {
  id: number;
  timeMs: number;
  severity: Severity;
  category: EventCategory;
  message: string;
  equipmentId?: Id;
  componentId?: Id;
  rackId?: Id;
  /** Reveals ground truth (e.g. fault injection); shown only in developer mode. */
  devOnly?: boolean;
  /** Observation channels through which this event is visible. */
  channels?: Channel[];
}

export interface SimulationState {
  schemaVersion: 1;
  /** Simulated milliseconds since the scenario started. */
  timeMs: number;
  /** Wall-clock anchor for display (ISO string). */
  startedAt: string;
  seq: { event: number; fault: number; cable: number; sel: number };
  facility: Facility;
  racks: Record<Id, Rack>;
  equipment: Record<Id, Equipment>;
  components: Record<Id, Component>;
  ports: Record<Id, Port>;
  cables: Record<Id, Cable>;
  faults: Record<Id, Fault>;
  events: SimEvent[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type SimAction =
  | { type: 'equipment/power'; equipmentId: Id; power: 'on' | 'off' }
  | { type: 'equipment/powerCycle'; equipmentId: Id }
  | { type: 'equipment/mount'; equipmentId: Id; rackId: Id; uStart: number }
  | { type: 'equipment/unmount'; equipmentId: Id }
  | { type: 'equipment/setChassisOpen'; equipmentId: Id; open: boolean }
  | { type: 'equipment/setUid'; equipmentId: Id; on: boolean }
  | { type: 'equipment/setWorkload'; equipmentId: Id; workload: WorkloadProfile }
  | { type: 'component/remove'; componentId: Id }
  | { type: 'component/install'; componentId: Id; equipmentId: Id; slotId: string }
  | { type: 'cable/connect'; cableId: Id; end: 0 | 1; portId: Id }
  | { type: 'cable/disconnect'; cableId: Id; end: 0 | 1 }
  | { type: 'port/setAdmin'; portId: Id; up: boolean }
  | {
      type: 'fault/inject';
      faultType: FaultType;
      targetId: Id;
      params?: Record<string, number | string>;
      hidden?: boolean;
      source?: Fault['source'];
    }
  | { type: 'fault/clear'; faultId: Id }
  | { type: 'facility/setCrahSupply'; tempC: number };

export type ActionResult =
  | { ok: true; warnings: string[] }
  | { ok: false; code: string; message: string };
