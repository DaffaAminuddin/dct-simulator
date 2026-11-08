/**
 * Reusable connector validation (SIMULATION_SPEC §2).
 * Stage 1, mechanical fit: can this plug physically enter this receptacle?
 * Stage 2, link compatibility: with both ends plugged, can a link come up?
 */
import { getCableModel, getTransceiverModel } from '@/data/cables/cableCatalog';
import type { CableModel, ConnectorType, PortType } from '@/types/catalog';
import type { Port, SimulationState } from '@/types/simulation';

/** Plugs each receptacle accepts directly (without a transceiver). */
export const CAGE_ACCEPTS: Record<PortType, ConnectorType[]> = {
  rj45: ['rj45'],
  serial_rj45: ['rj45'],
  sfp: ['sfp_plus', 'sfp28'],
  sfp_plus: ['sfp_plus', 'sfp28'],
  sfp28: ['sfp_plus', 'sfp28'],
  qsfp28: ['qsfp28'],
  qsfp112: ['qsfp28', 'qsfp112'],
  qsfp_dd: ['qsfp28', 'qsfp112', 'qsfp_dd'],
  osfp: ['osfp'],
  usb_a: ['usb_a'],
  usb_c: ['usb_c'],
  hdmi: ['hdmi'],
  psu_c14: ['c13'],
  psu_c20: ['c19'],
  pdu_c13: ['c14'],
  pdu_c19: ['c20'],
  dc_in: ['dc_laptop'],
};

export const PORT_TYPE_LABEL: Record<PortType, string> = {
  rj45: 'RJ45',
  serial_rj45: 'RJ45 serial console',
  sfp: 'SFP (1G)',
  sfp_plus: 'SFP+',
  sfp28: 'SFP28',
  qsfp28: 'QSFP28',
  qsfp112: 'QSFP112',
  qsfp_dd: 'QSFP-DD',
  osfp: 'OSFP',
  usb_a: 'USB-A',
  usb_c: 'USB-C',
  hdmi: 'HDMI',
  psu_c14: 'IEC C14 inlet',
  psu_c20: 'IEC C20 inlet',
  pdu_c13: 'IEC C13 outlet',
  pdu_c19: 'IEC C19 outlet',
  dc_in: 'DC power inlet',
};

export const CONNECTOR_LABEL: Record<ConnectorType, string> = {
  rj45: 'RJ45 plug',
  sfp_plus: 'SFP+ plug',
  sfp28: 'SFP28 plug',
  qsfp28: 'QSFP28 plug',
  qsfp112: 'QSFP112 plug',
  qsfp_dd: 'QSFP-DD plug',
  osfp: 'OSFP plug',
  lc_duplex: 'LC duplex fibre connector',
  mpo12: 'MPO-12 fibre connector',
  c13: 'IEC C13 plug',
  c14: 'IEC C14 plug',
  c19: 'IEC C19 plug',
  c20: 'IEC C20 plug',
  usb_a: 'USB-A plug',
  usb_c: 'USB-C plug',
  hdmi: 'HDMI plug',
  dc_laptop: 'Laptop DC plug',
};

const FIBRE_CONNECTORS: ReadonlySet<ConnectorType> = new Set(['lc_duplex', 'mpo12']);
const POWER_PORTS: ReadonlySet<PortType> = new Set(['psu_c14', 'psu_c20', 'pdu_c13', 'pdu_c19', 'dc_in']);
const PASSIVE_ROLES = new Set(['power_in', 'power_out', 'usb', 'console', 'video']);

export interface FitResult {
  ok: boolean;
  reason?: string;
}

/** Stage 1: mechanical fit of one cable end into one port. */
export function checkFit(port: Pick<Port, 'type' | 'transceiver'>, plug: ConnectorType): FitResult {
  if (FIBRE_CONNECTORS.has(plug)) {
    if (!port.transceiver) {
      return { ok: false, reason: `${CONNECTOR_LABEL[plug]} needs an optical transceiver in the ${PORT_TYPE_LABEL[port.type]} port` };
    }
    const x = getTransceiverModel(port.transceiver.modelId);
    if (x.receptacle !== plug) {
      return { ok: false, reason: `The installed ${x.name} transceiver has a ${CONNECTOR_LABEL[x.receptacle]} receptacle, not ${CONNECTOR_LABEL[plug]}` };
    }
    return { ok: true };
  }
  if (port.transceiver) {
    return { ok: false, reason: `Port is occupied by an optical transceiver; a ${CONNECTOR_LABEL[plug]} cannot be inserted` };
  }
  if (!CAGE_ACCEPTS[port.type].includes(plug)) {
    return { ok: false, reason: `${CONNECTOR_LABEL[plug]} does not fit this ${PORT_TYPE_LABEL[port.type]} port` };
  }
  return { ok: true };
}

