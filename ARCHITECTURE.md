# DCT Simulator — Architecture

## 1. Big picture

```
┌──────────────────────────── Browser ─────────────────────────────┐
│                                                                  │
│  React UI (pages, components, R3F scenes)                        │
│     │  selectors (read)           ▲ snapshots                    │
│     ▼                             │                              │
│  Zustand stores ── dispatch(action) ──►  SimulationEngine        │
│  (simulationStore, uiStore,           (framework-free TypeScript)│
│   progressStore)                         │                       │
│                                          ├─ action handlers      │
│                                          ├─ derivation pipeline  │
│                                          │   power → server →    │
│                                          │   components → network│
│                                          │   → thermal → health  │
│                                          ├─ HealthMonitor (diff  │
│                                          │   → events, BMC SEL)  │
│                                          └─ EventBus             │
│  SimulationClock ── advance(ms) ─────────┘                       │
└──────────────────────────────────────────────────────────────────┘
                  │ (Phase 6: progress sync, scenario catalog)
                  ▼
        FastAPI backend ── SQLAlchemy ── SQLite (dev) / PostgreSQL
```

The **SimulationEngine is the single source of truth.** React components never compute
hardware behaviour. They render engine snapshots and send intent through `dispatch()`.

## 2. Repository layout

```
dct-simulator/
├── PROJECT_PLAN.md  ARCHITECTURE.md  SIMULATION_SPEC.md  IMPLEMENTATION_ROADMAP.md
├── docs/ASSUMPTIONS.md          accuracy policy, simplifications, sources
├── backend/.venv               (local Python venv, git-ignored)
├── frontend/                    Vite + React + TS app
│   ├── e2e/                     Playwright specs
│   └── src/
│       ├── components/
│       │   ├── ui/              shadcn-style primitives (Button, Badge, Panel, Tabs…)
│       │   ├── layout/          AppShell, Sidebar, TopBar
│       │   ├── dashboard/  datacenter/  rack/  server/  gpu/  networking/
│       │   ├── diagnostics/  workorders/  inventory/  laptop/  terminal/
│       ├── pages/               one route-level screen per sidebar entry
│       ├── scenes/DataHallScene/  React Three Fiber scene graph
│       ├── simulation/
│       │   ├── core/            SimulationEngine, SimulationState, EventBus, SimulationClock,
│       │   │                    actions, derive pipeline, snapshot (reconcile), persistence, util
│       │   ├── hardware/        Server (state machine, POST), GPU, CPU, Memory, Storage,
│       │   │                    PSU, Fan, Compatibility, Rack (mount rules)
│       │   ├── networking/      Cable (connector validation), NetworkPort (link derivation),
│       │   │                    Switch, NetworkTopology, Vlan (L2 segments), Reachability
│       │   │                    (L3 routing, firewall, DNS, ping/SSH/HTTPS probes), ip
│       │   ├── workstation/     technician laptop: power/battery, DHCP/static IP, cart, console
│       │   ├── power/           PowerDistribution (feeds → PDU → PSU / busbar), PowerState
│       │   ├── cooling/         CoolingSystem (CDU, loops), ThermalModel
│       │   ├── diagnostics/     FaultInjector, HealthMonitor, DiagnosticEngine (channels)
│       │   └── scenario/        buildInitialState (Data Hall 01 seed)
│       ├── stores/              simulationStore, hardwareStore (selectors), uiStore, progressStore
│       ├── data/                hardware/ cables/ faults/ workorders/ learning/ catalogs
│       ├── types/               shared domain types
│       ├── hooks/  utils/
│       └── test/                Vitest setup
└── backend/                     FastAPI service
    ├── app/ (api/ services/ models/ schemas/ main.py db.py)
    └── tests/
```

## 3. Simulation engine

### 3.1 State shape (`src/types/simulation.ts`)

`SimulationState` is a plain, serializable object (no classes, no functions), so it can be
snapshotted, diffed, saved and replayed.

| Collection | Key | Contents |
|------------|-----|----------|
| `facility` | — | data hall, power feeds A/B, CRAH supply temperature, rows |
| `racks` | `R01` | height (U), rack type (`standard` / `mgx`), cooling, position, limits |
| `equipment` | `srv-r01-01` | servers, switches, PDUs, compute trays, NVLink switch trays, power shelves, CDUs, blanks, laptop |
| `components` | `srv-r01-01/psu1` | CPU, DIMM, GPU, NVMe, PSU, fan, NIC, riser, BMC, pump… |
| `ports` | `srv-r01-01:bmc` | every physical port, with derived link state |
| `cables` | `cbl-0001` | two cable ends, each optionally attached to a port |
| `faults` | `flt-0001` | active injected faults (target, type, params, hidden flag) |
| `events` | — | capped activity log produced by HealthMonitor |

