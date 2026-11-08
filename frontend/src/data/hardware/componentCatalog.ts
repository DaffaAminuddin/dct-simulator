/**
 * Component model catalog.
 *
 * Accuracy policy: models tagged `reference` are generic educational designs.
 * NVIDIA product names appear only where the cited top-level facts are widely
 * published (core counts, memory capacity, link generation). Power figures,
 * thermal resistances and thresholds are simulation values (see
 * docs/ASSUMPTIONS.md) and are NOT vendor specifications.
 */
import type { ComponentModel, PortDef } from '@/types/catalog';

const airLimits = (warnC: number, criticalC: number, throttleC?: number) => ({ warnC, criticalC, throttleC });

function nicPorts(count: number, type: PortDef['type'], speeds: number[], side: PortDef['side'], osPrefix: string): PortDef[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    label: `P${i + 1}`,
    osName: `${osPrefix}${i}`,
    type,
    role: type === 'osfp' ? 'fabric' : 'data',
    speedsGbps: speeds,
    side,
  }));
}

const psuInlet = (type: 'psu_c14' | 'psu_c20'): PortDef[] => [
  { id: 'ac', label: 'AC IN', type, role: 'power_in', speedsGbps: [], side: 'rear' },
];

export const COMPONENT_MODELS: Record<string, ComponentModel> = {};

function add(model: ComponentModel) {
  COMPONENT_MODELS[model.id] = model;
}

// --- CPUs -------------------------------------------------------------------
add({
  id: 'cpu-x86-32c',
  category: 'cpu',
  name: 'x86 Server CPU, 32-core (reference)',
  manufacturer: 'Generic',
  formFactor: 'SOCKET-SP-REF',
  idleW: 60,
  maxW: 250,
  thermalResistance: 0.15,
  thermal: airLimits(85, 100, 95),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  specs: { cores: 32, threads: 64, baseClockGHz: 2.4 },
  accuracy: 'reference',
});
add({
  id: 'cpu-x86-64c',
  category: 'cpu',
  name: 'x86 Server CPU, 64-core (reference)',
  manufacturer: 'Generic',
  formFactor: 'SOCKET-SP-REF',
  idleW: 80,
  maxW: 350,
  thermalResistance: 0.12,
  thermal: airLimits(85, 100, 95),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  specs: { cores: 64, threads: 128, baseClockGHz: 2.2 },
  accuracy: 'reference',
});
add({
  id: 'cpu-grace',
  category: 'cpu',
  name: 'NVIDIA Grace CPU',
  manufacturer: 'NVIDIA',
  formFactor: 'GRACE-BLACKWELL-SUPERCHIP',
  idleW: 80,
  maxW: 300,
  thermalResistance: 0.05,
  thermal: airLimits(85, 100, 95),
  cooling: 'liquid',
  hotSwap: false,
  fieldReplaceable: false,
  specs: { cores: 72, coreType: 'Arm Neoverse V2', memory: 'LPDDR5X (on-module)', hostLink: 'NVLink-C2C' },
  accuracy: 'verified',
  note: 'Core count and NVLink-C2C attach are published; power and thermal values are simulation values. Part of the superchip module, so it is not field-replaceable on its own in this simulator.',
  source: 'NVIDIA Grace CPU / GB200 NVL72 product pages',
});

// --- Memory -----------------------------------------------------------------
add({
  id: 'dimm-ddr5-64g',
  category: 'dimm',
  name: '64 GB DDR5-4800 RDIMM',
  manufacturer: 'Generic',
  formFactor: 'DDR5-RDIMM',
  idleW: 3,
  maxW: 8,
  thermalResistance: 3,
  thermal: airLimits(85, 95),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  specs: { capacityGB: 64, type: 'DDR5', speedMTs: 4800, ecc: 'yes' },
  accuracy: 'industry',
});
add({
  id: 'dimm-ddr5-32g',
  category: 'dimm',
  name: '32 GB DDR5-4800 RDIMM',
  manufacturer: 'Generic',
  formFactor: 'DDR5-RDIMM',
  idleW: 2.5,
  maxW: 6,
  thermalResistance: 3,
  thermal: airLimits(85, 95),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  specs: { capacityGB: 32, type: 'DDR5', speedMTs: 4800, ecc: 'yes' },
  accuracy: 'industry',
});
add({
  id: 'dimm-ddr4-32g',
  category: 'dimm',
  name: '32 GB DDR4-3200 RDIMM',
  manufacturer: 'Generic',
  formFactor: 'DDR4-RDIMM',
  idleW: 2.5,
  maxW: 5,
  thermalResistance: 3,
  thermal: airLimits(85, 95),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  specs: { capacityGB: 32, type: 'DDR4', speedMTs: 3200, ecc: 'yes' },
  accuracy: 'industry',
  note: 'DDR4 and DDR5 DIMMs are keyed differently and cannot be installed in each other’s slots.',
});

