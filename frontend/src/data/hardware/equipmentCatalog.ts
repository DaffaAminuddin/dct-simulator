/**
 * Equipment model catalog: chassis definitions with slots, onboard ports and
 * default population. Layout coordinates are percentages used by the 2D
 * chassis and panel renderers (x: left→right as seen from the front,
 * y: front (0) → rear (100)).
 *
 * All chassis are generic EDUCATIONAL REFERENCE MODELS. The GB200/GB300
 * NVL72-style racks follow publicly described building blocks (18 compute
 * trays, 9 NVLink switch trays, liquid cooling, busbar power). They do NOT
 * reproduce any OEM's internal layout.
 */
import type { ComponentCategory, EquipmentModel, PortDef, SlotAccess, SlotDef } from '@/types/catalog';

type Layout = SlotDef['layout'];

function slot(
  id: string,
  label: string,
  category: ComponentCategory,
  accepts: string[],
  access: SlotAccess,
  layout: Layout,
  extra: Partial<SlotDef> = {},
): SlotDef {
  return { id, label, category, accepts, access, layout, ...extra };
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** 8 DIMM slots arranged 4 left / 4 right of a CPU socket. */
function dimmBank(cpu: number, leftX: number, rightX: number, y: number, h: number, formFactor: string): SlotDef[] {
  const letters = 'ABCDEFGH';
  return range(8).map((i) => {
    const x = i < 4 ? leftX + i * 2.2 : rightX + (i - 4) * 2.2;
    return slot(`dimm${cpu}_${i}`, `CPU${cpu} DIMM ${letters[i]}1`, 'dimm', [formFactor], 'internal', { x, y, w: 1.6, h });
  });
}

const port = (def: PortDef): PortDef => def;

function consolePorts(bmcX: number, side: PortDef['side'] = 'rear'): PortDef[] {
  return [
    port({ id: 'bmc', label: 'BMC', osName: 'bmc', type: 'rj45', role: 'bmc', speedsGbps: [1, 0.1], side, panelX: bmcX }),
    port({ id: 'console', label: 'Serial console', type: 'serial_rj45', role: 'console', speedsGbps: [], side, panelX: bmcX + 4 }),
    port({ id: 'usb0', label: 'USB 3.0', type: 'usb_a', role: 'usb', speedsGbps: [], side, panelX: bmcX + 8 }),
  ];
}

export const EQUIPMENT_MODELS: Record<string, EquipmentModel> = {};
function add(m: EquipmentModel) {
  EQUIPMENT_MODELS[m.id] = m;
}

// ---------------------------------------------------------------------------
// 1U compute server
// ---------------------------------------------------------------------------
add({
  id: 'srv-1u-ref',
  kind: 'server',
  name: 'RS-1100 1U Compute Server',
  shortName: 'RS-1100',
  manufacturer: 'Generic reference',
  heightU: 1,
  weightKg: 18,
  rackTypes: ['standard'],
  cooling: 'air',
  baseW: 40,
  powerPath: 'psu',
  bootTimeMs: 20000,
  postMs: 7000,
  accuracy: 'reference',
  description: 'General-purpose dual-socket 1U server with 4 front U.2 NVMe bays, OCP 3.0 networking and redundant CRPS power supplies.',
  slots: [
    slot('mb', 'System board', 'motherboard', ['MB-REF'], 'internal', { x: 0, y: 0, w: 100, h: 100 }),
    ...range(4).map((i) =>
      slot(`nvme${i}`, `NVMe bay ${i}`, 'nvme', ['U.2'], 'front', { x: 3 + i * 11, y: 0, w: 10, h: 10 }, { panel: { side: 'front', x: 3 + i * 11, w: 10 } }),
    ),
    ...range(6).map((i) => slot(`fan${i}`, `Fan ${i + 1}`, 'fan', ['FAN-40'], 'internal', { x: 3 + i * 16, y: 14, w: 13, h: 7 })),
    slot('cpu0', 'CPU 0', 'cpu', ['SOCKET-SP-REF'], 'internal', { x: 14, y: 34, w: 16, h: 18 }),
    slot('cpu1', 'CPU 1', 'cpu', ['SOCKET-SP-REF'], 'internal', { x: 62, y: 34, w: 16, h: 18 }),
    ...dimmBank(0, 3, 32, 30, 26, 'DDR5-RDIMM'),
    ...dimmBank(1, 51, 80, 30, 26, 'DDR5-RDIMM'),
    slot('m2boot', 'M.2 boot drive', 'nvme', ['M.2-2280'], 'internal', { x: 43, y: 30, w: 11, h: 4 }, { tags: ['boot'] }),
    slot('bmc', 'DC-SCM / BMC', 'bmc', ['DC-SCM'], 'internal', { x: 43, y: 62, w: 11, h: 10 }),
    slot('riser0', 'PCIe riser 0', 'riser', ['RISER-REF'], 'internal', { x: 3, y: 64, w: 26, h: 7 }),
    slot('pcie0', 'PCIe slot 1 (riser 0)', 'nic', ['PCIE-LP', 'PCIE-HHHL'], 'internal', { x: 3, y: 73, w: 26, h: 8 }, { dependsOn: 'riser0', panel: { side: 'rear', x: 3, w: 12 } }),
    slot('ocp0', 'OCP 3.0 NIC slot', 'nic', ['OCP3.0'], 'rear', { x: 3, y: 88, w: 30, h: 11 }, { panel: { side: 'rear', x: 17, w: 20 } }),
    slot('psu1', 'PSU 1', 'psu', ['CRPS'], 'rear', { x: 66, y: 70, w: 15, h: 29 }, { panel: { side: 'rear', x: 66, w: 15 } }),
    slot('psu2', 'PSU 2', 'psu', ['CRPS'], 'rear', { x: 83, y: 70, w: 15, h: 29 }, { panel: { side: 'rear', x: 83, w: 15 } }),
  ],
  ports: consolePorts(42),
  defaults: {
    mb: 'mb-2s-ref',
    nvme0: 'nvme-u2-3t84',
    nvme1: 'nvme-u2-3t84',
    cpu0: 'cpu-x86-32c',
    cpu1: 'cpu-x86-32c',
    ...Object.fromEntries(range(6).map((i) => [`fan${i}`, 'fan-40-ref'])),
    ...Object.fromEntries(range(4).flatMap((i) => [[`dimm0_${i}`, 'dimm-ddr5-64g'], [`dimm1_${i}`, 'dimm-ddr5-64g']])),
    m2boot: 'nvme-m2-960g',
    bmc: 'bmc-dcscm-ref',
    riser0: 'riser-x16-ref',
    ocp0: 'nic-ocp-25g-2p',
    psu1: 'psu-crps-1200',
    psu2: 'psu-crps-1200',
  },
});

// ---------------------------------------------------------------------------
// 2U storage server
// ---------------------------------------------------------------------------
add({
  id: 'srv-2u-storage-ref',
  kind: 'server',
  name: 'SS-2200 2U Storage Server',
  shortName: 'SS-2200',
  manufacturer: 'Generic reference',
  heightU: 2,
  weightKg: 28,
  rackTypes: ['standard'],
  cooling: 'air',
  baseW: 60,
  powerPath: 'psu',
  bootTimeMs: 25000,
  postMs: 9000,
  accuracy: 'reference',
  description: 'Dual-socket 2U storage server with 12 hot-swap 2.5" SAS SSD bays behind a RAID controller.',
  slots: [
    slot('mb', 'System board', 'motherboard', ['MB-REF'], 'internal', { x: 0, y: 0, w: 100, h: 100 }),
    ...range(12).map((i) =>
      slot(`ssd${i}`, `Drive bay ${i}`, 'ssd', ['SFF-2.5-SAS'], 'front', { x: 2 + i * 6.6, y: 0, w: 6, h: 12 }, {
        dependsOn: 'raid0',
        panel: { side: 'front', x: 2 + i * 6.6, w: 6 },
      }),
    ),
    ...range(4).map((i) => slot(`fan${i}`, `Fan ${i + 1}`, 'fan', ['FAN-60'], 'internal', { x: 5 + i * 23, y: 16, w: 20, h: 8 })),
    slot('cpu0', 'CPU 0', 'cpu', ['SOCKET-SP-REF'], 'internal', { x: 14, y: 36, w: 16, h: 18 }),
    slot('cpu1', 'CPU 1', 'cpu', ['SOCKET-SP-REF'], 'internal', { x: 62, y: 36, w: 16, h: 18 }),
    ...dimmBank(0, 3, 32, 32, 26, 'DDR5-RDIMM'),
    ...dimmBank(1, 51, 80, 32, 26, 'DDR5-RDIMM'),
    slot('m2boot', 'M.2 boot drive', 'nvme', ['M.2-2280'], 'internal', { x: 43, y: 30, w: 11, h: 4 }, { tags: ['boot'] }),
    slot('bmc', 'DC-SCM / BMC', 'bmc', ['DC-SCM'], 'internal', { x: 43, y: 62, w: 11, h: 10 }),
    slot('riser0', 'PCIe riser 0', 'riser', ['RISER-REF'], 'internal', { x: 3, y: 64, w: 28, h: 7 }),
    slot('raid0', 'RAID controller (riser 0)', 'raid', ['PCIE-LP'], 'internal', { x: 3, y: 73, w: 28, h: 9 }, { dependsOn: 'riser0' }),
    slot('ocp0', 'OCP 3.0 NIC slot', 'nic', ['OCP3.0'], 'rear', { x: 34, y: 88, w: 26, h: 11 }, { panel: { side: 'rear', x: 36, w: 24 } }),
    slot('psu1', 'PSU 1', 'psu', ['CRPS'], 'rear', { x: 66, y: 70, w: 15, h: 29 }, { panel: { side: 'rear', x: 66, w: 15 } }),
    slot('psu2', 'PSU 2', 'psu', ['CRPS'], 'rear', { x: 83, y: 70, w: 15, h: 29 }, { panel: { side: 'rear', x: 83, w: 15 } }),
  ],
  ports: consolePorts(20),
  defaults: {
    mb: 'mb-2s-ref',
    ...Object.fromEntries(range(10).map((i) => [`ssd${i}`, 'ssd-sas-3t84'])),
    ...Object.fromEntries(range(4).map((i) => [`fan${i}`, 'fan-60-ref'])),
    cpu0: 'cpu-x86-32c',
    cpu1: 'cpu-x86-32c',
    ...Object.fromEntries(range(4).flatMap((i) => [[`dimm0_${i}`, 'dimm-ddr5-32g'], [`dimm1_${i}`, 'dimm-ddr5-32g']])),
    m2boot: 'nvme-m2-960g',
    bmc: 'bmc-dcscm-ref',
    riser0: 'riser-x16-ref',
    raid0: 'raid-16i-ref',
    ocp0: 'nic-ocp-25g-2p',
    psu1: 'psu-crps-1600',
    psu2: 'psu-crps-1600',
  },
});

// ---------------------------------------------------------------------------
// 4U 8-GPU server
// ---------------------------------------------------------------------------
add({
  id: 'srv-4u-gpu-ref',
  kind: 'server',
  name: 'GX-4800 4U 8-GPU Server',
  shortName: 'GX-4800',
  manufacturer: 'Generic reference',
  heightU: 4,
  weightKg: 75,
  rackTypes: ['standard'],
  cooling: 'air',
  baseW: 150,
  powerPath: 'psu',
  bootTimeMs: 30000,
  postMs: 12000,
  accuracy: 'reference',
  description: 'Air-cooled 8-GPU training server: SXM-style GPU baseboard behind two PCIe switch risers, four 400G fabric adapters and 3+1 redundant 3 kW PSUs.',
  slots: [
    slot('mb', 'System board', 'motherboard', ['MB-REF'], 'internal', { x: 0, y: 0, w: 100, h: 100 }),
    ...range(8).map((i) =>
      slot(`nvme${i}`, `NVMe bay ${i}`, 'nvme', ['U.2'], 'front', { x: 2 + i * 6, y: 0, w: 5.5, h: 8 }, { panel: { side: 'front', x: 14 + i * 4.7, w: 4.3 } }),
    ),
    ...range(10).map((i) =>
      slot(`fan${i}`, `Fan ${i + 1}`, 'fan', ['FAN-80'], 'front', { x: 1 + i * 9.9, y: 10, w: 9, h: 8 }, { panel: { side: 'front', x: 52 + i * 4.7, w: 4.3 } }),
    ),
    ...range(8).map((i) =>
      slot(
        `gpu${i}`,
        `GPU ${i}`,
        'gpu',
        ['SXM-REF'],
        'internal',
        { x: 4 + (i % 4) * 24, y: i < 4 ? 22 : 38, w: 20, h: 14 },
        { dependsOn: i < 4 ? 'riser0' : 'riser1' },
      ),
    ),
    slot('cpu0', 'CPU 0', 'cpu', ['SOCKET-SP-REF'], 'internal', { x: 14, y: 58, w: 14, h: 14 }),
    slot('cpu1', 'CPU 1', 'cpu', ['SOCKET-SP-REF'], 'internal', { x: 62, y: 58, w: 14, h: 14 }),
    ...dimmBank(0, 3, 30, 56, 18, 'DDR5-RDIMM'),
    ...dimmBank(1, 51, 78, 56, 18, 'DDR5-RDIMM'),
    slot('m2boot', 'M.2 boot drive', 'nvme', ['M.2-2280'], 'internal', { x: 41, y: 56, w: 10, h: 4 }, { tags: ['boot'] }),
    slot('bmc', 'DC-SCM / BMC', 'bmc', ['DC-SCM'], 'internal', { x: 41, y: 64, w: 10, h: 8 }),
    slot('riser0', 'PCIe switch riser 0', 'riser', ['RISER-REF'], 'internal', { x: 2, y: 78, w: 30, h: 7 }),
    slot('riser1', 'PCIe switch riser 1', 'riser', ['RISER-REF'], 'internal', { x: 34, y: 78, w: 30, h: 7 }),
    ...range(4).map((i) =>
      slot(`nic${i}`, `Fabric NIC ${i}`, 'nic', ['PCIE-HHHL'], 'rear', { x: 2 + i * 12, y: 87, w: 11, h: 12 }, {
        dependsOn: i < 2 ? 'riser0' : 'riser1',
        panel: { side: 'rear', x: 2 + i * 12, w: 11 },
      }),
    ),
    slot('ocp0', 'OCP 3.0 NIC slot', 'nic', ['OCP3.0'], 'rear', { x: 50, y: 87, w: 14, h: 12 }, { panel: { side: 'rear', x: 50, w: 14 } }),
    ...range(4).map((i) =>
      slot(`psu${i + 1}`, `PSU ${i + 1}`, 'psu', ['PSU-3K-REF'], 'rear', { x: 66 + i * 8.5, y: 76, w: 8, h: 23 }, { panel: { side: 'rear', x: 66 + i * 8.5, w: 8 } }),
    ),
  ],
  ports: consolePorts(2, 'front'),
  defaults: {
    mb: 'mb-2s-ref',
    ...Object.fromEntries(range(4).map((i) => [`nvme${i}`, 'nvme-u2-3t84'])),
    ...Object.fromEntries(range(10).map((i) => [`fan${i}`, 'fan-80-ref'])),
    ...Object.fromEntries(range(8).map((i) => [`gpu${i}`, 'gpu-sxm-ref-80g'])),
    cpu0: 'cpu-x86-64c',
    cpu1: 'cpu-x86-64c',
    ...Object.fromEntries(range(8).flatMap((i) => [[`dimm0_${i}`, 'dimm-ddr5-64g'], [`dimm1_${i}`, 'dimm-ddr5-64g']])),
    m2boot: 'nvme-m2-960g',
    bmc: 'bmc-dcscm-ref',
    riser0: 'riser-x16-ref',
    riser1: 'riser-x16-ref',
    ...Object.fromEntries(range(4).map((i) => [`nic${i}`, 'nic-cx7-400g'])),
    ocp0: 'nic-ocp-100g-2p',
    ...Object.fromEntries(range(4).map((i) => [`psu${i + 1}`, 'psu-3000-c20'])),
  },
});

// ---------------------------------------------------------------------------
// NVL72-style rack building blocks (MGX reference)
// ---------------------------------------------------------------------------
function computeTray(id: string, name: string, shortName: string, gpuModel: string, gpuFf: string, nicModel: string, note: string): EquipmentModel {
  const sc = (i: number) => (i < 2 ? 0 : 1);
  return {
    id,
    kind: 'compute_tray',
    name,
    shortName,
    manufacturer: 'Educational reference (NVL72-style)',
    heightU: 1,
    weightKg: 22,
    rackTypes: ['mgx'],
    cooling: 'liquid',
    baseW: 120,
    powerPath: 'busbar',
    bootTimeMs: 35000,
    postMs: 15000,
    accuracy: 'reference',
    note,
    source: 'NVIDIA GB200 / GB300 NVL72 product pages (top-level building blocks only)',
    description:
      'Liquid-cooled 1U compute tray holding two Grace–Blackwell superchips (2 Grace CPUs + 4 GPUs), four fabric NICs, one DPU and E1.S storage. Power arrives over the rack busbar; NVLink runs over the rack spine.',
    slots: [
      slot('mb', 'Tray system board', 'motherboard', ['MB-MGX-REF'], 'internal', { x: 0, y: 0, w: 100, h: 100 }),
      ...range(4).map((i) =>
        slot(`nic${i}`, `Fabric NIC ${i}`, 'nic', ['MGX-NIC-MEZZ'], 'front', { x: 2 + i * 9, y: 0, w: 8, h: 10 }, { panel: { side: 'front', x: 2 + i * 9, w: 8 } }),
      ),
      slot('dpu0', 'DPU', 'dpu', ['MGX-DPU-SLOT'], 'front', { x: 38, y: 0, w: 14, h: 10 }, { panel: { side: 'front', x: 38, w: 14 } }),
      ...range(4).map((i) =>
        slot(`nvme${i}`, `E1.S bay ${i}`, 'nvme', ['E1.S'], 'front', { x: 54 + i * 7, y: 0, w: 6, h: 10 }, { panel: { side: 'front', x: 54 + i * 7, w: 6 } }),
      ),
      ...range(4).map((i) => slot(`fan${i}`, `Fan ${i + 1}`, 'fan', ['FAN-40'], 'internal', { x: 4 + i * 12, y: 13, w: 10, h: 6 })),
      slot('m2boot', 'M.2 boot drive', 'nvme', ['M.2-2280'], 'internal', { x: 60, y: 14, w: 12, h: 4 }, { tags: ['boot'] }),
      slot('cpu0', 'Superchip 0 · Grace CPU', 'cpu', ['GRACE-BLACKWELL-SUPERCHIP', 'GRACE-BLACKWELL-ULTRA-SUPERCHIP'], 'internal', { x: 4, y: 34, w: 13, h: 26 }),
      slot('cpu1', 'Superchip 1 · Grace CPU', 'cpu', ['GRACE-BLACKWELL-SUPERCHIP', 'GRACE-BLACKWELL-ULTRA-SUPERCHIP'], 'internal', { x: 52, y: 34, w: 13, h: 26 }),
      ...range(4).map((i) =>
        slot(
          `gpu${i}`,
          `Superchip ${sc(i)} · GPU ${i}`,
          'gpu',
          [gpuFf],
          'internal',
          { x: (i < 2 ? 19 : 67) + (i % 2) * 14, y: 34, w: 12, h: 26 },
          { dependsOn: `cpu${sc(i)}` },
        ),
      ),
      slot('bmc', 'DC-SCM / BMC', 'bmc', ['DC-SCM'], 'internal', { x: 44, y: 70, w: 12, h: 10 }),
    ],
    ports: [
      port({ id: 'bmc', label: 'BMC', osName: 'bmc', type: 'rj45', role: 'bmc', speedsGbps: [1, 0.1], side: 'front', panelX: 84 }),
      port({ id: 'usb0', label: 'USB 3.0', type: 'usb_a', role: 'usb', speedsGbps: [], side: 'front', panelX: 89 }),
      port({ id: 'console', label: 'Serial console', type: 'serial_rj45', role: 'console', speedsGbps: [], side: 'front', panelX: 93 }),
    ],
    defaults: {
      mb: 'mb-mgx-ref',
      ...Object.fromEntries(range(4).map((i) => [`nic${i}`, nicModel])),
      dpu0: 'dpu-bf3-ref',
      ...Object.fromEntries(range(4).map((i) => [`nvme${i}`, 'nvme-e1s-3t84'])),
      ...Object.fromEntries(range(4).map((i) => [`fan${i}`, 'fan-40-ref'])),
      m2boot: 'nvme-m2-960g',
      cpu0: 'cpu-grace',
      cpu1: 'cpu-grace',
      ...Object.fromEntries(range(4).map((i) => [`gpu${i}`, gpuModel])),
      bmc: 'bmc-dcscm-ref',
    },
  };
}

add(
  computeTray(
    'ct-gb200-ref',
    'GB200 Compute Tray (NVL72-style reference)',
    'GB200 tray',
    'gpu-blackwell-gb200',
    'GRACE-BLACKWELL-SUPERCHIP',
    'nic-cx7-400g-tray',
    'An NVL72 rack holds 18 compute trays, each with 2 GB200 superchips (36 Grace CPUs, 72 Blackwell GPUs in total), which is published. The internal tray layout is an educational reference.',
  ),
);
add(
  computeTray(
    'ct-gb300-ref',
    'GB300 Compute Tray (NVL72-style reference)',
    'GB300 tray',
    'gpu-blackwell-ultra-gb300',
    'GRACE-BLACKWELL-ULTRA-SUPERCHIP',
    'nic-cx8-800g-tray',
    'GB300 NVL72 keeps the 72-GPU / 36-CPU rack-scale design with Blackwell Ultra GPUs and ConnectX-8 SuperNICs, which is published. The internal tray layout is an educational reference.',
  ),
);

add({
  id: 'nvs-tray-ref',
  kind: 'nvlink_switch_tray',
  name: 'NVLink Switch Tray (NVL72-style reference)',
  shortName: 'NVLink switch tray',
  manufacturer: 'Educational reference (NVL72-style)',
  heightU: 1,
  weightKg: 18,
  rackTypes: ['mgx'],
  cooling: 'liquid',
  baseW: 80,
  powerPath: 'busbar',
  bootTimeMs: 15000,
  postMs: 6000,
  accuracy: 'reference',
  note: 'Nine switch trays with two NVLink Switch chips each connect all 72 GPUs over the copper NVLink spine (published). Internal layout is a teaching reference.',
  source: 'NVIDIA GB200 NVL72 product page',
  description: 'Liquid-cooled 1U tray with two NVLink Switch chips. Each tray provides 2 of the 18 NVLink links of every GPU in the rack (simplified mapping).',
  slots: [
    slot('mb', 'Tray system board', 'motherboard', ['MB-MGX-REF'], 'internal', { x: 0, y: 0, w: 100, h: 100 }),
    slot('nvsw0', 'NVLink Switch chip 0', 'nvswitch', ['NVSWITCH-ONBOARD'], 'internal', { x: 14, y: 30, w: 26, h: 30 }),
    slot('nvsw1', 'NVLink Switch chip 1', 'nvswitch', ['NVSWITCH-ONBOARD'], 'internal', { x: 60, y: 30, w: 26, h: 30 }),
    ...range(2).map((i) => slot(`fan${i}`, `Fan ${i + 1}`, 'fan', ['FAN-40'], 'internal', { x: 30 + i * 28, y: 12, w: 12, h: 6 })),
    slot('bmc', 'DC-SCM / BMC', 'bmc', ['DC-SCM'], 'internal', { x: 44, y: 70, w: 12, h: 10 }),
  ],
  ports: [
    port({ id: 'bmc', label: 'BMC', osName: 'bmc', type: 'rj45', role: 'bmc', speedsGbps: [1, 0.1], side: 'front', panelX: 84 }),
    port({ id: 'usb0', label: 'USB 3.0', type: 'usb_a', role: 'usb', speedsGbps: [], side: 'front', panelX: 89 }),
    port({ id: 'console', label: 'Serial console', type: 'serial_rj45', role: 'console', speedsGbps: [], side: 'front', panelX: 93 }),
  ],
  defaults: {
    mb: 'mb-mgx-ref',
    nvsw0: 'nvswitch-ref',
    nvsw1: 'nvswitch-ref',
    fan0: 'fan-40-ref',
    fan1: 'fan-40-ref',
    bmc: 'bmc-dcscm-ref',
  },
});

add({
  id: 'pshelf-ref',
  kind: 'power_shelf',
  name: '1U Power Shelf, 6 × 5.5 kW (MGX-style reference)',
  shortName: 'Power shelf',
  manufacturer: 'Educational reference',
  heightU: 1,
  weightKg: 20,
  rackTypes: ['mgx'],
  cooling: 'air',
  baseW: 20,
  powerPath: 'feed',
  bootTimeMs: 0,
  postMs: 0,
  accuracy: 'simplified',
  description: 'Hard-wired power shelf that converts facility AC to the rack DC busbar. PSUs are hot-swappable from the front.',
  slots: range(6).map((i) =>
    slot(`psu${i}`, `Shelf PSU ${i + 1}`, 'psu', ['SHELF-PSU-REF'], 'front', { x: 2 + i * 16.2, y: 0, w: 15, h: 70 }, { panel: { side: 'front', x: 2 + i * 16.2, w: 15 } }),
  ),
  ports: [],
  defaults: Object.fromEntries(range(6).map((i) => [`psu${i}`, 'psu-shelf-5500'])),
});

// ---------------------------------------------------------------------------
// Network switches (port side faces the rack rear, where server NICs are)
// ---------------------------------------------------------------------------
function switchModel(opts: {
  id: string;
  name: string;
  shortName: string;
  heightU: number;
  ports: PortDef[];
  psuModel: string;
  fans: number;
  baseW: number;
  weightKg: number;
  description: string;
  note?: string;
}): EquipmentModel {
  return {
    id: opts.id,
    kind: 'switch',
    name: opts.name,
    shortName: opts.shortName,
    manufacturer: 'Generic reference',
    heightU: opts.heightU,
    weightKg: opts.weightKg,
    rackTypes: ['standard', 'mgx'],
    cooling: 'air',
    baseW: opts.baseW,
    powerPath: 'psu',
    bootTimeMs: 15000,
    postMs: 5000,
    accuracy: 'reference',
    note: opts.note,
    description: opts.description,
    slots: [
      slot('asic', 'Switch ASIC', 'asic', ['ASIC-ONBOARD'], 'internal', { x: 30, y: 25, w: 40, h: 40 }),
      ...range(opts.fans).map((i) =>
        slot(`fan${i}`, `Fan ${i + 1}`, 'fan', ['FAN-40'], 'front', { x: 2 + i * (60 / opts.fans), y: 85, w: 60 / opts.fans - 1, h: 14 }, {
          panel: { side: 'front', x: 2 + i * (60 / opts.fans), w: 60 / opts.fans - 1 },
        }),
      ),
      slot('psu1', 'PSU 1', 'psu', ['CRPS'], 'front', { x: 68, y: 75, w: 14, h: 24 }, { panel: { side: 'front', x: 68, w: 14 } }),
      slot('psu2', 'PSU 2', 'psu', ['CRPS'], 'front', { x: 84, y: 75, w: 14, h: 24 }, { panel: { side: 'front', x: 84, w: 14 } }),
    ],
    ports: opts.ports,
    defaults: {
      asic: 'asic-switch-ref',
      ...Object.fromEntries(range(opts.fans).map((i) => [`fan${i}`, 'fan-40-ref'])),
      psu1: opts.psuModel,
      psu2: opts.psuModel,
    },
  };
}

function swPorts(prefix: string, count: number, type: PortDef['type'], speeds: number[], role: PortDef['role'], x0: number, pitch: number, rows: number, start = 1): PortDef[] {
  return range(count).map((i) =>
    port({
      id: `${prefix}${start + i}`,
      label: `${prefix}${start + i}`,
      osName: `${prefix}${start + i}`,
      type,
      role,
      speedsGbps: speeds,
      side: 'rear',
      panelX: x0 + Math.floor(i / rows) * pitch,
      panelRow: i % rows,
    }),
  );
}

const swMgmt = (x: number): PortDef[] => [
  port({ id: 'mgmt0', label: 'OOB mgmt', osName: 'eth0', type: 'rj45', role: 'bmc', speedsGbps: [1, 0.1], side: 'rear', panelX: x }),
  port({ id: 'console', label: 'Console', type: 'serial_rj45', role: 'console', speedsGbps: [], side: 'rear', panelX: x + 4 }),
];

add(
  switchModel({
    id: 'sw-tor-25g-ref',
    name: 'TS-4856 ToR Switch, 48 × 25G SFP28 + 8 × 100G QSFP28',
    shortName: 'TS-4856',
    heightU: 1,
    ports: [...swPorts('swp', 48, 'sfp28', [25, 10], 'data', 2, 2.7, 2), ...swPorts('swp', 8, 'qsfp28', [100, 40], 'uplink', 69, 5, 2, 49), ...swMgmt(91)],
    psuModel: 'psu-crps-650',
    fans: 4,
    baseW: 60,
    weightKg: 9,
    description: 'Top-of-rack data switch. Server-facing SFP28 ports also accept SFP+ optics/DACs at 10G.',
  }),
);
add(
  switchModel({
    id: 'sw-mgmt-1g-ref',
    name: 'MS-1048 Management Switch, 48 × 1G RJ45 + 4 × 10G SFP+',
    shortName: 'MS-1048',
    heightU: 1,
    ports: [...swPorts('ge', 48, 'rj45', [1, 0.1], 'mgmt', 2, 2.7, 2), ...swPorts('xe', 4, 'sfp_plus', [10, 1], 'uplink', 69, 5, 2), ...swMgmt(91)],
    psuModel: 'psu-crps-650',
    fans: 2,
    baseW: 40,
    weightKg: 6,
    description: 'Out-of-band management switch for BMC and switch management ports.',
  }),
);
add(
  switchModel({
    id: 'sw-spine-400g-ref',
    name: 'SP-3200 Spine / Front-end Switch, 32 × 400G QSFP-DD',
    shortName: 'SP-3200',
    heightU: 1,
    ports: [...swPorts('swp', 32, 'qsfp_dd', [400, 200, 100], 'uplink', 2, 5.4, 2), ...swMgmt(91)],
    psuModel: 'psu-crps-1200',
    fans: 4,
    baseW: 120,
    weightKg: 12,
    description: 'Ethernet spine / front-end switch. QSFP-DD cages are backward compatible with QSFP28/QSFP112 modules.',
  }),
);
add(
  switchModel({
    id: 'sw-ib-ndr-ref',
    name: 'IBX-6400 InfiniBand Switch, 64 × 400G (NDR-class reference)',
    shortName: 'IBX-6400',
    heightU: 2,
    ports: [...swPorts('ib', 64, 'osfp', [400, 200], 'fabric', 2, 2.75, 2), ...swMgmt(91)],
    psuModel: 'psu-crps-2000',
    fans: 6,
    baseW: 200,
    weightKg: 16,
    description: 'Compute-fabric switch for GPU east–west traffic.',
    note: 'Simplified: each twin-port OSFP cage is modelled as two independent logical 400G ports.',
  }),
);

// ---------------------------------------------------------------------------
// Power distribution, blanks, cooling
// ---------------------------------------------------------------------------
add({
  id: 'pdu-0u-ref',
  kind: 'pdu',
  name: 'Vertical 0U PDU, 3-phase 22 kW, 24 × C13 + 6 × C19',
  shortName: '0U PDU',
  manufacturer: 'Generic reference',
  heightU: 0,
  weightKg: 9,
  rackTypes: ['standard', 'mgx'],
  cooling: 'air',
  baseW: 10,
  powerPath: 'feed',
  bootTimeMs: 0,
  postMs: 0,
  accuracy: 'industry',
  note: '3-phase 400 V / 32 A ≈ 22 kVA (√3 × 400 × 32). Outlet mix is a common configuration.',
  pdu: { ratingW: 22000 },
  description: 'Rack-mounted vertical PDU fed from one facility feed. Pair an A-side and a B-side PDU for redundant power.',
  slots: [],
  ports: [
    ...range(24).map((i) => port({ id: `o${i + 1}`, label: `Outlet ${i + 1} (C13)`, type: 'pdu_c13', role: 'power_out', speedsGbps: [], side: 'rear', panelX: 4 + i * 3 })),
    ...range(6).map((i) => port({ id: `o${25 + i}`, label: `Outlet ${25 + i} (C19)`, type: 'pdu_c19', role: 'power_out', speedsGbps: [], side: 'rear', panelX: 78 + i * 3.6 })),
  ],
  defaults: {},
});

for (const h of [1, 2]) {
  add({
    id: `blank-${h}u`,
    kind: 'blank',
    name: `${h}U Blanking Panel`,
    shortName: `${h}U blank`,
    manufacturer: 'Generic',
    heightU: h,
    weightKg: 0.3 * h,
    rackTypes: ['standard', 'mgx'],
    cooling: 'air',
    baseW: 0,
    powerPath: 'none',
    bootTimeMs: 0,
    postMs: 0,
    accuracy: 'industry',
    description: 'Blocks unused rack space so hot exhaust air cannot recirculate to the cold aisle.',
    slots: [],
    ports: [],
    defaults: {},
  });
}

add({
  id: 'cdu-inrow-ref',
  kind: 'cdu',
  name: 'In-row Coolant Distribution Unit (reference)',
  shortName: 'CDU',
  manufacturer: 'Educational reference',
  heightU: 0,
  weightKg: 600,
  rackTypes: [],
  cooling: 'liquid',
  baseW: 300,
  powerPath: 'feed',
  bootTimeMs: 0,
  postMs: 0,
  accuracy: 'simplified',
  cdu: { nominalFlowLpmPerRack: 160, supplySetpointC: 30 },
  description: 'Liquid-to-liquid CDU that supplies treated coolant to the rack manifolds and rejects heat to facility water. Two N+1 pumps.',
  slots: [
    slot('pump0', 'Pump A', 'pump', ['CDU-PUMP-REF'], 'front', { x: 10, y: 20, w: 35, h: 40 }, { panel: { side: 'front', x: 10, w: 35 } }),
    slot('pump1', 'Pump B', 'pump', ['CDU-PUMP-REF'], 'front', { x: 55, y: 20, w: 35, h: 40 }, { panel: { side: 'front', x: 55, w: 35 } }),
  ],
  ports: [],
  defaults: { pump0: 'pump-cdu-ref', pump1: 'pump-cdu-ref' },
});

export function getEquipmentModel(id: string): EquipmentModel {
  const m = EQUIPMENT_MODELS[id];
  if (!m) throw new Error(`Unknown equipment model: ${id}`);
  return m;
}

const slotIndex = new Map<string, Map<string, SlotDef>>();

/** O(1) slot lookup (cached per model). */
export function getSlotDef(modelId: string, slotId: string): SlotDef | undefined {
  let idx = slotIndex.get(modelId);
  if (!idx) {
    idx = new Map(getEquipmentModel(modelId).slots.map((s) => [s.id, s]));
    slotIndex.set(modelId, idx);
  }
  return idx.get(slotId);
}
