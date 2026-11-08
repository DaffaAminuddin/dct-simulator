/**
 * Catalog types: immutable definitions of hardware models, cables and transceivers.
 * Instances in the simulation state reference these by `modelId`.
 */

/**
 * Content accuracy classification (see docs/ASSUMPTIONS.md).
 * - verified:     widely published vendor/standard specification (source cited)
 * - industry:     general industry practice or standard behaviour
 * - simplified:   simulation behaviour that approximates reality for teaching
 * - hypothetical: invented training scenario content
 * - reference:    generic educational reference design, not an OEM layout
 */
export type Accuracy = 'verified' | 'industry' | 'simplified' | 'hypothetical' | 'reference';

export interface AccuracyNote {
  accuracy: Accuracy;
  note?: string;
  source?: string;
}

export type ComponentCategory =
  | 'cpu'
  | 'dimm'
  | 'gpu'
  | 'nvme'
  | 'ssd'
  | 'raid'
  | 'nic'
  | 'dpu'
  | 'riser'
  | 'psu'
  | 'fan'
  | 'motherboard'
  | 'bmc'
  | 'nvswitch'
  | 'asic'
  | 'pump';

export type CoolingMode = 'air' | 'liquid';

/** Physical receptacle on a device. */
export type PortType =
  | 'rj45'
  | 'serial_rj45'
  | 'sfp'
  | 'sfp_plus'
  | 'sfp28'
  | 'qsfp28'
  | 'qsfp112'
  | 'qsfp_dd'
  | 'osfp'
  | 'usb_a'
  | 'usb_c'
  | 'hdmi'
  | 'psu_c14'
  | 'psu_c20'
  | 'pdu_c13'
  | 'pdu_c19'
  | 'dc_in';

/** Plug on the end of a cable. */
export type ConnectorType =
  | 'rj45'
  | 'sfp_plus'
  | 'sfp28'
  | 'qsfp28'
  | 'qsfp112'
  | 'qsfp_dd'
  | 'osfp'
  | 'lc_duplex'
  | 'mpo12'
  | 'c13'
  | 'c14'
  | 'c19'
  | 'c20'
  | 'usb_a'
  | 'usb_c'
  | 'hdmi'
  | 'dc_laptop';

export type PortRole = 'bmc' | 'mgmt' | 'data' | 'fabric' | 'uplink' | 'console' | 'usb' | 'power_in' | 'power_out' | 'video';

export type PanelSide = 'front' | 'rear';

export interface PortDef {
  /** Local id, unique within its owner (equipment or component model). */
  id: string;
  label: string;
  /** OS-level interface name where applicable (e.g. `eno1`, `ibp3s0`). */
  osName?: string;
  type: PortType;
  role: PortRole;
  /** Supported link speeds in Gb/s, fastest first. Empty for non-data ports. */
  speedsGbps: number[];
  side: PanelSide;
  /** Horizontal position on the panel in percent (vertical position for 0U PDUs). */
  panelX?: number;
  /** Row on the panel (0 = top row) for dense switch faceplates. */
  panelRow?: number;
}

export interface ThermalLimits {
  /** Temperature at which a warning condition is raised (simulation value). */
  warnC: number;
  /** Temperature at which the part throttles (GPU/CPU) (simulation value). */
  throttleC?: number;
  /** Temperature at which the host trips to protect hardware (simulation value). */
  criticalC: number;
}

export interface ComponentModel extends AccuracyNote {
  id: string;
  category: ComponentCategory;
  name: string;
  manufacturer: string;
  /** Mechanical/electrical form factor used for slot compatibility. */
  formFactor: string;
  idleW: number;
  maxW: number;
  /** Thermal resistance to coolant/air in °C per W (simplified lumped model). */
  thermalResistance: number;
  thermal: ThermalLimits;
  cooling: CoolingMode;
  hotSwap: boolean;
  fieldReplaceable: boolean;
  /** Ports physically on this component (NIC cages, PSU inlet). */
  ports?: PortDef[];
  specs: Record<string, string | number>;
  /** PSU: output rating. */
  ratingW?: number;
  /** Fan: max RPM. */
  maxRpm?: number;
  weightKg?: number;
}

export type SlotAccess = 'front' | 'rear' | 'internal';

export interface SlotDef {
  id: string;
  label: string;
  category: ComponentCategory;
  /** Accepted `ComponentModel.formFactor` values. */
  accepts: string[];
  access: SlotAccess;
  /** Slot that must be populated and healthy for this slot to work (e.g. PCIe riser). */
  dependsOn?: string;
  /** Top-down chassis layout, percent of chassis width (x) and depth (y, 0 = front). */
  layout: { x: number; y: number; w: number; h: number };
  /** Where the slot shows on a front/rear panel (percent of width). */
  panel?: { side: PanelSide; x: number; w: number };
  /** Role tag used by rules, e.g. boot drive. */
  tags?: string[];
}

export type EquipmentKind =
  | 'server'
  | 'compute_tray'
  | 'nvlink_switch_tray'
  | 'power_shelf'
  | 'switch'
  | 'pdu'
  | 'blank'
  | 'cdu';

export type RackType = 'standard' | 'mgx';

export type WorkloadProfile = 'idle' | 'light' | 'training';

export interface EquipmentModel extends AccuracyNote {
  id: string;
  kind: EquipmentKind;
  name: string;
  shortName: string;
  manufacturer: string;
  /** Height in rack units; 0 for 0U side-mounted PDUs and floor equipment. */
  heightU: number;
  weightKg: number;
  rackTypes: RackType[];
  cooling: CoolingMode;
  /** Power drawn by the chassis itself (board, fans baseline) beyond listed components. */
  baseW: number;
  slots: SlotDef[];
  /** Onboard ports (not tied to a removable component). */
  ports: PortDef[];
  /** Default population: slot id -> component model id. */
  defaults: Record<string, string>;
  /** How power reaches the equipment. */
  powerPath: 'psu' | 'busbar' | 'feed' | 'none';
  /** Total time from power-on to OS running (simulation value). */
  bootTimeMs: number;
  /** Portion of the boot spent in POST. */
  postMs: number;
  /** PDU rating (0U PDUs only). */
  pdu?: { ratingW: number };
  /** CDU nominal flow per served rack, L/min (simplified). */
  cdu?: { nominalFlowLpmPerRack: number; supplySetpointC: number };
  description: string;
}

export type CableMedia = 'copper' | 'dac' | 'aoc' | 'mmf' | 'smf' | 'power' | 'usb' | 'console' | 'video';

export interface CableModel extends AccuracyNote {
  id: string;
  name: string;
  shortName: string;
  media: CableMedia;
  /** Plug on end A and end B. */
  ends: [ConnectorType, ConnectorType];
  /** Supported speeds for copper/DAC/AOC; undefined for passive fibre (transceiver decides). */
  speedsGbps?: number[];
  lengthM: number;
  /** Serial console cables carry console signalling only. */
  console?: boolean;
  color: string;
}

export interface TransceiverModel extends AccuracyNote {
  id: string;
  name: string;
  /** Cage form factor it plugs into (matches a ConnectorType family). */
  formFactor: ConnectorType;
  /** Optical receptacle it exposes to the fibre. */
  receptacle: 'lc_duplex' | 'mpo12';
  media: 'mmf' | 'smf';
  speedsGbps: number[];
  reachM: number;
}