// --- GPUs -------------------------------------------------------------------
add({
  id: 'gpu-sxm-ref-80g',
  category: 'gpu',
  name: 'SXM-style GPU module, 80 GB HBM (reference)',
  manufacturer: 'Generic',
  formFactor: 'SXM-REF',
  idleW: 70,
  maxW: 700,
  thermalResistance: 0.07,
  thermal: airLimits(85, 95, 90),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  specs: { memoryGB: 80, memoryType: 'HBM3', maxClockMHz: 1980, hostLink: 'PCIe Gen5 x16', nvlinks: 18 },
  accuracy: 'reference',
  note: 'Generic 8-GPU-baseboard module for teaching. It does not represent a specific product.',
});
add({
  id: 'gpu-blackwell-gb200',
  category: 'gpu',
  name: 'NVIDIA Blackwell GPU (GB200 superchip)',
  manufacturer: 'NVIDIA',
  formFactor: 'GRACE-BLACKWELL-SUPERCHIP',
  idleW: 150,
  maxW: 1200,
  thermalResistance: 0.03,
  thermal: airLimits(85, 95, 90),
  cooling: 'liquid',
  hotSwap: false,
  fieldReplaceable: false,
  specs: { memoryGB: 186, memoryType: 'HBM3e', maxClockMHz: 2100, hostLink: 'NVLink-C2C', nvlinks: 18, nvlinkGen: 5 },
  accuracy: 'verified',
  note: 'HBM3e capacity is derived from the published GB200 NVL72 total (13.4 TB across 72 GPUs). NVLink 5 with 18 links per GPU is published. Power, clock and thresholds are simulation values. In this simulator the GPU is serviced by replacing the compute tray.',
  source: 'NVIDIA GB200 NVL72 product page',
});
add({
  id: 'gpu-blackwell-ultra-gb300',
  category: 'gpu',
  name: 'NVIDIA Blackwell Ultra GPU (GB300 superchip)',
  manufacturer: 'NVIDIA',
  formFactor: 'GRACE-BLACKWELL-ULTRA-SUPERCHIP',
  idleW: 160,
  maxW: 1400,
  thermalResistance: 0.028,
  thermal: airLimits(85, 95, 90),
  cooling: 'liquid',
  hotSwap: false,
  fieldReplaceable: false,
  specs: { memoryGB: 288, memoryType: 'HBM3e', maxClockMHz: 2100, hostLink: 'NVLink-C2C', nvlinks: 18, nvlinkGen: 5 },
  accuracy: 'verified',
  note: 'Up to 288 GB HBM3e per GPU is published for Blackwell Ultra. Power, clock and thresholds are simulation values.',
  source: 'NVIDIA GB300 NVL72 product page',
});