export interface LinkResult {
  ok: boolean;
  speedGbps: number;
  reason?: string;
}

function intersect(a: number[], b: number[]): number[] {
  return a.filter((x) => b.includes(x));
}

/** Speeds a port can run with what is plugged into it (transceiver narrows the set). */
function portSpeeds(port: Pick<Port, 'speedsGbps' | 'transceiver'>): number[] {
  if (port.transceiver) return intersect(port.speedsGbps, getTransceiverModel(port.transceiver.modelId).speedsGbps);
  return port.speedsGbps;
}

/** Stage 2: can a link come up between two ports over this cable? */
export function evaluateLink(a: Port, b: Port, cable: CableModel): LinkResult {
  const isPowerA = POWER_PORTS.has(a.type);
  const isPowerB = POWER_PORTS.has(b.type);
  if (isPowerA || isPowerB) {
    const outlet = [a, b].some((p) => p.role === 'power_out');
    const inlet = [a, b].some((p) => p.role === 'power_in');
    return outlet && inlet ? { ok: true, speedGbps: 0 } : { ok: false, speedGbps: 0, reason: 'A power cord must run from a PDU outlet to a device inlet' };
  }

  const consolePort = a.type === 'serial_rj45' || b.type === 'serial_rj45';
  if (consolePort && !cable.console) {
    return { ok: false, speedGbps: 0, reason: 'Serial console ports need a console (rollover) cable; an Ethernet cord carries no console signal' };
  }
  if (cable.console && !consolePort) {
    return { ok: false, speedGbps: 0, reason: 'A console cable cannot carry Ethernet traffic' };
  }
  if (PASSIVE_ROLES.has(a.role) || PASSIVE_ROLES.has(b.role)) return { ok: true, speedGbps: 0 };

  let media: number[];
  if (cable.speedsGbps) {
    media = cable.speedsGbps;
  } else {
    if (!a.transceiver || !b.transceiver) return { ok: false, speedGbps: 0, reason: 'Fibre link needs a transceiver at both ends' };
    const xa = getTransceiverModel(a.transceiver.modelId);
    const xb = getTransceiverModel(b.transceiver.modelId);
    if (xa.media !== xb.media) return { ok: false, speedGbps: 0, reason: `Optic mismatch: ${xa.name} (${xa.media.toUpperCase()}) vs ${xb.name} (${xb.media.toUpperCase()})` };
    if (cable.media !== xa.media) {
      return { ok: false, speedGbps: 0, reason: `${xa.media === 'mmf' ? 'Multimode' : 'Single-mode'} optics on ${cable.media === 'mmf' ? 'multimode' : 'single-mode'} fibre` };
    }
    media = intersect(xa.speedsGbps, xb.speedsGbps);
    if (media.length === 0) return { ok: false, speedGbps: 0, reason: `No common optic speed: ${xa.name} / ${xb.name}` };
  }

  const common = intersect(intersect(portSpeeds(a), portSpeeds(b)), media);
  if (common.length === 0) {
    return {
      ok: false,
      speedGbps: 0,
      reason: `No common speed: ${a.label} [${portSpeeds(a).join('/')}G], ${b.label} [${portSpeeds(b).join('/')}G], cable [${media.join('/')}G]`,
    };
  }
  return { ok: true, speedGbps: Math.max(...common) };
}

/** Approximate cable run between two ports (metres), used for length validation. */
export function requiredLengthM(s: SimulationState, a: Port, b: Port): number {
  const ea = s.equipment[a.equipmentId];
  const eb = s.equipment[b.equipmentId];
  const la = ea.location;
  const lb = eb.location;
  if (la.kind !== 'rack' || lb.kind !== 'rack') return 0;
  const uOf = (u: number | null) => (u === null ? null : u);
  if (la.rackId === lb.rackId) {
    const ua = uOf(la.uStart);
    const ub = uOf(lb.uStart);
    const du = ua === null || ub === null ? 0 : Math.abs(ua - ub);
    return 0.8 + du * 0.0445;
  }
  const ra = s.racks[la.rackId];
  const rb = s.racks[lb.rackId];
  // Manhattan run along the overhead trays plus vertical drops at both racks.
  return Math.abs(ra.position.x - rb.position.x) + Math.abs(ra.position.z - rb.position.z) + 3;
}

export function cableModelOf(modelId: string): CableModel {
  return getCableModel(modelId);
}
