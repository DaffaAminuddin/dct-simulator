/**
 * Fault definitions. Each definition says what the learner sees (symptoms), what
 * the simulation changes (observable effects), the hidden root cause, the evidence
 * that proves it, the approved recovery procedure and how to validate the fix.
 * Effects are implemented in the owning rule module (see SIMULATION_SPEC §8).
 */
import type { ComponentCategory, EquipmentKind } from '@/types/catalog';
import type { FaultTargetKind, FaultType, Severity } from '@/types/simulation';

export interface FaultParamDef {
  name: string;
  label: string;
  default: number;
  options?: { value: number; label: string }[];
}

export interface FaultDefinition {
  type: FaultType;
  name: string;
  targetKind: FaultTargetKind;
  targetCategories?: ComponentCategory[];
  targetEquipmentKinds?: EquipmentKind[];
  severity: Severity;
  symptoms: string[];
  observableEffects: string[];
  rootCause: string;
  diagnosticEvidence: string[];
  recovery: string[];
  validation: string[];
  params?: FaultParamDef[];
}

/** XID codes from NVIDIA's public XID error documentation, as used by this simulator. */
export const XID_INFO: Record<number, { name: string; fatal: boolean }> = {
  13: { name: 'Graphics Engine Exception', fatal: false },
  31: { name: 'GPU memory page fault', fatal: false },
  43: { name: 'GPU stopped processing', fatal: false },
  48: { name: 'Double Bit ECC Error', fatal: true },
  63: { name: 'ECC page retirement or row remapping recording event', fatal: false },
  64: { name: 'ECC page retirement or row remapper recording failure', fatal: true },
  74: { name: 'NVLink Error', fatal: false },
  79: { name: 'GPU has fallen off the bus', fatal: true },
  92: { name: 'High single-bit ECC error rate', fatal: false },
  94: { name: 'Contained ECC error', fatal: false },
  95: { name: 'Uncontained ECC error', fatal: true },
  119: { name: 'GSP RPC timeout', fatal: true },
};

const def = (d: FaultDefinition) => d;

