# DCT Simulator — Simulation Specification

This document is the contract for the simulation engine (`frontend/src/simulation`). Each rule
below is implemented in the module named next to it and covered by unit tests.
All numeric constants are **simplified teaching values** unless they are explicitly tagged
*verified*. See `docs/ASSUMPTIONS.md`.

---

## 1. Entities and states

### 1.1 Equipment

| Kind | Examples | Mount | Power path |
|------|----------|-------|-----------|
| `server` | 1U compute, 2U storage, 4U 8-GPU | rack U | cords: PDU outlet → PSU inlet |
| `compute_tray` | GB200 / GB300 reference compute tray (1U) | MGX rack U | busbar |
| `nvlink_switch_tray` | NVLink switch tray (1U) | MGX rack U | busbar |
| `power_shelf` | 1U shelf with hot-swap PSUs | MGX rack U | facility feed (hard-wired) |
| `switch` | ToR, management, spine, InfiniBand | rack U | cords |
| `pdu` | 0U vertical PDU, A or B side | rack side (0U) | facility feed (hard-wired) |
| `blank` | 1U/2U blanking panel | rack U | — |
| `cdu` | in-row coolant distribution unit | floor | facility feed |

**Server / tray / switch state machine** (`hardware/Server.ts`):

```
            no PSU/busbar power
   ┌──────────────────────────────────────────────┐
   ▼                                              │
powered_off ──power available──► standby ──power on──► powered_on (POST)
                                   ▲                       │ POST fails → boot_failed
                                   │ power off             ▼
                                   └──────────── booting ──► os_running ⇄ degraded
```

- `powered_off`: no PSU (or busbar) is delivering power. The BMC is dead.
- `standby`: power is available and the host is off. The BMC is alive if it is healthy.
- `powered_on`: POST is running (first `postMs` of the boot timer).
- `boot_failed`: POST failed. Causes: no healthy CPU in socket 0, no healthy DIMM, failed
  motherboard, failed boot drive, or failed BMC/firmware on trays.
- `booting`: OS is loading (until `bootTimeMs`).
- `os_running`: running, with no active degrading condition.
- `degraded`: running with at least one degrading condition (failed DIMM, failed PSU with
  redundancy lost, throttled GPU, failed fan, NVLink links down…).
- Losing all power in any state goes to `powered_off`. When power returns, the restore policy is
  "last state": if the host was on, it boots again.
- **Thermal trip**: if any component reaches its `criticalC`, the host powers off
  (`desiredPower = off`), and a critical event and SEL entry are logged.

### 1.2 Components

Each component instance has: `id`, `modelId`, `category`, `serial`, `location`
(equipment slot or inventory), `temperatureC`, `powered`, `status`, `conditions[]`, `health`.

| Category | Status values (derived) |
|----------|------------------------|
| `gpu` | lifecycle `not_powered → installed → detected → initialized`; health `healthy / degraded / failed` |
| `psu` | `ok / no_input / failed` |
| `fan` | `ok / failed / stopped` (+ RPM) |
| `cpu`, `dimm`, `nvme`, `nic`, `dpu`, `bmc`, `nvswitch`, `pump`, `riser`, `motherboard` | `ok / failed / not_powered` |

**Conditions** are ground-truth findings such as `PSU_NO_INPUT`, `FAN_FAILED` or
`GPU_FALLEN_OFF_BUS`. Each has a severity (`info / warning / critical`) and the
**observation channels** that can see it:

| Channel | Meaning | Available when |
|---------|---------|----------------|
| `led` | physical indicator visible on the hardware | component powered (even standby) |
| `bmc` | BMC sensor / SEL / Redfish view | BMC alive (standby power, BMC healthy) |
| `os` | kernel log, `lspci`, `ip link` (Phase 3) | host `os_running`/`degraded` |
| `driver` | `nvidia-smi` (Phase 3/4) | OS up and GPU driver loaded |
| `dcgm` | DCGM health/diag (Phase 4) | OS up and DCGM installed |

