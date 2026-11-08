# DCT Simulator: Data Center Technician Virtual Lab

A browser-based virtual AI data hall for hands-on Data Center Technician training. You inspect
racks, open server chassis, trace and re-plug cables, read BMC and GPU telemetry and close work
orders. A deterministic simulation engine underneath is the single source of truth for power,
cooling, network, hardware and diagnostic state.

> Learn by doing · inspect before replacing · diagnose before repairing · validate before closing the ticket.

**Status: Phase 1 (interactive foundation) and Phase 2 (physical interaction, technician laptop, network layer) are complete.** See `IMPLEMENTATION_ROADMAP.md`.

## Quick start

Requirements: Node.js ≥ 20 (tested on 24), npm, Python ≥ 3.11 (backend, optional).

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

| Command (in `frontend/`) | What it does |
|--------------------------|--------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run typecheck` | TypeScript (strict) only |
| `npm test` | Vitest: engine unit tests and component tests |
| `npm run e2e` | Playwright E2E. Uses the installed **Microsoft Edge** (`PW_CHANNEL=chrome` for Chrome), so no browser download is needed |

### Backend (optional in Phase 1)

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt     # Windows (use .venv/bin/python elsewhere)
.venv/Scripts/python -m pytest
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

API: `GET /api/health`, `GET|PUT /api/learners/{id}/progress`,
`GET|POST /api/learners/{id}/attempts`. SQLite by default, and any SQLAlchemy URL through
`DATABASE_URL` (PostgreSQL-compatible schema). The frontend does not call the backend yet. Progress
sync is planned for Phase 6.

## What you can do today

| Screen | Highlights |
|--------|-----------|
| Dashboard | Training progress, skill level, monitoring alerts, rack health, work orders, recent activity |
| Virtual Data Center | 3D hall (raised floor, hot/cold aisles, trays, busway, CRAH, CDU and coolant lines), camera presets, rack selection; 2D floor-plan fallback without WebGL |
| Rack Explorer | Front/rear elevations, U numbering, LEDs, ports, 0U PDUs, placement checks, mount from inventory, equipment details (components, ports, power path, BMC SEL), port inspector with the unplug → cable-in-hand → re-plug workflow |
| Hardware Lab | Top-down chassis view, lid open/close, component inspection and hot-/cold-swap with compatibility rules |
| Network Lab | Switch port summaries, full patch schedule with problem filter |
| GPU Diagnostics | Driver-channel GPU telemetry (XID, ECC, NVLink, throttling), NVLink domain matrix for NVL72 racks |
| Cooling & Power | Feeds, PDUs, busbars, CDU loops, CRAH setpoint control |
| Work Orders | Six tickets. Start injects the hidden fault; validation is evaluated against the engine |
| Settings | Training mode, developer mode with fault injection (19 fault types), reset |
| Technician laptop (top bar) | Crash cart with RJ45 / USB / USB-C power ports; network settings (DHCP, static, VLAN tag), ping, SSH, a browser with the BMC web UI, and a serial console. Everything depends on real cabling, VLANs, IPs and the firewall |
| Cabling (Rack Explorer) | Cable tray with drag-and-drop onto ports (refusals explained by the engine), cable rendering, VLAN editing on switch ports, drag servers onto free U |

New in Phase 2: try **DCT-0008**. Drag a Cat6 cable from the cable tray onto the laptop's eth0
port (below the rack in Rack Explorer), then drag the cable-in-hand chip onto a free OOB switch
port. Open **Laptop** in the top bar and SSH to `dh1-r05-gb200-ct01-bmc`. Then try **DCT-0007**:
a BMC whose link LED is green but that nobody can reach.

Try the seeded ticket **DCT-0002**: dh1-r02-n04 lost power redundancy. Find it from the
dashboard alert, switch Rack Explorer to the rear view, select the empty PSU 2 inlet, connect a
C13/C14 cord from inventory, plug it into the B-side PDU, then validate the ticket.

## Repository map

```
PROJECT_PLAN.md            goals, scope, technology decisions, risks
ARCHITECTURE.md            layers, engine design, data flow, extension points
SIMULATION_SPEC.md         every simulation rule (states, power, thermal, links, faults)
IMPLEMENTATION_ROADMAP.md  phase checklist
docs/ASSUMPTIONS.md        accuracy policy, sources, simplifications, limitations
frontend/                  React 19 + TS + Vite + Tailwind v4 + R3F + Zustand
  src/simulation/          framework-free engine (core, hardware, networking, power, cooling, diagnostics, scenario)
  src/data/                catalogs: hardware, cables, faults, work orders, learning modules
  src/components, pages, scenes, stores
  e2e/                     Playwright specs
backend/                   FastAPI + SQLAlchemy + pytest
```

## Content accuracy

Hardware models are clearly labelled **educational reference models**. Only widely published
top-level figures (for example 72 GPUs per GB200 NVL72, 288 GB HBM3e per Blackwell Ultra GPU)
are tagged *verified*, with their source. Power, thermal and timing behaviour are simplified
teaching models and must not be used for facility design. Details are in
`docs/ASSUMPTIONS.md`.
