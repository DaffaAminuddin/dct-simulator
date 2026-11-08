# DCT Simulator — Implementation Roadmap

Legend: ✅ done · 🟡 partial (engine ready, UI pending) · ⬜ planned

## Phase 1 — Interactive foundation ✅

- ✅ Vite + React 19 + TS strict + Tailwind v4 + shadcn-style primitives
- ✅ App shell: 13-entry sidebar, top bar with simulation clock (play/pause/speed) and facility health
- ✅ Simulation engine: state, actions, derivation pipeline, event bus, clock, health monitor
- ✅ Hardware catalogs: 1U / 2U / 4U-GPU reference servers, GB200 / GB300 NVL72-style reference
  racks (compute trays, NVLink switch trays, power shelves), switches, PDUs, CDU
- ✅ Data Hall 01 seed: 6 racks, ~1,600 components, ~1,000 ports, fully cabled
- ✅ Virtual Data Center: 3D hall (raised floor, hot/cold aisles, cable trays, busway, CRAH, CDU),
  orbit camera, camera presets, rack selection; 2D floor-plan fallback
- ✅ Rack Explorer: front/rear elevations, U numbering, LEDs, ports, 0U PDUs, free-U map,
  placement checks, equipment detail panel (overview / components / ports / power / SEL)
- ✅ Hardware Lab: top-down chassis view, component details (ID, model, serial, health,
  temperature, power, installation, failure), lid open/close, remove/install with rules
- ✅ Read-only engine views: GPU telemetry, power and cooling, patch schedule, inventory
- ✅ Developer mode: fault injection and clearing, ground-truth overlay
- ✅ Dashboard: hardware health overview, alerts, recent activity, progress, work orders,
  recommended module
- ✅ 83 engine unit tests, 8 component tests, 4 Playwright E2E flows (installed Edge)
- ✅ Simulation survives page reloads (sessionStorage); progress in localStorage
- ✅ Work orders DCT-0001…0006 can be started (fault injection) and validated against the engine
- ✅ FastAPI backend scaffold: health + progress API + pytest

## Phase 2 — Physical interaction ✅

- ✅ Engine: mount/unmount with U constraints; component remove/install with compatibility;
  cable connect/disconnect with connector validation and length checks
- ✅ Mounting from inventory: drag a chip onto a free U, or use the selectors (Rack Explorer)
- ✅ Cable tray; drag a cable onto a port (green = fits, red = refused with the engine's reason);
  "cable in hand" chip that can be dragged to the next port; unplug and re-plug from the port inspector
- ✅ Cable rendering in the rack view (cables within the rack, risers for cables leaving it,
  selected cable highlighted)
- ✅ Technician laptop on a crash cart: RJ45 eth0, 2 × USB-A, USB-C PD power, HDMI; battery
  and AC; the cart moves between racks (cables must be unplugged first)
- ✅ Network layer: 802.1Q access/trunk switch ports, VLAN segments, IP plan (OOB 10.10/16,
  data 10.100/16), gateway SVIs, DHCP pool, DNS, OOB↔data firewall
- ✅ Laptop apps: network settings (DHCP/static, prefix, gateway, DNS, VLAN tag, interface
  state), ping, SSH client (credential vault, auth checks), browser with BMC web UI
  (Redfish-style power control), serial console with boot/POST/kernel output
- ✅ BMC reachability now includes the VLAN/L3 path from the management router
- ✅ Switch-port VLAN editing (port inspector); patch schedule shows switchport and IPs
- ✅ Work orders DCT-0007 (BMC isolated by a wrong VLAN) and DCT-0008 (laptop onboarding)
- ✅ Playwright: management cable unplugged → SSH fails → replug → SSH works (with drag-and-drop)

## Phase 3 — Virtual terminal ⬜

- ⬜ xterm.js + fit addon; prompt, history, tab completion, `clear`, Ctrl-C
- ⬜ CommandParser (tokens, quotes, pipes to `grep`/`head`/`wc`, redirection rejected),
  CommandRegistry, CommandExecutor (pure: `(state, session, argv) → {stdout, stderr, exit, effects}`)
- ⬜ Simulated filesystem per host (`/var/log`, `/proc`, `/sys/class/net`, `/etc`)
- ⬜ Linux commands from the brief; output derived from the `os` channel
- ⬜ SSH sessions gated by reachability, credentials and `sshd` state
- ⬜ NVIDIA: `nvidia-smi` (+ `-q`, `-L`, `-i N -q`) from the `driver` channel; driver-missing errors
- ⬜ Snapshot tests per command × fault matrix

## Phase 4 — GPU diagnostics 🟡

- ✅ Engine: GPU lifecycle, XID, HBM ECC, PCIe, NVLink link counts, thermal and power-brake
  throttling, fault injection
- ⬜ DCGM simulation: `dcgmi discovery -l`, `health -c`, `diag -r 1|2|3` with run-time
  progression and per-test results
- ⬜ GPU Diagnostics screen: time-series charts, XID timeline, NVLink matrix
- ⬜ 15 GPU troubleshooting scenarios (symptoms, clues, hidden cause, repair, validation)

## Phase 5 — Network, cooling and power 🟡

- ✅ Engine: link derivation, admin state, PSU/PDU/feed dependencies, busbar, CDU pumps, leaks,
  air/liquid thermal model
- ⬜ Topology graph view; switch CLI (`show interface`, `show vlan`); VLAN, MTU, routing, ACL
- ⬜ Packet simulation: latency, loss, duplicate-IP ARP, MTU black holes
- ⬜ InfiniBand: `ibstat`, `iblinkinfo`, `ibdiagnet`, `mlxlink` from port state
- ⬜ PDU breaker trips, phase balance, overload
- ⬜ Cooling screen: loop diagram, flow/pressure sensors, leak response procedure

## Phase 6 — Work orders and training 🟡

- ✅ Work order and learning-module data model; read-only views; local progress store
- ⬜ Work order lifecycle: Open → Assigned → In Progress → Pending Parts → Pending Validation →
  Resolved → Closed
- ⬜ Scenario runner: inject faults, track learner actions, evaluate resolution criteria
- ⬜ Scoring: diagnosis, sequence, command accuracy, handling, repair, validation, time;
  penalties for unnecessary replacements and unsafe procedures
- ⬜ Modes: Guided (step highlights), Practice (hints), Incident (timer, hidden causes, no hints)
- ⬜ Backend sync of progress and assessment records

## Milestone exit criteria

A phase is complete when `npm run typecheck`, `npm test`, `npm run build` and the Playwright
suite pass, the acceptance criteria from the brief are demonstrated in the running app, and
docs are updated.