`health` (ground truth) is the worst condition severity mapped to `ok / warning / critical`.
The UI shows ground truth only in **developer mode**. Otherwise it asks
`DiagnosticEngine.healthVia(channel)`.

### 1.3 Ports

| State | Meaning |
|-------|---------|
| `disconnected` | no cable in the port |
| `connected` | cable inserted, far end not plugged into anything |
| `link_down` | both ends plugged, no link (far device off, incompatible media, damaged cable, speed mismatch) |
| `link_up` | link established at `speedGbps` |
| `disabled` | administratively shut down on the switch |
| `faulty` | port or owning NIC hardware fault |

Ports bound to a slot (PSU inlets, NIC ports) **exist only while that slot is populated**.
A slot cannot be emptied while its ports have cables attached.

### 1.4 Cables

`available` (in inventory, no ends attached) · `connected` (both ends attached, link
compatible) · `damaged` (fault) · `incompatible` (both ends attached but no link possible).
A cable with only one end attached is `connected` on that port and `available` at the other end.

---

## 2. Connector validation (`networking/Cable.ts`)

Validation runs in two stages:

1. **Mechanical fit**: can the plug physically enter the receptacle?
2. **Link compatibility**: once both ends are plugged in, can a link be established?

| Port (receptacle) | Accepts plugs | Notes |
|-------------------|--------------|-------|
| `rj45` | `rj45` | Ethernet / BMC |
| `serial_rj45` | `rj45` | Mechanically fits, but **only a console (rollover) cable** gives a working link. An Ethernet patch cord fits and does nothing |
| `sfp` / `sfp_plus` / `sfp28` | SFP-family plugs (`sfp_plus`, `sfp28`) or LC with an SFP-family transceiver | Speed = min(port, cable). SFP28 DAC in a 1G SFP port → no link |
| `qsfp28` | `qsfp28`, or MPO via a QSFP28 SR4 transceiver | |
| `qsfp_dd` | `qsfp_dd`, `qsfp28` (backward compatible) | |
| `osfp` | MPO via an OSFP transceiver | DAC/AOC OSFP not modelled in Phase 1 |
| `psu_c14` (PSU inlet) | `c13` | |
| `psu_c20` (PSU inlet) | `c19` | |
| `pdu_c13` (outlet) | `c14` | |
| `pdu_c19` (outlet) | `c20` | |
| `usb_a` / `usb_c` | `usb_a` / `usb_c` | |

Fibre plugs (`lc_duplex`, `mpo12`) require a transceiver in the port whose receptacle matches,
and the fibre mode must match (single-mode vs multimode). Cross-rack connections also require
`cable.lengthM ≥ distance(rackA, rackB) + vertical run`.

---

## 3. Power model (`power/PowerDistribution.ts`)

1. Facility feeds `A` and `B`: `up` unless a `feed_loss` fault is active.
2. PDU powered ⇔ its feed is up ∧ no `pdu_failure`. Outlet live ⇔ PDU powered.
3. PSU has input ⇔ inlet cable's far end sits in a live outlet ∧ cable not damaged.
4. PSU delivering ⇔ input ∧ installed ∧ no `psu_failure`.
5. Equipment capacity = Σ delivering PSU rating. Demand = idle + load × (max − idle).
6. Power status:
   - `disconnected`: no PSU has input.
   - `failed`: capacity is 0 although some input is present, or capacity < idle demand.
   - `degraded`: some installed PSU is not delivering, or capacity < demand (power brake:
     GPUs clock down).
   - `redundant`: all installed PSUs are delivering, there are ≥2 PSUs, and capacity minus one
     PSU still covers the demand.
   - `available`: otherwise, power is fine but not redundant.
7. **Busbar (MGX racks)**: power-shelf PSUs feed one rack busbar. Every tray in the rack gets
   power if busbar capacity > 0. If capacity < total rack demand, every tray is `degraded`
   (power brake).
