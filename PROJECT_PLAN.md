# DCT Simulator — Project Plan

**DCT Simulator** is a browser-based Data Center Technician virtual lab. Learners work inside a
simulated AI data hall: they inspect racks, handle server hardware, follow cable paths, read
diagnostics and close work orders. A deterministic simulation engine sits underneath all of it,
and every screen reads its state from that engine.

Core philosophy: **learn by doing · inspect before replacing · diagnose before repairing ·
validate before closing the ticket.**

## 1. Goals

| # | Goal | Measure of success |
|---|------|--------------------|
| G1 | Realistic hands-on practice for DCT tasks | Every important action changes simulation state and has visible consequences |
| G2 | One source of truth | UI, terminal, diagnostics and work orders never disagree about the hardware |
| G3 | Teach troubleshooting *reasoning* | Scenarios hide root causes; scoring rewards evidence-driven diagnosis |
| G4 | Technical integrity | Content is tagged *verified*, *industry practice*, *simplified* or *hypothetical* |
| G5 | Room to grow | New hardware, faults, commands and scenarios are added as data or isolated modules |

## 2. Non-goals

- Copying vendor service manuals, proprietary procedures or exact internal layouts of OEM
  GB200/GB300 systems. Hardware models are clearly labelled educational reference models.
- Facility engineering. The power and thermal models are simplified, documented teaching
  models and must not be used for real facility design or safety certification.
- Running real commands. The terminal is a deterministic simulation; nothing executes on the
  host machine.

## 3. Target users

1. **Beginners**: Guided Learning mode with step-by-step instructions and highlighted objects.
2. **Intermediate technicians**: Practice Lab with problems, optional hints and evaluation.
3. **Advanced technicians**: Realistic Incident mode with hidden root causes, several
   symptoms, time pressure and no hints.

## 4. Scope by phase

Each phase is a working increment. See `IMPLEMENTATION_ROADMAP.md` for the detailed task lists.

| Phase | Theme | Status |
|-------|-------|--------|
| 1 | Interactive foundation: shell, dashboard, 3D data hall, rack explorer, hardware inspection, simulation engine | **Implemented** |
| 2 | Physical interaction: mounting, component swaps, cable inventory, drag-and-drop cabling, laptop ports | Engine actions done; UI planned |
| 3 | Virtual terminal: xterm.js, parser, simulated filesystem, Linux/NVIDIA commands, SSH | Planned |
| 4 | GPU diagnostics: DCGM simulation, XID/ECC, PCIe/NVLink diagnostics, fault scenarios | Partly in engine (faults and telemetry) |
| 5 | Network, cooling and power: topology, switches, network faults, liquid cooling, power model | Partly in engine (power and thermal derivation) |
| 6 | Work orders and training: ticket lifecycle, guided/practice/assessment modes, scoring, progress | Data model and read-only UI |

## 5. Technology decisions

| Concern | Choice | Reason |
|---------|--------|--------|
| UI | React 19 + TypeScript (strict) + Vite | Required stack; fast HMR; strict types for simulation entities |
| Styling | Tailwind CSS v4, shadcn/ui-style components written into the repo | Same approach as shadcn (components live in the repo) without an interactive CLI step |
| Icons | lucide-react | Required stack |
| 3D | three + @react-three/fiber + drei | Declarative scene graph; `frameloop="demand"` keeps the GPU idle when nothing changes |
| Physics | none (rapier not installed) | Rack mounting and cabling are rule-based snapping, so no rigid-body physics is needed |
| State | Zustand around a framework-free engine | The engine runs headless in tests; Zustand only mirrors snapshots to React |
| Immutability | Working copy + `reconcile` snapshots (no library) | Structural sharing keeps memoized 3D and React subtrees stable. Measured ~20× faster than immer for this entity count |
| Routing | react-router | Deep links such as `/racks/R05` and route-level Playwright tests |
| Backend | FastAPI + Pydantic + SQLAlchemy (SQLite now, PostgreSQL-compatible) | Required stack; progress persistence and scenario catalog |
| Tests | Vitest + React Testing Library, Playwright (uses the installed Edge or Chrome channel) | Required stack; no browser download needed |
| Persistence | sessionStorage (simulation), localStorage (progress) | A reload resumes the lab; the backend takes over progress in Phase 6 |

## 6. Technical risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Simulation logic leaking into components | UI contradicts engine | Components only call `dispatch()` and selectors; derivation rules live in `src/simulation/**` and are unit-tested |
| Entity count (~1,750 components, ~1,800 ports, ~440 cables) slowing ticks | Janky UI | 2 Hz tick; mutable working copy + reconcile snapshots (~12 ms/tick measured); values rounded so derivation reaches a fixed point; memoized selectors. Web Worker offload if later phases need it |
| WebGL unavailable (VMs, remote desktops, some CI) | Data hall unusable | WebGL detection plus a 2D SVG floor-plan fallback that offers the same navigation |
| 3D canvas hard to test end to end | Untested critical flows | Every 3D interaction also has an accessible DOM control (rack list), and Playwright drives those |
| Fabricated vendor specifications | Loss of credibility, misinformation | Accuracy tags on every catalog entry; only widely published top-level facts are marked *verified*; everything else is labelled *reference* or *simplified* |
| Scope creep (the full brief spans 6 large phases) | Nothing finished | Ship complete vertical increments; extension points are documented rather than stubbed in the UI |
| Terminal realism vs. determinism | Learners exploit inconsistent output | Phase 3 commands are pure functions of `SimulationState`; output is snapshot-tested |
| Physical-world timing (boot times, thermal inertia) making tests slow | Slow or flaky tests | The engine clock is injectable; tests call `engine.advance(ms)` deterministically |

## 7. Quality bar

- `npm run typecheck`, `npm test` and `npm run build` pass before a phase is called done.
- Every new simulation rule ships with unit tests.
- UI screens have loading, empty and error states, and no control without behaviour. Screens
  scheduled for later phases say so plainly instead of showing fake controls.
