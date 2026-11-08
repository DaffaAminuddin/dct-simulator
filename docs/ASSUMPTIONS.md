# Assumptions, Simplifications and Sources

DCT Simulator is a **training tool**. Every catalog entry and teaching fact carries one of five
accuracy tags, shown as a badge in the UI:

| Tag | Meaning |
|-----|---------|
| **Verified spec** | Widely published top-level vendor or standards figure. The source is noted on the item |
| **Industry practice** | General behaviour or convention (connector mating, A/B power, ASHRAE ranges) |
| **Simplified model** | Teaching approximation: timing, power, thermal, flow |
| **Reference model** | Generic educational hardware design, not an OEM internal layout |
| **Training scenario** | Hypothetical incident or work order |

## Verified top-level facts used

| Fact | Where | Source |
|------|-------|--------|
| GB200 NVL72: 72 Blackwell GPUs, 36 Grace CPUs, 18 compute trays (2 superchips each), 9 NVLink switch trays with 2 switch chips each, liquid-cooled | R05, catalog notes | NVIDIA GB200 NVL72 product page |
| ~13.4 TB HBM3e per NVL72 → 186 GB per GPU (derived) | `gpu-blackwell-gb200` | NVIDIA GB200 NVL72 product page |
| Blackwell Ultra: up to 288 GB HBM3e per GPU | `gpu-blackwell-ultra-gb300` | NVIDIA GB300 NVL72 product page |
| 18 NVLink (5th gen) links per Blackwell GPU | GPU model, NVLink logic | NVIDIA NVLink / NVL72 pages |
| Grace: 72 Arm Neoverse V2 cores, NVLink-C2C host link | `cpu-grace` | NVIDIA Grace CPU page |
| ConnectX-7 up to 400 Gb/s; ConnectX-8 SuperNIC up to 800 Gb/s | NIC models | NVIDIA product briefs |
| XID meanings (13, 31, 43, 48, 63, 64, 74, 79, 92, 94, 95, 119) | `faultCatalog.ts` | NVIDIA XID error documentation |
| IEC 60320 C13↔C14, C19↔C20 mating | `Cable.ts` | IEC 60320 |
| 1U = 44.45 mm | Learning module 3 | EIA-310 |
| ASHRAE recommended inlet 18–27 °C | CRAH control, module 1 | ASHRAE TC 9.9 thermal guidelines |

Nothing in the simulator reproduces proprietary service procedures, internal OEM layouts,
vendor diagnostic thresholds or vendor-specific command output.

## Simplified models

### Timing
- Boot: POST 7–15 s, OS up at 20–35 s depending on model. Real systems vary widely.
- Thermal time constant τ = 15 s, first-order. Real silicon responds faster and heatsinks slower.

### Power
- Component draw = idle + load × (max − idle); load fractions per workload profile
  (`PowerState.ts`). PSU losses fixed at 6 %. No power factor, no phase balance (Phase 5).
- PDU rating 22 kW (3-phase 400 V / 32 A). The 80 % warning follows common continuous-load
  practice.
- Power shelf: 6 × 5.5 kW PSUs, 8 shelves per NVL rack. These figures are illustrative and
  not taken from a specific product.
- CDU is dual-fed through an implied automatic transfer switch.

### Thermal
- Air: `T = inlet + P × R_th / airflowFactor`. Each fan can deliver 1.25× its nominal share
  (N+1 compensation). An open lid on a running host gives 0.7× airflow.
- Inlet = CRAH supply + 0.05 °C/U stratification + 0.25 °C per open U (cap 4 °C).
- Liquid: `T = 30 °C supply + P × R_cp / flowFactor`. Pumps are N+1. A leak reduces flow to 70 %.
- Thresholds (`warnC`, `throttleC`, `criticalC`) are simulation values, not vendor limits.
- GPU thermal slowdown is proportional: clocks fall from 3 °C below the throttle point so the
  GPU settles at an equilibrium.

### Networking
- Link = physical layer only in Phase 1: cable present, mechanical fit, common speed, media
  match, both ends powered, admin up, no fault. IP, VLAN and routing arrive in Phase 2 and 5.
- Twin-port OSFP cages on the InfiniBand switch are modelled as two logical 400G ports.
- QSFP-DD SR8 optics use MPO-12 (real: MPO-16). 800G twin-port optics use one MPO.
- Cable length check: Manhattan run between racks plus 3 m of vertical drops; within a rack,
  0.8 m plus 4.45 cm per U of separation.

### Network layer (Phase 2)
- One flat /16 per network, with one router (SVI) per network and no spanning tree. Loops are
  not modelled, and links have no ARP or MAC-learning timing.
- The OOB and data networks are isolated by an explicit firewall rule pair. There are no
  per-port ACLs, NAT or IPv6.
- Each network has one deterministic DHCP pool. The first free address is leased, with no
  lease timers.
- SSH and HTTPS are modelled as reachability, service and credential-profile checks. Lab
  credentials are simulated vault entries, not passwords.
- Serial console output is a simplified, generic boot log. It does not reproduce a vendor
  BIOS or BMC console.

### NVLink mapping
Each GPU connects once to each of the 18 NVLink Switch chips; with 2 chips per tray, every
switch tray contributes 2 of a GPU's 18 links. An unhealthy tray removes 2 links from every GPU
in the rack.

### Observation channels
Which faults are visible to the BMC, the LEDs, the OS, the driver or DCGM follows general
industry behaviour, simplified per fault type (see `SIMULATION_SPEC.md` §1.2 and §8).

## Limitations (after Phase 2)

- No terminal yet (Phase 3). The GPU Diagnostics screen shows the driver-channel view.
- Work-order scoring, guided step highlighting and quizzes are not built (Phase 6).
- The simulation runs on the main thread at 2 Hz. A tick costs about 12 ms on a desktop CPU.
- Not suitable for facility design, capacity planning or safety certification.