// --- Storage ----------------------------------------------------------------
add({
  id: 'nvme-u2-3t84',
  category: 'nvme',
  name: '3.84 TB NVMe SSD, U.2',
  manufacturer: 'Generic',
  formFactor: 'U.2',
  idleW: 5,
  maxW: 14,
  thermalResistance: 2,
  thermal: airLimits(70, 80),
  cooling: 'air',
  hotSwap: true,
  fieldReplaceable: true,
  specs: { capacityTB: 3.84, interface: 'PCIe Gen4 x4 NVMe' },
  accuracy: 'industry',
});
add({
  id: 'nvme-e1s-3t84',
  category: 'nvme',
  name: '3.84 TB NVMe SSD, E1.S',
  manufacturer: 'Generic',
  formFactor: 'E1.S',
  idleW: 5,
  maxW: 15,
  thermalResistance: 2,
  thermal: airLimits(70, 80),
  cooling: 'air',
  hotSwap: true,
  fieldReplaceable: true,
  specs: { capacityTB: 3.84, interface: 'PCIe Gen5 x4 NVMe' },
  accuracy: 'industry',
});
add({
  id: 'nvme-m2-960g',
  category: 'nvme',
  name: '960 GB NVMe boot SSD, M.2 2280',
  manufacturer: 'Generic',
  formFactor: 'M.2-2280',
  idleW: 2,
  maxW: 6,
  thermalResistance: 4,
  thermal: airLimits(70, 80),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  specs: { capacityGB: 960, interface: 'PCIe Gen4 x4 NVMe', role: 'OS boot' },
  accuracy: 'industry',
});
add({
  id: 'ssd-sas-3t84',
  category: 'ssd',
  name: '3.84 TB SAS SSD, 2.5"',
  manufacturer: 'Generic',
  formFactor: 'SFF-2.5-SAS',
  idleW: 3,
  maxW: 9,
  thermalResistance: 2.5,
  thermal: airLimits(70, 80),
  cooling: 'air',
  hotSwap: true,
  fieldReplaceable: true,
  specs: { capacityTB: 3.84, interface: 'SAS-4 24G' },
  accuracy: 'industry',
});
add({
  id: 'raid-16i-ref',
  category: 'raid',
  name: '16-port SAS RAID controller (reference)',
  manufacturer: 'Generic',
  formFactor: 'PCIE-LP',
  idleW: 8,
  maxW: 16,
  thermalResistance: 2.5,
  thermal: airLimits(95, 105),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  specs: { ports: '16 internal SAS lanes', cache: '8 GB' },
  accuracy: 'reference',
});

// --- NICs / DPU -----------------------------------------------------------
add({
  id: 'nic-ocp-25g-2p',
  category: 'nic',
  name: 'OCP 3.0 NIC, 2 × 25GbE SFP28 (reference)',
  manufacturer: 'Generic',
  formFactor: 'OCP3.0',
  idleW: 8,
  maxW: 15,
  thermalResistance: 2.5,
  thermal: airLimits(95, 105),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  ports: nicPorts(2, 'sfp28', [25, 10], 'rear', 'ens1f'),
  specs: { ports: 2, speed: '25 GbE' },
  accuracy: 'reference',
});
add({
  id: 'nic-ocp-100g-2p',
  category: 'nic',
  name: 'OCP 3.0 NIC, 2 × 100GbE QSFP28 (reference)',
  manufacturer: 'Generic',
  formFactor: 'OCP3.0',
  idleW: 12,
  maxW: 22,
  thermalResistance: 2,
  thermal: airLimits(95, 105),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  ports: nicPorts(2, 'qsfp28', [100, 40], 'rear', 'ens2f'),
  specs: { ports: 2, speed: '100 GbE' },
  accuracy: 'reference',
});
add({
  id: 'nic-cx7-400g',
  category: 'nic',
  name: 'ConnectX-7-class 400G adapter, 1 × OSFP (reference)',
  manufacturer: 'NVIDIA (reference)',
  formFactor: 'PCIE-HHHL',
  idleW: 12,
  maxW: 25,
  thermalResistance: 1.8,
  thermal: airLimits(95, 105),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  ports: nicPorts(1, 'osfp', [400, 200], 'rear', 'ibp'),
  specs: { ports: 1, speed: '400 Gb/s InfiniBand / Ethernet', hostInterface: 'PCIe Gen5' },
  accuracy: 'reference',
  note: 'ConnectX-7 supports up to 400 Gb/s (published). Port layout and power here are simplified.',
  source: 'NVIDIA ConnectX-7 product brief',
});
add({
  id: 'nic-cx7-400g-tray',
  category: 'nic',
  name: 'ConnectX-7-class 400G mezzanine, 1 × OSFP (reference)',
  manufacturer: 'NVIDIA (reference)',
  formFactor: 'MGX-NIC-MEZZ',
  idleW: 12,
  maxW: 25,
  thermalResistance: 1.8,
  thermal: airLimits(95, 105),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  ports: nicPorts(1, 'osfp', [400, 200], 'front', 'ibp'),
  specs: { ports: 1, speed: '400 Gb/s', hostInterface: 'PCIe Gen5' },
  accuracy: 'reference',
  note: 'GB200 NVL72 compute trays carry ConnectX-7 adapters for the compute fabric (published). Mezzanine form factor is a teaching simplification.',
  source: 'NVIDIA GB200 NVL72 product page',
});
add({
  id: 'nic-cx8-800g-tray',
  category: 'nic',
  name: 'ConnectX-8-class SuperNIC 800G, 1 × OSFP (reference)',
  manufacturer: 'NVIDIA (reference)',
  formFactor: 'MGX-NIC-MEZZ',
  idleW: 15,
  maxW: 35,
  thermalResistance: 1.6,
  thermal: airLimits(95, 105),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  ports: nicPorts(1, 'osfp', [800, 400, 200], 'front', 'ibp'),
  specs: { ports: 1, speed: '800 Gb/s', hostInterface: 'PCIe Gen6' },
  accuracy: 'reference',
  note: 'GB300 NVL72 uses ConnectX-8 SuperNICs at up to 800 Gb/s (published). Layout and power are simplified.',
  source: 'NVIDIA GB300 NVL72 product page',
});
add({
  id: 'dpu-bf3-ref',
  category: 'dpu',
  name: 'BlueField-3-class DPU, 2 × QSFP112 (reference)',
  manufacturer: 'NVIDIA (reference)',
  formFactor: 'MGX-DPU-SLOT',
  idleW: 30,
  maxW: 75,
  thermalResistance: 0.7,
  thermal: airLimits(95, 105),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  ports: nicPorts(2, 'qsfp112', [400, 200, 100], 'front', 'enP'),
  specs: { ports: 2, role: 'Front-end / storage network, infrastructure offload' },
  accuracy: 'reference',
});