Each entity has **base fields** (inputs: what is physically installed, connected, switched on or
faulted) and **derived fields** (outputs: power status, server state, link state, temperature,
conditions, health). Only action handlers write base fields, and only the derivation pipeline
writes derived fields.

### 3.2 Action flow

```
dispatch(action)
  └─ handler(work, action)          // validate first, then mutate base fields (or throw SimError)
  └─ derive(work)                   // run the rule pipeline to a consistent state
  └─ next = reconcile(prev, work)   // immutable snapshot; unchanged entities keep their identity
  └─ HealthMonitor.diff(prev, next) // emit events + BMC SEL entries
  └─ notify subscribers             // Zustand mirrors the snapshot
```

The engine mutates a private **working copy** and publishes immutable **snapshots**
(`core/snapshot.ts`). `reconcile` deep-compares each entity against the previous snapshot and
reuses the old object when nothing changed. That gives the same structural sharing as immer at a
fraction of the cost: immer was prototyped first and measured at about 240 ms per tick for
~4,000 entities, against about 12 ms with reconcile. On a refused action the working copy is
restored from the last snapshot.

`dispatch()` returns `{ ok: true, warnings }` or `{ ok: false, code, message }`, so the UI can
explain why an action was refused (for example "U32–U35 overlaps srv-r03-02 (U33–U36)").

### 3.3 Derivation pipeline (`simulation/core/derive.ts`)

Rules are independent modules run in dependency order. Each is a pure function of the draft
state and the current time:

1. **PowerDistribution**: feed → PDU → outlet liveness → PSU input → PSU output → equipment
   power capacity and status (`redundant | available | degraded | failed | disconnected`).
   MGX racks use power shelves → busbar instead of cords.
2. **Server**: power state machine
   (`powered_off | standby | powered_on | booting | boot_failed | os_running | degraded`),
   POST checks, BMC liveness.
3. **Components**: per-category status and conditions (GPU lifecycle
   `installed → detected → initialized`, PCIe, NVLink, ECC, fan RPM, PSU output).
4. **NetworkPort**: link state per port
   (`disconnected | connected | link_up | link_down | disabled | faulty`), negotiated speed,
   reason.
5. **ThermalModel**: target temperatures from inlet air or coolant, power and airflow/flow.
   `advance()` integrates toward the target with a first-order time constant.
6. **Health rollup**: component → equipment → rack, per observation channel.

Rules only write a value when it changed (`util.set`), so derived arrays such as conditions
keep their identity and `reconcile` finds most entities unchanged from tick to tick.

### 3.4 Time

`SimulationClock` (browser only) calls `engine.advance(ms)` every 500 ms of real time,
scaled by the sim speed (1×, 2×, 5×, 10×). `advance()` moves boot timers and thermal
integration forward in steps of at most 2 s (so the thermal-throttle feedback loop stays
stable) and re-derives after each step. Tests call `engine.advance()` directly, so they are
deterministic and instant.

### 3.4a Persistence

`core/persistence.ts` writes the snapshot to `sessionStorage` on `pagehide` /
`visibilitychange` (about 1.4 MB, about 18 ms). A reload of the same tab therefore resumes the
lab, while a new tab starts a fresh scenario. In-progress work orders are bound to the
per-tab `SESSION_ID`, so they stay valid exactly when the state is restored. Learner progress
lives in `localStorage` (and in the backend from Phase 6).

### 3.5 Observation channels (diagnostic realism)

Ground truth (`component.conditions`) is never shown to the learner directly outside
developer mode. Each condition lists the **channels** that can observe it: `led`, `bmc`, `os`,
`driver`, `dcgm`. `DiagnosticEngine` answers questions such as "what health does the BMC
report for this PSU?". If the BMC has no standby power or no management link, the answer is
`unknown`. The learner has to find out *why* by inspecting physically, which is the core
teaching loop. Terminal commands (Phase 3) read the `os`, `driver` and `dcgm` channels.

### 3.6 Events