8. PDU load = Σ demand of attached equipment ÷ number of its live PSU paths. A load above the
   PDU rating gives the condition `PDU_OVERLOAD` (Phase 5 adds breaker trips).

---

## 4. Thermal model (`cooling/ThermalModel.ts`)

**Air cooled**

- Rack inlet = CRAH supply (22 °C, inside the ASHRAE recommended 18–27 °C envelope) +
  0.05 °C × U position (stratification) + recirculation penalty: 0.25 °C per open U without a
  blanking panel (cap 4 °C).
- Fan capacity: each working fan can push 1.25× its nominal share, so an N+1 fan set
  compensates for one failure and the remaining fans run faster.
  `airflowFactor = min(1, capacity / demand)`. An open chassis on a running host multiplies
  airflow by 0.7.
- Component target `T = inlet + P × R_th / max(airflowFactor, 0.05)`.

**Liquid cooled (MGX racks)**

- CDU supply setpoint 30 °C. Pumps are N+1 (one pump is enough for nominal flow). Flow:
  2 pumps → 100 %, 1 pump → 100 % (redundancy lost), 0 pumps → 0 %. A leak in a rack
  manifold → 70 % flow for that rack, plus a leak-sensor alarm.
- Cold-plate component target `T = supply + P × R_cp / max(flowFactor, 0.05)`.
- Return temperature = supply + P_rack ÷ (ṁ · c_p), with ṁ from 160 L/min nominal flow per rack.

**Dynamics**: `T += (T_target − T) × (1 − e^(−dt/τ))`, τ = 15 s, rounded to 0.1 °C.

**Thresholds** (per component model, simulation values): `warnC`, `throttleC`, `criticalC`.
GPU thermal slowdown is proportional: from `throttleC − 3 °C` the clock factor falls by 0.08 per
°C (floor 0.5), raising `GPU_THERMAL_THROTTLE`. Power falls with the clock, so the GPU settles at
an equilibrium instead of oscillating. At or above `criticalC` the host trips. `advance()` steps
are capped at 2 s to keep this feedback loop numerically stable.

---

## 5. GPU model (`hardware/GPU.ts`)

| Condition | Lifecycle | Health |
|-----------|-----------|--------|
| host not running | `installed` (or `not_powered`) | — |
| `gpu_fallen_off_bus` / riser failure | `installed` (not enumerated) | failed |
| GPU driver not loaded (Phase 3 software state) | `detected` | — |
| running normally | `initialized` | healthy |
| `hbm_ecc_uncorrectable`, `gpu_xid` with fatal XID | `initialized` | failed |
| thermal or power-brake throttle, NVLink links down | `initialized` | degraded |

- NVLink (MGX racks): each GPU has 18 NVLink links, 2 to each of the 9 switch trays
  (simplified from the public topology, where each GPU connects once to each of 18 NVSwitch
  chips and every switch tray holds 2 chips). Active links = 2 × healthy, powered switch trays
  − links disabled by `nvlink_down`.
- Utilization, power and HBM use come from a per-equipment workload profile
  (`idle` / `training`). They are deterministic (no randomness).

---

## 6. Network link derivation (`networking/NetworkPort.ts`)

A port is `link_up` when all of the following hold:

1. The port exists (slot populated), has no fault, and is administratively enabled.
2. A cable is attached and the cable's other end is attached to port P2.
3. The cable is not damaged and the plug/receptacle link check passes for both ports.
4. Both owning devices are powered (BMC/management ports: standby is enough; data ports:
   host `powered_on` or later; switch ports: switch running).
5. `speed = min(port1.maxGbps, port2.maxGbps, cable.maxGbps)`. If the cable or a port
   cannot run at the other side's minimum speed, the link stays down.

**BMC reachability** (Phase 1): BMC alive ∧ BMC port `link_up` ∧ the far-end switch is running.
Phase 2 adds IP, VLAN, routing and firewall checks for the technician laptop.