// --- PCIe ----------------------------------------------------------------
add({
  id: 'riser-x16-ref',
  category: 'riser',
  name: 'PCIe Gen5 riser with PCIe switch (reference)',
  manufacturer: 'Generic',
  formFactor: 'RISER-REF',
  idleW: 8,
  maxW: 20,
  thermalResistance: 2,
  thermal: airLimits(95, 105),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  specs: { lanes: 'x16 upstream, 4 × x16 downstream' },
  accuracy: 'reference',
});

// --- Power ---------------------------------------------------------------
function psu(id: string, name: string, ratingW: number, formFactor: string, inlet: 'psu_c14' | 'psu_c20', accuracy: ComponentModel['accuracy'] = 'industry'): ComponentModel {
  return {
    id,
    category: 'psu',
    name,
    manufacturer: 'Generic',
    formFactor,
    idleW: 8,
    maxW: Math.round(ratingW * 0.06),
    thermalResistance: 0.3,
    thermal: airLimits(70, 85),
    cooling: 'air',
    hotSwap: true,
    fieldReplaceable: true,
    ratingW,
    ports: psuInlet(inlet),
    specs: { ratingW, efficiency: '94% (Titanium-class, simplified)', inlet: inlet === 'psu_c14' ? 'IEC C14' : 'IEC C20' },
    accuracy,
  };
}
add(psu('psu-crps-650', '650 W CRPS PSU', 650, 'CRPS', 'psu_c14'));
add(psu('psu-crps-1200', '1200 W CRPS PSU', 1200, 'CRPS', 'psu_c14'));
add(psu('psu-crps-1600', '1600 W CRPS PSU', 1600, 'CRPS', 'psu_c14'));
add(psu('psu-crps-2000', '2000 W CRPS PSU', 2000, 'CRPS', 'psu_c14'));
add(psu('psu-3000-c20', '3000 W high-output PSU (C20)', 3000, 'PSU-3K-REF', 'psu_c20', 'reference'));
add({
  ...psu('psu-shelf-5500', '5.5 kW power-shelf PSU (reference)', 5500, 'SHELF-PSU-REF', 'psu_c20', 'reference'),
  ports: [],
  specs: { ratingW: 5500, input: 'Hard-wired shelf input (simplified)', output: '48–54 V DC busbar' },
});