`HealthMonitor` diffs the previous and next snapshot for server state, power status,
component health, link state and conditions. It appends human-readable events to
`state.events` and to each equipment's BMC SEL (only while that BMC is alive). Fault-injection
events are tagged `devOnly` so that root causes stay hidden outside developer mode.
`EventBus` publishes the same events to in-process subscribers (UI toasts, future scoring).

## 4. Frontend layers

| Layer | Responsibility | Must not |
|-------|---------------|----------|
| `simulation/**` | rules, validation, state | import React, the DOM or stores |
| `stores/**` | hold the engine snapshot, UI selection, persisted progress | duplicate hardware state |
| `stores/hardwareStore.ts` | memoized selectors and hooks over the snapshot | own state |
| `components/**`, `pages/**` | render snapshots, dispatch actions | compute hardware behaviour |
| `scenes/**` | 3D representation of the same snapshot | hold separate state |

### Physical interaction (Phase 2)

- `hooks/useCableActions.ts` holds the cable workflow shared by clicks and drag-and-drop (pick
  up, plug the end that fits, unplug, stow). The drag payload is tracked in-module because
  browsers hide `dataTransfer` during `dragover`.
- `components/rack/RackWorkbench.tsx` wraps the elevation and the crash cart. It handles drops
  by delegation on `[data-port]` / `[data-free-u]` and draws cables in an SVG overlay measured
  from the port elements (a post-commit effect plus `ResizeObserver`).
- `components/laptop/*` holds the laptop window (top-bar button) and its apps. Every probe is a
  pure read of the latest snapshot.

### Visual design system (`DESIGN.md`)

- Tokens live in `src/index.css`: CSS variables in `:root` (light) with a `[data-theme='dark']`
  override, mapped to Tailwind utilities by `@theme inline` (`bg-canvas`, `bg-sidebar`, `bg-bg`,
  `bg-surface-2`, `text-fg`, `text-muted`, `bg-hero`, pastel `ok/warn/info/crit` soft and ink
  pairs, radii `rounded-panel/box/card/chip`). Components use tokens, not raw hex, except the
  fixed pastel stat cards that keep the same colour in both themes.
- `uiStore.theme` is persisted. `App` writes it to `<html data-theme>` and an inline script in
  `index.html` applies it before first paint. The sidebar holds the theme switch.
- Shell: canvas, then a rounded frame with sidebar and main panel. The sidebar becomes a 76 px
  icon rail at `lg` and a drawer below it. The header has a greeting, mode select, sim clock and
  40 px icon buttons (search, alerts, laptop, settings).
- Dashboard charts (`components/dashboard/charts.tsx`) are dependency-free SVG. They read the
  `telemetryStore` ring buffer, which samples the engine every 5 s of simulated time.
- Hardware faces (rack elevation, chassis, equipment fronts) stay dark in both themes, as real
  equipment is black metal. The 3D hall and the 2D plan follow the theme.
- `scripts/ui-shots.mjs` captures every page in both themes at chosen widths (dev helper,
  needs the dev server).

### 3D performance

- `frameloop="demand"`: the canvas re-renders only when the snapshot, the camera or a hover
  changes.
- Instanced floor tiles; procedural canvas textures (no texture downloads); DOM labels via
  drei `Html` (no font fetching).
- WebGL detection, plus an error boundary that falls back to the 2D floor plan.

## 5. Backend (FastAPI)

Phase 1 scaffolds a working service: `/api/health`, learner progress CRUD (SQLite through
SQLAlchemy, with a PostgreSQL-compatible schema) and pytest tests. Simulation stays
client-side: it is deterministic and latency-sensitive. The backend will own persistence,
the scenario/work-order catalog and assessment records (Phase 6). Scoring may move
server-side so that assessment results cannot be tampered with.

## 6. Extension points

| To add… | Touch |
|---------|-------|
| a hardware model | `data/hardware/equipmentCatalog.ts` (slots, ports, defaults) |
| a component model | `data/hardware/componentCatalog.ts` |
| a cable or port type | `data/cables/cableCatalog.ts`, `simulation/networking/Cable.ts` mating table |
| a fault type | `data/faults/faultCatalog.ts`, plus its effect in the owning rule module |
| a terminal command (Phase 3) | `simulation/terminal/commands/*.ts`, registered in `CommandRegistry` |
| a network / VLAN / firewall rule | `facility.networks` and `facility.firewall` in the seed; `networking/Reachability.ts` |
| a laptop app | `components/laptop/LaptopApps.tsx` (pure probes from `Reachability.ts`) |
| a scenario / work order | `data/workorders/*.ts` (faults to inject, resolution criteria) |
