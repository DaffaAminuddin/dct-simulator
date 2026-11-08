import { expect } from 'vitest';
import { SimulationEngine } from '@/simulation/core/SimulationEngine';
import { buildInitialState } from '@/simulation/scenario/buildInitialState';
import type { ActionResult, SimAction, SimulationState } from '@/types/simulation';

/** Fresh engine on the Data Hall 01 seed, optionally customised before settling. */
export function makeEngine(customise?: (s: SimulationState) => void): SimulationEngine {
  const s = buildInitialState();
  customise?.(s);
  return new SimulationEngine(s);
}

export function ok(engine: SimulationEngine, action: SimAction): Extract<ActionResult, { ok: true }> {
  const r = engine.dispatch(action);
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}

export function rejects(engine: SimulationEngine, action: SimAction, code: string): string {
  const r = engine.dispatch(action);
  expect(r.ok, `expected ${code}`).toBe(false);
  if (r.ok) return '';
  expect(r.code).toBe(code);
  return r.message;
}

export function advanceS(engine: SimulationEngine, seconds: number): void {
  for (let t = 0; t < seconds; t += 1) engine.advance(1000);
}

/** Cable id and end plugged into a port. */
export function cableAt(engine: SimulationEngine, portId: string): { cableId: string; end: 0 | 1 } {
  const p = engine.getState().ports[portId];
  if (!p?.cableId || p.cableEnd === null) throw new Error(`no cable at ${portId}`);
  return { cableId: p.cableId, end: p.cableEnd };
}

export function unplug(engine: SimulationEngine, portId: string): { cableId: string; end: 0 | 1 } {
  const c = cableAt(engine, portId);
  ok(engine, { type: 'cable/disconnect', cableId: c.cableId, end: c.end });
  return c;
}