// --- Cooling -------------------------------------------------------------
function fan(id: string, name: string, formFactor: string, maxRpm: number): ComponentModel {
  return {
    id,
    category: 'fan',
    name,
    manufacturer: 'Generic',
    formFactor,
    idleW: 2,
    maxW: 18,
    thermalResistance: 1,
    thermal: airLimits(70, 90),
    cooling: 'air',
    hotSwap: true,
    fieldReplaceable: true,
    maxRpm,
    specs: { maxRpm, type: 'Dual-rotor, hot-swap' },
    accuracy: 'industry',
  };
}
add(fan('fan-40-ref', '40 mm dual-rotor fan module', 'FAN-40', 28000));
add(fan('fan-60-ref', '60 mm fan module', 'FAN-60', 18000));
add(fan('fan-80-ref', '80 mm fan module', 'FAN-80', 12500));
add({
  id: 'pump-cdu-ref',
  category: 'pump',
  name: 'CDU circulation pump (reference)',
  manufacturer: 'Generic',
  formFactor: 'CDU-PUMP-REF',
  idleW: 150,
  maxW: 400,
  thermalResistance: 0.05,
  thermal: airLimits(70, 90),
  cooling: 'air',
  hotSwap: true,
  fieldReplaceable: true,
  specs: { redundancy: 'N+1 (one pump carries nominal flow)', type: 'Variable-speed centrifugal' },
  accuracy: 'simplified',
});

// --- Boards / management ----------------------------------------------------
add({
  id: 'mb-2s-ref',
  category: 'motherboard',
  name: 'Dual-socket system board (reference)',
  manufacturer: 'Generic',
  formFactor: 'MB-REF',
  idleW: 25,
  maxW: 45,
  thermalResistance: 0.4,
  thermal: airLimits(80, 100),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: false,
  specs: { note: 'Motherboard replacement is a depot-level procedure in this simulator' },
  accuracy: 'reference',
});
add({
  id: 'mb-mgx-ref',
  category: 'motherboard',
  name: 'MGX tray system board (reference)',
  manufacturer: 'Generic',
  formFactor: 'MB-MGX-REF',
  idleW: 30,
  maxW: 60,
  thermalResistance: 0.3,
  thermal: airLimits(80, 100),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: false,
  specs: { note: 'Tray-level board; replace the tray' },
  accuracy: 'reference',
});
add({
  id: 'bmc-dcscm-ref',
  category: 'bmc',
  name: 'DC-SCM management module with BMC (reference)',
  manufacturer: 'Generic',
  formFactor: 'DC-SCM',
  idleW: 3,
  maxW: 5,
  thermalResistance: 3,
  thermal: airLimits(85, 100),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: true,
  specs: { interfaces: 'Redfish, IPMI 2.0', standard: 'OCP DC-SCM (industry standard form factor)' },
  accuracy: 'industry',
});
add({
  id: 'nvswitch-ref',
  category: 'nvswitch',
  name: 'NVLink Switch chip (5th-gen NVLink)',
  manufacturer: 'NVIDIA',
  formFactor: 'NVSWITCH-ONBOARD',
  idleW: 50,
  maxW: 200,
  thermalResistance: 0.08,
  thermal: airLimits(85, 100, 95),
  cooling: 'liquid',
  hotSwap: false,
  fieldReplaceable: false,
  specs: { nvlinkGen: 5, perTray: 2 },
  accuracy: 'verified',
  note: 'An NVL72 rack has 9 NVLink switch trays with 2 NVLink Switch chips each (published). Power values are simulation values.',
  source: 'NVIDIA GB200 NVL72 product page',
});
add({
  id: 'asic-switch-ref',
  category: 'asic',
  name: 'Ethernet/InfiniBand switch ASIC (reference)',
  manufacturer: 'Generic',
  formFactor: 'ASIC-ONBOARD',
  idleW: 100,
  maxW: 350,
  thermalResistance: 0.12,
  thermal: airLimits(95, 110),
  cooling: 'air',
  hotSwap: false,
  fieldReplaceable: false,
  specs: {},
  accuracy: 'reference',
});

export function getComponentModel(id: string): ComponentModel {
  const m = COMPONENT_MODELS[id];
  if (!m) throw new Error(`Unknown component model: ${id}`);
  return m;
}
