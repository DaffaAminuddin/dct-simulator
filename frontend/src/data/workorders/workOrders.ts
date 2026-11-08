/**
 * Work order catalog (hypothetical training scenarios). Each ticket gives
 * symptoms only. Its setup (fault injection or physical change) and
 * resolution checks are evaluated against the simulation engine, never
 * against UI state.
 */
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { componentInSlot, portsOf } from '@/simulation/core/SimulationState';
import { bmcReachability } from '@/simulation/networking/NetworkTopology';
import { feedRedundancyIssues } from '@/simulation/hardware/Rack';
import type { Id, SimAction, SimulationState } from '@/types/simulation';

export type Priority = 'P1' | 'P2' | 'P3' | 'P4';

export interface ResolutionCheck {
  label: string;
  ok: boolean;
}

export interface WorkOrderDef {
  id: string;
  title: string;
  priority: Priority;
  location: { rackId: Id; u: string; equipmentId?: Id };
  issue: string;
  symptoms: string[];
  objective: string;
  tasks: string[];
  moduleId: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  /** Already present in the seed scenario (no setup needed). */
  seeded?: boolean;
  /** Actions applied when the learner starts the ticket. */
  setup?: SimAction[];
  /** Hint shown in Guided / Practice modes. */
  hint: string;
  validate: (s: SimulationState) => ResolutionCheck[];
  /** Expected minimum time (s) — used for time-efficiency feedback. */
  targetTimeS: number;
}

function equipmentAt(s: SimulationState, rackId: Id, u: number): Id | undefined {
  for (const e of Object.values(s.equipment)) {
    if (e.location.kind === 'rack' && e.location.rackId === rackId && e.location.uStart === u) return e.id;
  }
  return undefined;
}

const running = (s: SimulationState, id: Id | undefined) => !!id && s.equipment[id]?.state === 'os_running';