---

## 6a. Layer 2: VLANs (`networking/Vlan.ts`)

- Ethernet switching ports (management, data and uplink roles; not InfiniBand, not a switch's
  own OOB port) carry an 802.1Q config: `access <vlan>` or `trunk allowed [..] native <vlan>`.
- A **segment** is a VLAN broadcast domain: flood from a switch across up-links whose two ends
  both carry the VLAN, through running switches only.
- An endpoint attaches to the VLAN its edge port maps its frames into. Untagged frames on an
  access port go to the access VLAN, and tagged frames on an access port are **dropped**.
  Untagged frames on a trunk go to the native VLAN, and tagged frames are accepted if allowed.
- A cable from endpoint to endpoint (laptop ↔ BMC) forms a point-to-point segment.

Seed plan: OOB management switches and the OOB aggregation use VLAN 10; ToR and spine use
VLAN 100. Inter-switch links are trunks; endpoint ports are access ports.

## 6b. Layer 3: addressing, routing, services (`networking/Reachability.ts`)

| Network | VLAN | Subnet | Gateway (SVI) | Services |
|---------|------|--------|---------------|----------|
| `oob` | 10 | 10.10.0.0/16 | 10.10.0.1 on `agg-r04` | DHCP pool 10.10.250.100–199, DNS 10.10.0.53 |
| `data` | 100 | 10.100.0.0/16 | 10.100.0.1 on `spine-r04-1` | none (static) |

- Addresses: BMC / switch management `10.10.<rack>.<n>`, host data `10.100.<rack>.<n>`, with
  the same `<n>` for one host. Staged spares have DCIM-reserved addresses.
- Endpoint liveness: BMC needs the BMC alive; host data needs the OS up; switch management
  and router services need the switch OS up.
- Same subnet: the target must be in the sender's segment and alive, otherwise
  *Destination Host Unreachable*. Different subnet: a gateway must be set, inside the sender's
  subnet, and answering in its segment. Then the firewall is checked (`FW-OOB-ISOLATION`
  denies oob ↔ data). Finally the target must sit in its network's segment as seen from that
  network's router, otherwise the result is *Request timed out*.
- DNS names: `<host>-bmc` → BMC, `<host>` → host data address, switch hostname → management
  address. Resolution needs a reachable DNS server.
- SSH needs a reachable target, an SSH service, and the matching credential profile
  (`bmc-admin`, `linux-dct`, `netops`). HTTPS is offered by BMCs only.
- **NOC view of a BMC** (`bmcReachability`): link up, plus membership in the OOB segment that
  contains the OOB router. A wrong access VLAN therefore isolates a BMC while its link LED
  stays lit.

## 7. Mounting and servicing rules (`hardware/Rack.ts`, `hardware/Compatibility.ts`)

**Mount** (hard errors): equipment must be in inventory; `1 ≤ uStart`;
`uStart + h − 1 ≤ rack.heightU`; no overlap; rack type supported by the equipment
(`compute_tray` needs an MGX rack with busbar and manifold).
**Warnings** (best practice): equipment ≥ 40 kg above U20; rack design power exceeded;
weight limit exceeded.

**Unmount**: host must be `powered_off` or `standby`; all cables disconnected.

**Remove / install component**:
- The part must be field-replaceable (`GPU` in GB200/GB300 trays is not; replace the tray).
- Category and form factor must match the slot (`DDR4-RDIMM` cannot go into a `DDR5-RDIMM`
  slot).
- PSUs in one chassis must be the same model.
- Not hot-swappable → host must be off (`standby` / `powered_off`) and the chassis open.
  Servicing with standby power present succeeds with an **unsafe-procedure warning**
  (recorded for scoring).
- Hot-swap parts (PSU, fans, front NVMe) can be serviced live; consequences follow
  (for example, pulling the last working PSU drops the host).
