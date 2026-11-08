/**
 * Learning Center modules. Content is introductory and tagged with its
 * accuracy class. Interactive exercises link to labs that exist today;
 * quizzes and guided steps arrive with Phase 6.
 */
import type { Accuracy } from '@/types/catalog';

export interface LearningFact {
  text: string;
  accuracy: Accuracy;
}

export interface LearningModule {
  id: string;
  number: number;
  title: string;
  summary: string;
  objectives: string[];
  theory: string;
  facts: LearningFact[];
  labs: { label: string; to: string }[];
  workOrders: string[];
}

export const MODULES: LearningModule[] = [
  {
    id: 'dc-fundamentals',
    number: 1,
    title: 'Data Center Fundamentals',
    summary: 'Data hall layout, hot/cold aisles, raised floors and the infrastructure that keeps IT equipment alive.',
    objectives: ['Identify cold aisle, hot aisle and containment', 'Explain why rack fronts face the cold aisle', 'Locate power, cooling and network infrastructure in a hall'],
    theory:
      'Racks are arranged in rows whose fronts face a shared cold aisle. Equipment pulls conditioned air in at the front and exhausts hot air to the rear hot aisle. Mixing the two streams, for example through open rack units without blanking panels, raises inlet temperatures and wastes cooling capacity.',
    facts: [
      { text: 'ASHRAE TC 9.9 recommends 18–27 °C inlet air for most IT equipment classes.', accuracy: 'industry' },
      { text: 'In this simulator every open U adds 0.25 °C of recirculation to rack inlet (max 4 °C).', accuracy: 'simplified' },
    ],
    labs: [{ label: 'Walk the data hall', to: '/datacenter' }],
    workOrders: [],
  },
  {
    id: 'server-hardware',
    number: 2,
    title: 'Server Hardware',
    summary: 'CPUs, memory, storage, PCIe, PSUs, fans and the BMC: what each part does and how it fails.',
    objectives: ['Name the major server components and their slots', 'Distinguish hot-swap from cold-swap parts', 'Read component health from the BMC and physical LEDs'],
    theory:
      'A server is a set of field-replaceable units (FRUs) plugged into a system board. Hot-swappable parts (PSUs, fans, front drives) can be replaced while the host runs. Everything else needs the host shut down, and industry practice is to disconnect AC power because standby power keeps parts of the board energised.',
    facts: [
      { text: 'DDR4 and DDR5 DIMMs are keyed differently and are not interchangeable.', accuracy: 'industry' },
      { text: 'OCP DC-SCM moves the BMC and BIOS flash onto a replaceable management module.', accuracy: 'industry' },
    ],
    labs: [{ label: 'Open a chassis in the Hardware Lab', to: '/hardware' }],
    workOrders: ['DCT-0004', 'DCT-0005'],
  },
  {
    id: 'rack-installation',
    number: 3,
    title: 'Rack Installation',
    summary: 'U positions, rails, weight distribution, power budgets and blanking panels.',
    objectives: ['Read rack elevations and U numbering', 'Place equipment respecting weight and power limits', 'Explain why open U need blanking panels'],
    theory:
      'A rack unit (U) is 44.45 mm. Equipment occupies contiguous U, numbered from the bottom. Heavy equipment goes low to keep the centre of gravity down. Each rack has a design power and a weight rating that must not be exceeded.',
    facts: [
      { text: '1U = 1.75 in (44.45 mm), as defined in EIA-310.', accuracy: 'verified', },
      { text: 'This simulator warns when equipment ≥ 40 kg is mounted above U20.', accuracy: 'simplified' },
    ],
    labs: [{ label: 'Explore rack elevations', to: '/racks/R01' }],
    workOrders: ['DCT-0006'],
  },
  {
    id: 'cabling',
    number: 4,
    title: 'Cabling and Connectivity',
    summary: 'Copper, DAC, AOC and fibre; transceivers; power cords; how to trace a cable path.',
    objectives: ['Match cables and transceivers to port types', 'Explain mechanical fit versus link compatibility', 'Trace a link end to end'],
    theory:
      'A cable that physically fits does not guarantee a link. Both ends must support a common speed, optics must match the fibre type (multimode vs single-mode) and the run must be within the cable length. Console ports accept RJ45 plugs but need a rollover console cable.',
    facts: [
      { text: 'QSFP-DD cages accept QSFP28 modules (backward compatible).', accuracy: 'industry' },
      { text: 'C13 plugs mate with C14 inlets; C19 plugs mate with C20 inlets.', accuracy: 'verified' },
    ],
    labs: [{ label: 'Patch schedule in the Network Lab', to: '/network' }],
    workOrders: ['DCT-0003'],
  },
  {
    id: 'linux-admin',
    number: 5,
    title: 'Linux Administration',
    summary: 'Shell basics, logs, services and hardware inventory commands used by DCTs.',
    objectives: ['Navigate the filesystem and read logs', 'Inspect hardware with lspci, lsblk, dmesg', 'Manage services with systemctl'],
    theory: 'The virtual terminal arrives in Phase 3. Its commands are evaluated against the simulation state, so their output always matches the hardware.',
    facts: [{ text: 'Terminal output is deterministic and never executes on the host machine.', accuracy: 'simplified' }],
    labs: [],
    workOrders: [],
  },
  {
    id: 'gpu-infrastructure',
    number: 6,
    title: 'GPU Infrastructure',
    summary: 'GPU servers, NVLink, NVSwitch and rack-scale systems such as NVL72.',
    objectives: ['Describe a rack-scale NVL72 system', 'Explain NVLink versus PCIe / C2C host links', 'Relate GPU health to power and cooling'],
    theory:
      'A GB200 NVL72 rack connects 72 Blackwell GPUs and 36 Grace CPUs across 18 compute trays. 9 NVLink switch trays join all GPUs into one NVLink domain over a copper spine. The rack is liquid-cooled and powered through a busbar fed by power shelves.',
    facts: [
      { text: 'GB200 NVL72: 18 compute trays (2 GB200 superchips each), 9 NVLink switch trays.', accuracy: 'verified' },
      { text: 'Each Blackwell GPU has 18 NVLink 5 links.', accuracy: 'verified' },
      { text: 'Tray internal layout in this simulator is an educational reference.', accuracy: 'reference' },
    ],
    labs: [
      { label: 'Inspect R05 (GB200 reference rack)', to: '/racks/R05' },
      { label: 'GPU Diagnostics', to: '/gpu' },
    ],
    workOrders: ['DCT-0001'],
  },
  {
    id: 'nvidia-diagnostics',
    number: 7,
    title: 'NVIDIA Diagnostics',
    summary: 'nvidia-smi, XID errors, ECC, NVLink status and DCGM health checks.',
    objectives: ['Interpret nvidia-smi output', 'Map XID codes to likely causes', 'Choose the right DCGM diagnostic level'],
    theory:
      'Some GPU failures are invisible to the BMC and appear only to the driver: a GPU that falls off the bus (XID 79) or uncorrectable HBM ECC errors (XID 48). Diagnose from the OS and driver side before you replace anything.',
    facts: [
      { text: 'XID 79 means "GPU has fallen off the bus" (NVIDIA XID documentation).', accuracy: 'verified' },
      { text: 'DCGM simulation (dcgmi diag -r 1/2/3) arrives in Phase 4.', accuracy: 'simplified' },
    ],
    labs: [{ label: 'GPU Diagnostics', to: '/gpu' }],
    workOrders: ['DCT-0001'],
  },
  {
    id: 'network-troubleshooting',
    number: 8,
    title: 'Network Troubleshooting',
    summary: 'Link state, speeds, admin state, VLANs, MTU and fabric troubleshooting.',
    objectives: ['Work bottom-up from physical link to IP reachability', 'Recognise admin-down versus link-down', 'Interpret negotiated speeds'],
    theory: 'Start at layer 1: is there a cable, does it fit, is there link, at what speed? Only then move to VLAN, IP and routing (Phase 5).',
    facts: [{ text: 'An 800G NIC on a 400G switch port negotiates 400G.', accuracy: 'industry' }],
    labs: [{ label: 'Network Lab', to: '/network' }],
    workOrders: ['DCT-0003'],
  },
  {
    id: 'liquid-cooling',
    number: 9,
    title: 'Liquid Cooling',
    summary: 'CDUs, manifolds, cold plates, flow, leaks and thermal throttling.',
    objectives: ['Trace the coolant loop from CDU to cold plate', 'Explain N+1 pump redundancy', 'Respond to a leak alarm safely'],
    theory: 'A CDU circulates treated coolant through rack manifolds to cold plates on the CPUs, GPUs and switch chips. Losing flow raises cold-plate temperatures within seconds.',
    facts: [{ text: 'This simulator uses a lumped thermal model (T = coolant + P × R / flow). It is not for facility design.', accuracy: 'simplified' }],
    labs: [{ label: 'Cooling & Power', to: '/facility' }],
    workOrders: [],
  },
  {
    id: 'power-infrastructure',
    number: 10,
    title: 'Power Infrastructure',
    summary: 'Feeds, UPS, PDUs, PSUs, A/B redundancy, busbars and power shelves.',
    objectives: ['Trace power from feed to PSU', 'Explain A/B redundancy and its failure modes', 'Read PDU load against its rating'],
    theory: 'Dual-PSU servers get one cord from the A-side PDU and one from the B-side PDU, each on an independent facility feed. Two cords on the same feed look redundant but are not.',
    facts: [
      { text: '3-phase 400 V / 32 A ≈ 22 kVA (√3 × V × I).', accuracy: 'industry' },
      { text: 'Continuous load is commonly kept at or below 80 % of a circuit rating.', accuracy: 'industry' },
    ],
    labs: [{ label: 'Cooling & Power', to: '/facility' }],
    workOrders: ['DCT-0002'],
  },
  {
    id: 'server-deployment',
    number: 11,
    title: 'Server Deployment',
    summary: 'Receiving, racking, cabling, power-on and validation of new hardware.',
    objectives: ['Follow a rack-and-stack checklist', 'Validate power, management and data connectivity', 'Hand over a node in a known-good state'],
    theory: 'Deployment is complete only once the node is validated: redundant power, reachable BMC, data links at the expected speed and a clean boot.',
    facts: [{ text: 'New equipment is mounted powered off; power on only after cabling is verified.', accuracy: 'industry' }],
    labs: [{ label: 'Rack Explorer', to: '/racks/R01' }],
    workOrders: ['DCT-0006'],
  },
  {
    id: 'incident-management',
    number: 12,
    title: 'Incident Management',
    summary: 'Work orders, priorities, evidence, escalation and closure.',
    objectives: ['Triage by priority and impact', 'Record evidence before changing anything', 'Validate before closing the ticket'],
    theory: 'Every intervention should be justified by evidence. Replacing parts at random hides root causes and costs money. Validation proves the fix.',
    facts: [{ text: 'Scoring of sequence, accuracy and unnecessary interventions arrives in Phase 6.', accuracy: 'simplified' }],
    labs: [{ label: 'Work Orders', to: '/workorders' }],
    workOrders: ['DCT-0001', 'DCT-0002', 'DCT-0003', 'DCT-0004', 'DCT-0005', 'DCT-0006'],
  },
];
