/**
 * SimulationEngine: the single source of truth for hardware, power, cooling,
 * network and diagnostic state. Framework-free; React mirrors its snapshots.
 *
 * Internally the engine mutates a private working copy and publishes
 * immutable snapshots via `reconcile` (see snapshot.ts). Snapshots must be
 * treated as read-only by consumers.
 */
import { integrateTemperatures, settleTemperatures } from '@/simulation/cooling/ThermalModel';
import { appendEvents, diffForEvents, type EventDraft } from '@/simulation/diagnostics/HealthMonitor';
import { advanceBoot, checkThermalTrips } from '@/simulation/hardware/Server';
import type { ActionResult, SimAction, SimEvent, SimulationState } from '@/types/simulation';
import { handleAction } from './actions';
import { derive } from './derive';
import { EventBus } from './EventBus';
import { deepClone, reconcile } from './snapshot';
import { SimError } from './util';

export interface EngineEvents extends Record<string, unknown> {
  change: SimulationState;
  event: SimEvent;
  action: { action: SimAction; result: ActionResult };
}

export type StateListener = (state: SimulationState) => void;

/**
 * Largest simulated step per derivation pass during advance(). Bounded so the
 * thermal-throttle feedback loop stays numerically stable at high sim speeds.
 */
export const MAX_STEP_MS = 2000;

export class SimulationEngine {
  private work: SimulationState;
  private snapshot: SimulationState;
  readonly bus = new EventBus<EngineEvents>();

  constructor(initial: SimulationState, opts: { restore?: boolean } = {}) {
    // A restored state keeps its temperatures and timers; a fresh scenario is settled.
    const work = deepClone(initial);
    if (opts.restore) derive(work);
    this.work = opts.restore ? work : SimulationEngine.settle(work);
    this.snapshot = reconcile(null, this.work);
  }

  /** Derive a fresh scenario to a steady condition (temperatures at equilibrium). */
  static settle(s: SimulationState): SimulationState {
    // Fan duty ↔ power demand ↔ temperature form a feedback loop that converges
    // geometrically; a handful of passes reaches a fixed point.
    for (let i = 0; i < 8; i++) {
      derive(s);
      settleTemperatures(s);
    }
    derive(s);
    return s;
  }

  getState(): SimulationState {
    return this.snapshot;
  }

  reset(initial: SimulationState): void {
    this.work = SimulationEngine.settle(deepClone(initial));
    this.snapshot = reconcile(null, this.work);
    this.bus.emit('change', this.snapshot);
  }

  subscribe(listener: StateListener): () => void {
    return this.bus.on('change', listener);
  }

  dispatch(action: SimAction): ActionResult {
    const prev = this.snapshot;
    let warnings: string[];
    let events: EventDraft[];
    try {
      const r = handleAction(this.work, action);
      warnings = r.warnings;
      events = r.events;
    } catch (err) {
      // Handlers validate before mutating, but restore defensively on failure.
      this.work = deepClone(prev);
      if (err instanceof SimError) {
        const result: ActionResult = { ok: false, code: err.code, message: err.message };
        this.bus.emit('action', { action, result });
        return result;
      }
      throw err;
    }
    derive(this.work);
    this.commit(prev, events);
    const result: ActionResult = { ok: true, warnings };
    this.bus.emit('action', { action, result });
    return result;
  }

  /** Advance simulated time by `ms` (boot timers, thermal integration, trips). */
  advance(ms: number): void {
    if (ms <= 0) return;
    const prev = this.snapshot;
    const tripEvents: EventDraft[] = [];
    const steps = Math.max(1, Math.ceil(ms / MAX_STEP_MS));
    const dt = ms / steps;
    const s = this.work;
    for (let i = 0; i < steps; i++) {
      s.timeMs += dt;
      integrateTemperatures(s, dt);
      advanceBoot(s, dt);
      for (const eq of checkThermalTrips(s)) {
        tripEvents.push({
          severity: 'critical',
          category: 'thermal',
          message: `${eq.hostname}: thermal trip, host powered off to protect hardware`,
          equipmentId: eq.id,
          channels: ['bmc', 'led'],
        });
      }
      derive(s);
    }
    this.commit(prev, tripEvents);
  }

  private commit(prev: SimulationState, extra: EventDraft[]): void {
    let next = reconcile(prev, this.work);
    const drafts = [...extra, ...diffForEvents(prev, next)];
    if (drafts.length > 0) {
      const firstNew = this.work.seq.event + 1;
      appendEvents(this.work, drafts);
      next = reconcile(next, this.work);
      for (const e of next.events) if (e.id >= firstNew) this.bus.emit('event', e);
    }
    this.snapshot = next;
    if (next !== prev) this.bus.emit('change', next);
  }
}