- Slots with attached cables (PSU inlet, NIC ports) must be unplugged first.

---

## 8. Fault injection (`diagnostics/FaultInjector.ts`, `data/faults/faultCatalog.ts`)

A fault definition has: `type`, `targetKinds`, `severity`, `symptoms` (learner-facing),
`observableEffects`, `rootCause` (hidden), `diagnosticEvidence`, `recovery`, and
`validation`. Active faults attach to an **instance id** (component, port, cable, equipment,
feed, rack). Replacing a part therefore removes the fault from the system, and the faulty part
keeps its fault in inventory. The injector rejects targets of the wrong kind.

| Fault | Target | Effect |
|-------|--------|--------|
| `psu_failure` | psu | PSU not delivering; LED amber |
| `fan_failure` | fan | 0 RPM; airflow capacity drops |
| `dimm_uncorrectable` | dimm | DIMM failed; host degraded; DIMM fault LED |
| `nvme_failure` | nvme | drive failed; boot drive → `boot_failed` on next boot |
| `cpu_failure` | cpu | IERR; host crashes; POST fails (socket 0) |
| `gpu_fallen_off_bus` | gpu | not enumerated; XID 79 in OS log |
| `gpu_xid` (param `xid`) | gpu | XID logged; fatal XIDs fail the GPU |
| `hbm_ecc_uncorrectable` | gpu | DBE ECC counters; GPU failed |
| `gpu_cooling_degraded` | gpu | thermal resistance × 2.5 (poor cold-plate contact / blocked heatsink) |
| `nvlink_down` (param `links`) | gpu | N NVLink links down |
| `nvswitch_failure` | nvlink_switch_tray | tray not providing links |
| `nic_failure` | nic | all ports on the NIC `faulty` |
| `port_faulty` | port | port `faulty` |
| `cable_damaged` | cable | link down |
| `pdu_failure` | pdu | all outlets dead |
| `feed_loss` | feed | every PDU/shelf on the feed loses power |
| `pump_failure` | pump | CDU flow capacity reduced |
| `coolant_leak` | rack | 70 % flow, leak alarm |
| `bmc_failure` | bmc | BMC dead: no remote management, no SEL |

---

## 10. Technician laptop (`workstation/Workstation.ts`, `workstation/Console.ts`)

- Equipment `laptop-01` on a crash cart (`location: cart` at a rack, cold or hot aisle). The
  cart can move only when no laptop cable is attached. Cable runs from the cart use U 20, plus
  1.2 m to reach the other side of the rack.
- Ports: `eth0` RJ45 1G (role `tech`), `usb0`/`usb1` USB-A, `usbc0` USB-C PD power inlet,
  `hdmi0`.
- Power: on AC when the C14 → USB-C adapter sits in a live PDU outlet. Otherwise the battery
  drains (100 % in 120 min) and charges at 100 % per 60 min on AC. At 0 % the laptop is off and
  eth0 loses link.
- IP: DHCP (lease from the pool of the VLAN the port lands in, if that VLAN's router offers
  DHCP), otherwise a link-local `169.254.x.x/16`; or static (validated). A static address that
  duplicates a device raises a conflict.
- Serial console: a console cable from a laptop USB-A port to an RJ45 console port shows the
  host's console. That is POST, boot progress, POST failures, kernel messages for OS-visible
  conditions (XIDs, EDAC, PCIe AER) and the login prompt. It needs no network or BMC.

## 9. Events and SEL (`diagnostics/HealthMonitor.ts`)

Transitions produce events: `{ id, timeMs, severity, category, equipmentId?, componentId?,
message, devOnly? }`. Categories: `power`, `thermal`, `network`, `hardware`, `system`, `gpu`,
`procedure`, `fault`. The log keeps the last 500 entries. BMC SEL entries are written only while
that BMC is alive. Fault injection is always `devOnly`, so the hidden root cause is never
revealed by the activity feed.