export const WORK_ORDERS: WorkOrderDef[] = [
  {
    id: 'DCT-0001',
    title: 'GPU initialization failure on GB200 compute tray',
    priority: 'P1',
    location: { rackId: 'R05', u: 'U11', equipmentId: 'ct-r05-07' },
    issue: 'GPU compute node is reporting a GPU initialization failure.',
    symptoms: [
      'Server is powered on',
      'BMC is accessible',
      'OS boots successfully',
      'One GPU is missing from NVIDIA SMI',
      'DCGM reports incomplete GPU discovery',
    ],
    objective: 'Identify the root cause and restore normal operation of all four GPUs in the tray.',
    tasks: [
      'Inspect server health',
      'Check GPU visibility',
      'Inspect PCIe / host-link topology',
      'Review kernel logs',
      'Inspect physical connections',
      'Identify the faulty component',
      'Perform an approved repair',
      'Run validation',
      'Update the work order',
    ],
    moduleId: 'nvidia-diagnostics',
    difficulty: 'advanced',
    setup: [{ type: 'fault/inject', faultType: 'gpu_fallen_off_bus', targetId: 'ct-r05-07/gpu2', hidden: true, source: 'scenario' }],
    hint: 'The BMC looks healthy, so the issue is only visible from the OS and driver side (GPU Diagnostics). GB200 GPUs are not field-replaceable: the repair unit is the compute tray.',
    validate: (s) => {
      const id = equipmentAt(s, 'R05', 11);
      const eq = id ? s.equipment[id] : undefined;
      const gpus = eq ? [0, 1, 2, 3].map((i) => componentInSlot(s, eq, `gpu${i}`)) : [];
      return [
        { label: 'A compute tray is installed at R05 U11', ok: eq?.kind === 'compute_tray' },
        { label: 'Tray OS running without degraded conditions', ok: running(s, id) },
        { label: '4 / 4 GPUs initialized', ok: gpus.length === 4 && gpus.every((g) => g?.gpu?.lifecycle === 'initialized' && g.status === 'ok') },
        { label: 'NVLink 18 / 18 on every GPU', ok: gpus.length === 4 && gpus.every((g) => g?.gpu?.nvlinkActive === 18) },
        { label: 'BMC reachable', ok: !!id && bmcReachability(s, id).reachable },
      ];
    },
    targetTimeS: 900,
  },
  {
    id: 'DCT-0002',
    title: 'Power redundancy lost on storage node',
    priority: 'P3',
    location: { rackId: 'R02', u: 'U23', equipmentId: 'srv-r02-n04' },
    issue: 'Monitoring reports "power supply redundancy lost" on dh1-r02-n04 since the last maintenance window.',
    symptoms: ['Host running, health degraded', 'BMC: PSU 2 AC input lost', 'No other host in R02 affected'],
    objective: 'Restore A+B redundant power to the host without interrupting it.',
    tasks: ['Check PSU status in the BMC view', 'Inspect the rear of the server', 'Trace the power cords to the PDUs', 'Restore the missing feed', 'Verify redundancy'],
    moduleId: 'power-infrastructure',
    difficulty: 'beginner',
    seeded: true,
    hint: 'Look at the rear view of R02: PSU 2 of n04 has no cord. Take a C13/C14 cord from inventory and connect it from PSU 2 to the B-side PDU, so that each PSU is on a different feed.',
    validate: (s) => {
      const eq = s.equipment['srv-r02-n04'];
      const psu2 = componentInSlot(s, eq, 'psu2');
      return [
        { label: 'PSU 2 receives AC input', ok: !!psu2?.inputLive },
        { label: 'Power status redundant', ok: eq.powerStatus === 'redundant' },
        { label: 'PSUs on both feeds (A and B)', ok: feedRedundancyIssues(s, eq).length === 0 },
        { label: 'Host still running', ok: eq.state === 'os_running' },
      ];
    },
    targetTimeS: 180,
  },
  {
    id: 'DCT-0003',
    title: 'BMC unreachable on compute node',
    priority: 'P2',
    location: { rackId: 'R01', u: 'U15', equipmentId: 'srv-r01-06' },
    issue: 'Out-of-band monitoring lost contact with the BMC of dh1-r01-n06. In-band monitoring still reports the host up.',
    symptoms: ['BMC does not answer Redfish / IPMI', 'Host OS reachable on the data network', 'No power alarms'],
    objective: 'Restore out-of-band management access.',
    tasks: ['Confirm the host is powered', 'Check the management port link LED', 'Trace the management cable to the OOB switch', 'Re-seat or replace the cable', 'Confirm BMC reachability'],
    moduleId: 'cabling',
    difficulty: 'beginner',
    setup: [{ type: 'cable/disconnect', cableId: '@srv-r01-06:bmc', end: 0 }],
    hint: 'Physical layer first: in the rear view the BMC port of n06 has no cable. The other end is still in the OOB switch.',
    validate: (s) => [
      { label: 'BMC reachable over the management network', ok: bmcReachability(s, 'srv-r01-06').reachable },
      { label: 'Host OS still running', ok: running(s, 'srv-r01-06') },
    ],
    targetTimeS: 240,
  },
  {
    id: 'DCT-0004',
    title: 'Fan failure alarm on GPU server',
    priority: 'P2',
    location: { rackId: 'R03', u: 'U12–U15', equipmentId: 'srv-r03-g02' },
    issue: 'BMC raised a fan failure alarm on dh1-r03-g02 during a training job.',
    symptoms: ['Fan alarm in the SEL', 'Remaining fans at higher RPM', 'GPU temperatures stable so far'],
    objective: 'Replace the failed fan without stopping the training job.',
    tasks: ['Identify the failed fan module', 'Confirm the fan is hot-swappable', 'Fetch a matching spare', 'Hot-swap the fan', 'Verify RPM and temperatures'],
    moduleId: 'server-hardware',
    difficulty: 'beginner',
    setup: [{ type: 'fault/inject', faultType: 'fan_failure', targetId: 'srv-r03-g02/fan3', hidden: true, source: 'scenario' }],
    hint: 'GX-4800 front fans are hot-swappable from the front. Use the Hardware Lab: remove the fan with the amber LED and install the 80 mm spare.',
    validate: (s) => {
      const eq = s.equipment['srv-r03-g02'];
      const fans = getEquipmentModel(eq.modelId).slots.filter((sl) => sl.category === 'fan').map((sl) => componentInSlot(s, eq, sl.id));
      return [
        { label: 'All fan slots populated', ok: fans.every(Boolean) },
        { label: 'Every fan spinning', ok: fans.every((f) => f && f.status === 'ok' && (f.rpm ?? 0) > 0) },
        { label: 'Host running without degraded conditions', ok: eq.state === 'os_running' },
      ];
    },
    targetTimeS: 240,
  },
  {
    id: 'DCT-0005',
    title: 'Uncorrectable memory errors on storage server',
    priority: 'P1',
    location: { rackId: 'R02', u: 'U14–U15', equipmentId: 'srv-r02-s03' },
    issue: 'dh1-r02-s03 logged uncorrectable ECC events and is running degraded.',
    symptoms: ['Host health degraded', 'Memory errors in the SEL', 'Applications report instability'],
    objective: 'Replace the failing DIMM following a safe service procedure.',
    tasks: ['Identify the DIMM slot from the SEL', 'Shut the host down', 'Remove AC power', 'Open the chassis and replace the DIMM', 'Restore power and verify POST'],
    moduleId: 'server-hardware',
    difficulty: 'intermediate',
    setup: [{ type: 'fault/inject', faultType: 'dimm_uncorrectable', targetId: 'srv-r02-s03/dimm1_2', hidden: true, source: 'scenario' }],
    hint: 'DIMMs are not hot-swappable. Power off, unplug both PSU cords, open the lid, then swap the DIMM with the matching 32 GB DDR5 spare. Reconnect each cord to its original feed.',
    validate: (s) => {
      const eq = s.equipment['srv-r02-s03'];
      const dimms = getEquipmentModel(eq.modelId).slots.filter((sl) => sl.category === 'dimm').map((sl) => componentInSlot(s, eq, sl.id)).filter(Boolean);
      return [
        { label: 'No failed DIMM installed', ok: dimms.every((d) => d?.status !== 'failed') },
        { label: 'Chassis closed', ok: !eq.chassisOpen },
        { label: 'Redundant A+B power restored', ok: eq.powerStatus === 'redundant' && feedRedundancyIssues(s, eq).length === 0 },
        { label: 'Host OS running', ok: eq.state === 'os_running' },
      ];
    },
    targetTimeS: 600,
  },
  {
    id: 'DCT-0006',
    title: 'Deploy a new compute node in R01',
    priority: 'P4',
    location: { rackId: 'R01', u: 'U18' },
    issue: 'Capacity request: install the new RS-1100 (dh1-new-n01) from the spares cage into R01 U18 and bring it online.',
    symptoms: ['New server staged in inventory', 'R01 has open U at U18–U19'],
    objective: 'Rack, cable (A+B power, BMC, data) and power on the new node.',
    tasks: ['Mount the server at R01 U18', 'Connect PSU 1 to PDU-A and PSU 2 to PDU-B', 'Connect the BMC to the OOB switch', 'Connect OCP port 1 to the ToR switch', 'Power on and verify'],
    moduleId: 'server-deployment',
    difficulty: 'intermediate',
    seeded: true,
    hint: 'Mount it from Rack Explorer (rack summary). Then, in the rear view, select each empty port and connect a cable of the right type from inventory.',
    validate: (s) => {
      const eq = s.equipment['spare-srv-1u-01'];
      const loc = eq.location;
      const data = portsOf(s, eq).find((p) => p.defId === 'p0' && p.slotId === 'ocp0');
      return [
        { label: 'Mounted in R01 at U18', ok: loc.kind === 'rack' && loc.rackId === 'R01' && loc.uStart === 18 },
        { label: 'Redundant A+B power', ok: eq.powerStatus === 'redundant' && feedRedundancyIssues(s, eq).length === 0 },
        { label: 'BMC reachable', ok: bmcReachability(s, eq.id).reachable },
        { label: 'Data link up on OCP port 1', ok: data?.state === 'link_up' },
        { label: 'OS running', ok: eq.state === 'os_running' },
      ];
    },
    targetTimeS: 600,
  },
];

export function getWorkOrder(id: string): WorkOrderDef | undefined {
  return WORK_ORDERS.find((w) => w.id === id);
}

/** Resolve `@<portId>` cable references in setup actions against the live state. */
export function resolveSetup(s: SimulationState, action: SimAction): SimAction | null {
  if (action.type === 'cable/disconnect' && action.cableId.startsWith('@')) {
    const port = s.ports[action.cableId.slice(1)];
    if (!port?.cableId || port.cableEnd === null) return null;
    return { type: 'cable/disconnect', cableId: port.cableId, end: port.cableEnd };
  }
  return action;
}
