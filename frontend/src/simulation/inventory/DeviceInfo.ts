/**
 * Device information sheet: everything a technician copies into a ticket or
 * needs at the rack (hostname, model, part number, serial, asset tag,
 * location, management and data addresses, switch ports, firmware). Pure
 * read of the simulation state; addresses match what the terminal shows
 * (`ipmitool lan print`, `ip a`).
 */
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { isHost, locationLabel, peerPort } from '@/simulation/core/SimulationState';
import { formatU, hash32, macFor } from '@/simulation/core/util';
import { portLinkAddress } from '@/simulation/terminal/os/HostOs';
import type { Equipment, Port, PortState, SimulationState } from '@/types/simulation';

const EQUIPMENT_FAMILY: Record<string, string> = {
  server: 'SRV',
  compute_tray: 'CTR',
  nvlink_switch_tray: 'NVT',
  power_shelf: 'PSH',
  switch: 'SWT',
  pdu: 'PDU',
  blank: 'BLK',
  cdu: 'CDU',
  laptop: 'LAP',
};

const COMPONENT_FAMILY: Record<string, string> = {
  cpu: 'CPU',
  dimm: 'MEM',
  gpu: 'GPU',
  nvme: 'SSD',
  ssd: 'SSD',
  raid: 'RAI',
  nic: 'NIC',
  dpu: 'DPU',
  riser: 'RSR',
  psu: 'PSU',
  fan: 'FAN',
  motherboard: 'MBD',
  bmc: 'BMC',
  nvswitch: 'NVS',
  asic: 'ASC',
  pump: 'PMP',
};

/** Simulated part number for a catalog model, e.g. `SRV-4821-B02` (not a vendor part number). */
export function partNumber(modelId: string, family: string): string {
  const h = hash32(`pn:${modelId}`);
  return `${family}-${1000 + (h % 9000)}-${String.fromCharCode(65 + ((h >>> 13) % 4))}0${1 + ((h >>> 17) % 3)}`;
}

export const equipmentPartNumber = (modelId: string): string => partNumber(modelId, EQUIPMENT_FAMILY[getEquipmentModel(modelId).kind] ?? 'EQP');
export const componentPartNumber = (modelId: string): string => partNumber(modelId, COMPONENT_FAMILY[getComponentModel(modelId).category] ?? 'CMP');

export interface NetIdentity {
  /** Port label on the chassis, e.g. `BMC`, `OCP 3.0 NIC slot P1`. */
  label: string;
  /** OS interface name, e.g. `ens1f0np0`. */
  iface?: string;
  role: Port['role'];
  ip?: string;
  prefix?: number;
  gateway?: string;
  /** MAC, or the InfiniBand link-layer address. */
  address: string;
  state: PortState;
  speedGbps: number;
  /** Far end, e.g. `dh1-r01-oob1 · ge3`. */
  peer?: string;
  portId: string;
}

export interface DeviceInfo {
  id: string;
  hostname: string;
  kind: Equipment['kind'];
  model: string;
  shortModel: string;
  manufacturer: string;
  partNumber: string;
  serial: string;
  assetTag: string;
  location: string;
  rackId?: string;
  uLabel?: string;
  os?: string;
  firmware?: { bios: string; bmc: string };
  /** BMC (servers, trays) or management port (switches). */
  management?: NetIdentity;
  /** Data and fabric interfaces (hosts only). */
  network: NetIdentity[];
  /** Copy-ready shortcut to reach the device from the technician laptop. */
  sshHint?: string;
}

function identity(s: SimulationState, eq: Equipment, p: Port): NetIdentity {
  const peer = peerPort(s, p);
  return {
    label: p.label,
    iface: p.role === 'bmc' ? undefined : p.osName,
    role: p.role,
    ip: p.ip?.address,
    prefix: p.ip?.prefix,
    gateway: p.ip?.gateway,
    address: eq.kind === 'laptop' ? macFor(eq.serial) : portLinkAddress(eq, p),
    state: p.state,
    speedGbps: p.speedGbps,
    peer: peer ? `${s.equipment[peer.equipmentId].hostname} · ${peer.label}` : p.cableId ? 'far end loose' : undefined,
    portId: p.id,
  };
}

export function deviceInfo(s: SimulationState, eq: Equipment): DeviceInfo {
  const model = getEquipmentModel(eq.modelId);
  const ports = eq.portIds.map((id) => s.ports[id]).filter(Boolean);
  const mgmt = ports.find((p) => p.role === 'bmc');
  const host = isHost(eq) && eq.kind !== 'switch';
  const network = host ? ports.filter((p) => p.componentId && (p.role === 'data' || p.role === 'fabric')).map((p) => identity(s, eq, p)) : [];
  network.sort((a, b) => Number(!!b.ip) - Number(!!a.ip) || (a.iface ?? a.label).localeCompare(b.iface ?? b.label, undefined, { numeric: true }));
  const loc = eq.location;
  return {
    id: eq.id,
    hostname: eq.hostname,
    kind: eq.kind,
    model: model.name,
    shortModel: model.shortName,
    manufacturer: model.manufacturer,
    partNumber: equipmentPartNumber(eq.modelId),
    serial: eq.serial,
    assetTag: eq.assetTag,
    location: locationLabel(s, eq),
    rackId: loc.kind === 'rack' || loc.kind === 'cart' ? loc.rackId : undefined,
    uLabel: loc.kind === 'rack' ? (loc.uStart === null ? `0U ${loc.side ?? ''}`.trim() : formatU(loc.uStart, model.heightU)) : undefined,
    os: isHost(eq) ? eq.software.os : undefined,
    firmware: isHost(eq) ? { bios: eq.kind === 'switch' ? '—' : '2.4 (simulated)', bmc: eq.kind === 'switch' ? 'Network OS (reference)' : '2.40 (simulated)' } : undefined,
    management: mgmt ? identity(s, eq, mgmt) : undefined,
    network,
    sshHint: mgmt?.ip ? (eq.kind === 'switch' ? `ssh netops@${eq.hostname}` : `ssh admin@${eq.hostname}-bmc`) : undefined,
  };
}