export const FAULT_DEFINITIONS: Record<FaultType, FaultDefinition> = {
  psu_failure: def({
    type: 'psu_failure',
    name: 'PSU internal failure',
    targetKind: 'component',
    targetCategories: ['psu'],
    severity: 'warning',
    symptoms: ['Power redundancy lost alarm', 'Amber LED on one PSU'],
    observableEffects: ['PSU stops delivering output', 'Equipment power status → degraded (or off if it was the last PSU)'],
    rootCause: 'The PSU’s internal converter has failed while AC input is still present.',
    diagnosticEvidence: ['PSU LED amber with the cord still seated', 'BMC sensor: PSU status = failure, input present', 'Moving the cord to a known-good outlet does not help'],
    recovery: ['Confirm the other PSU(s) carry the load', 'Hot-swap the failed PSU with the same model', 'Reconnect the power cord'],
    validation: ['PSU LED green', 'Power status redundant', 'SEL shows the PSU fault deasserted'],
  }),
  fan_failure: def({
    type: 'fan_failure',
    name: 'Fan module failure',
    targetKind: 'component',
    targetCategories: ['fan'],
    severity: 'warning',
    symptoms: ['Fan failure alarm', 'Other fans spin up (louder)', 'Temperatures rise if more than one fan is lost'],
    observableEffects: ['Fan RPM 0', 'Airflow capacity reduced; remaining fans ramp up'],
    rootCause: 'Fan motor or bearing failure.',
    diagnosticEvidence: ['Fan LED amber', 'BMC fan sensor reads 0 RPM'],
    recovery: ['Hot-swap the fan module with a matching part'],
    validation: ['Fan RPM within range', 'Component temperatures back to baseline'],
  }),
  dimm_uncorrectable: def({
    type: 'dimm_uncorrectable',
    name: 'DIMM uncorrectable ECC error',
    targetKind: 'component',
    targetCategories: ['dimm'],
    severity: 'critical',
    symptoms: ['Host reports degraded health', 'Memory error alarm in BMC SEL'],
    observableEffects: ['DIMM marked failed', 'Host degraded', 'DIMM fault LED on the board'],
    rootCause: 'A memory module has developed uncorrectable errors.',
    diagnosticEvidence: ['SEL: uncorrectable ECC on a specific DIMM slot', 'Kernel log: EDAC uncorrected error', 'DIMM fault LED next to the slot (with standby power)'],
    recovery: ['Power off the host and remove AC power', 'Open the chassis', 'Replace the DIMM with the same type and capacity'],
    validation: ['POST memory test passes', 'No new ECC events', 'Host os_running'],
  }),
  nvme_failure: def({
    type: 'nvme_failure',
    name: 'NVMe / SSD failure',
    targetKind: 'component',
    targetCategories: ['nvme', 'ssd'],
    severity: 'critical',
    symptoms: ['Drive missing from the OS', 'Amber drive LED'],
    observableEffects: ['Drive failed', 'If it is the boot drive, the next boot fails'],
    rootCause: 'Flash media or controller failure on the drive.',
    diagnosticEvidence: ['Drive fault LED', 'BMC drive status failed', 'lsblk no longer lists the device'],
    recovery: ['Hot-swap front drives; boot drives need the host powered off'],
    validation: ['Drive visible and healthy', 'Host boots'],
  }),
  cpu_failure: def({
    type: 'cpu_failure',
    name: 'CPU internal error (IERR)',
    targetKind: 'component',
    targetCategories: ['cpu'],
    severity: 'critical',
    symptoms: ['Host crashed and will not complete POST', 'System health LED amber'],
    observableEffects: ['POST fails → boot_failed'],
    rootCause: 'Processor internal error.',
    diagnosticEvidence: ['SEL: processor IERR on a specific socket', 'POST halts at CPU initialization'],
    recovery: ['Escalate per site policy; replace the CPU or system board'],
    validation: ['POST completes', 'Host os_running'],
  }),
  gpu_fallen_off_bus: def({
    type: 'gpu_fallen_off_bus',
    name: 'GPU fell off the bus',
    targetKind: 'component',
    targetCategories: ['gpu'],
    severity: 'critical',
    symptoms: ['One GPU missing from nvidia-smi', 'Training job fails on the node', 'BMC health looks normal'],
    observableEffects: ['GPU not enumerated', 'XID 79 in the kernel log'],
    rootCause: 'The GPU stopped responding on its host link (PCIe / C2C) and dropped off the bus.',
    diagnosticEvidence: ['dmesg: NVRM Xid 79', 'lspci missing the device', 'nvidia-smi lists fewer GPUs'],
    recovery: ['Attempt a GPU reset or reboot', 'If it recurs, reseat or replace the GPU module or tray'],
    validation: ['All GPUs listed', 'DCGM diagnostics pass'],
  }),
  gpu_xid: def({
    type: 'gpu_xid',
    name: 'GPU XID error',
    targetKind: 'component',
    targetCategories: ['gpu'],
    severity: 'warning',
    symptoms: ['XID logged in the kernel log', 'Jobs may fail on that GPU'],
    observableEffects: ['XID recorded; fatal XIDs fail the GPU'],
    rootCause: 'Depends on the XID code (driver, memory, interconnect or hardware fault).',
    diagnosticEvidence: ['dmesg: NVRM: Xid (PCI:…): <code>', 'nvidia-smi -q error counters'],
    recovery: ['Look up the XID meaning, then follow its procedure (reset, reseat, RMA)'],
    validation: ['No new XIDs under load', 'DCGM diagnostics pass'],
    params: [
      {
        name: 'xid',
        label: 'XID code',
        default: 79,
        options: Object.entries(XID_INFO).map(([code, info]) => ({ value: Number(code), label: `${code}: ${info.name}` })),
      },
    ],
  }),
  hbm_ecc_uncorrectable: def({
    type: 'hbm_ecc_uncorrectable',
    name: 'HBM uncorrectable ECC error',
    targetKind: 'component',
    targetCategories: ['gpu'],
    severity: 'critical',
    symptoms: ['GPU reported as failed by DCGM', 'Job crashed with an ECC error'],
    observableEffects: ['Uncorrectable ECC counter increments', 'XID 48', 'GPU failed'],
    rootCause: 'Uncorrectable error in the GPU’s HBM stacks.',
    diagnosticEvidence: ['nvidia-smi -q: volatile/aggregate uncorrectable ECC > 0', 'XID 48 in the kernel log'],
    recovery: ['Reset the GPU; if errors persist, replace the GPU module or tray'],
    validation: ['ECC counters stable', 'DCGM memory diagnostic passes'],
    params: [{ name: 'count', label: 'Uncorrectable errors', default: 4 }],
  }),
  gpu_cooling_degraded: def({
    type: 'gpu_cooling_degraded',
    name: 'Degraded GPU cooling path',
    targetKind: 'component',
    targetCategories: ['gpu'],
    severity: 'warning',
    symptoms: ['One GPU runs much hotter than its peers', 'Clocks drop under load'],
    observableEffects: ['Thermal resistance × 2.5 for this GPU'],
    rootCause: 'Poor cold-plate or heatsink contact (dried thermal interface material or a blocked channel).',
    diagnosticEvidence: ['GPU temperature well above peers at the same load', 'Thermal throttle reason active'],
    recovery: ['Power off; reseat or re-paste the GPU cooling (depot procedure for liquid-cooled trays)'],
    validation: ['GPU temperature in line with peers under load'],
  }),
  nvlink_down: def({
    type: 'nvlink_down',
    name: 'NVLink links down',
    targetKind: 'component',
    targetCategories: ['gpu'],
    severity: 'warning',
    symptoms: ['Collective bandwidth lower than expected', 'NCCL tests slow on this node'],
    observableEffects: ['N NVLink links inactive on the GPU'],
    rootCause: 'Link training failure on part of the GPU’s NVLink connections.',
    diagnosticEvidence: ['nvidia-smi nvlink --status shows inactive links', 'XID 74'],
    recovery: ['Reset the GPU/tray; inspect the spine connector seating; replace the tray if persistent'],
    validation: ['All 18 links active', 'NCCL bandwidth at baseline'],
    params: [{ name: 'links', label: 'Links down', default: 2 }],
  }),
  riser_failure: def({
    type: 'riser_failure',
    name: 'PCIe riser failure',
    targetKind: 'component',
    targetCategories: ['riser'],
    severity: 'critical',
    symptoms: ['Several GPUs or NICs missing at once', 'PCIe errors in the logs'],
    observableEffects: ['Devices behind the riser are not enumerated'],
    rootCause: 'The PCIe riser (or its PCIe switch) has failed.',
    diagnosticEvidence: ['Every missing device sits behind the same riser', 'lspci topology gap'],
    recovery: ['Power off, open the chassis, replace the riser'],
    validation: ['All devices enumerate', 'Link width/speed as expected'],
  }),
  nvswitch_failure: def({
    type: 'nvswitch_failure',
    name: 'NVLink switch tray failure',
    targetKind: 'equipment',
    targetEquipmentKinds: ['nvlink_switch_tray'],
    severity: 'critical',
    symptoms: ['Every GPU in the rack lost 2 NVLink links', 'Rack-wide collective bandwidth drop'],
    observableEffects: ['The tray provides no NVLink connectivity'],
    rootCause: 'The NVLink switch tray’s switch chips are not operating.',
    diagnosticEvidence: ['All GPUs show the same 2 inactive links', 'Switch tray BMC reports a switch fault'],
    recovery: ['Replace the NVLink switch tray per the rack service procedure'],
    validation: ['18/18 links on every GPU'],
  }),
  nic_failure: def({
    type: 'nic_failure',
    name: 'NIC hardware failure',
    targetKind: 'component',
    targetCategories: ['nic', 'dpu'],
    severity: 'critical',
    symptoms: ['Interface missing or link down', 'Node unreachable on that network'],
    observableEffects: ['All ports on the NIC become faulty'],
    rootCause: 'NIC controller failure.',
    diagnosticEvidence: ['Port LEDs dark with a known-good cable', 'Interface missing in ip link'],
    recovery: ['Power off and replace the NIC'],
    validation: ['Link up at the expected speed', 'Traffic passes'],
  }),
  port_faulty: def({
    type: 'port_faulty',
    name: 'Faulty port / cage',
    targetKind: 'port',
    severity: 'warning',
    symptoms: ['Link down on one port only'],
    observableEffects: ['Port faulty'],
    rootCause: 'Damaged cage or PHY on this port.',
    diagnosticEvidence: ['Link stays down with a known-good cable', 'Moving the cable to another port restores link'],
    recovery: ['Move the connection to a spare port and update the patch records; schedule repair'],
    validation: ['Link up on the new port'],
  }),
  cable_damaged: def({
    type: 'cable_damaged',
    name: 'Damaged cable',
    targetKind: 'cable',
    severity: 'warning',
    symptoms: ['Link down or flapping', 'CRC errors (Phase 5)'],
    observableEffects: ['Link down on both ends'],
    rootCause: 'Cable conductor or fibre damage (crushed, over-bent, dirty connector).',
    diagnosticEvidence: ['Swapping in a known-good cable restores the link'],
    recovery: ['Replace the cable'],
    validation: ['Link up, error counters clean'],
  }),
  pdu_failure: def({
    type: 'pdu_failure',
    name: 'PDU failure / breaker trip',
    targetKind: 'equipment',
    targetEquipmentKinds: ['pdu'],
    severity: 'critical',
    symptoms: ['Every device in the rack lost one power feed', 'PDU display dark'],
    observableEffects: ['All outlets on the PDU dead'],
    rootCause: 'PDU breaker tripped or PDU controller failed.',
    diagnosticEvidence: ['All PSUs on the same side lost input', 'PDU outlets dead'],
    recovery: ['Check the load, reset the breaker per facility procedure, or replace the PDU'],
    validation: ['Outlets live', 'All PSUs report input', 'Redundancy restored'],
  }),
  feed_loss: def({
    type: 'feed_loss',
    name: 'Facility feed loss',
    targetKind: 'feed',
    severity: 'critical',
    symptoms: ['Power redundancy lost across many racks'],
    observableEffects: ['Every PDU and power shelf on the feed loses power'],
    rootCause: 'Upstream UPS or switchgear on one feed is down.',
    diagnosticEvidence: ['All A-side (or B-side) devices lost input at the same time'],
    recovery: ['Escalate to facilities; do not move cords to the surviving feed (overload risk)'],
    validation: ['Feed restored; redundancy back everywhere'],
  }),
  pump_failure: def({
    type: 'pump_failure',
    name: 'CDU pump failure',
    targetKind: 'component',
    targetCategories: ['pump'],
    severity: 'warning',
    symptoms: ['CDU redundancy alarm', 'If both pumps fail: rapid temperature rise in liquid-cooled racks'],
    observableEffects: ['Pump stops; flow capacity reduced'],
    rootCause: 'Pump motor or drive failure.',
    diagnosticEvidence: ['CDU controller shows pump fault', 'Flow rate drop'],
    recovery: ['Hot-swap the pump per the CDU procedure'],
    validation: ['Flow at nominal', 'Pump redundancy restored'],
  }),
  coolant_leak: def({
    type: 'coolant_leak',
    name: 'Coolant leak',
    targetKind: 'rack',
    severity: 'critical',
    symptoms: ['Leak detection alarm', 'Reduced flow to the rack'],
    observableEffects: ['Rack flow 70 %', 'Leak sensor active'],
    rootCause: 'Leaking quick-disconnect or manifold fitting.',
    diagnosticEvidence: ['Leak rope / sensor alarm location', 'Visible coolant at the fitting'],
    recovery: ['Follow the site leak-response procedure; isolate the affected loop; replace the fitting'],
    validation: ['Leak sensor clear', 'Flow and pressure nominal'],
  }),
  bmc_failure: def({
    type: 'bmc_failure',
    name: 'BMC unresponsive',
    targetKind: 'component',
    targetCategories: ['bmc'],
    severity: 'warning',
    symptoms: ['Remote management unreachable while the host still runs'],
    observableEffects: ['BMC dead: no SEL, no remote power control'],
    rootCause: 'BMC firmware hang or hardware failure.',
    diagnosticEvidence: ['BMC heartbeat LED off', 'Mgmt port link down with a good cable', 'Host OS cannot reach the BMC over IPMI'],
    recovery: ['AC power-cycle (drain standby) at a maintenance window, or replace the DC-SCM'],
    validation: ['BMC reachable', 'SEL readable'],
  }),
};

export const FAULT_TYPES = Object.keys(FAULT_DEFINITIONS) as FaultType[];
