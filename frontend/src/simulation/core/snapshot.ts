/**
 * Snapshot reconciliation.
 *
 * The engine mutates a private working copy in place (fast), then publishes an
 * immutable snapshot. `reconcile` reuses the previous snapshot's object for
 * every entity that did not change, so React/R3F selectors keep stable
 * references and skip re-rendering. Profiling showed this to be ~10× cheaper
 * than proxy-based immutability for ~4,000 entities.
 */
import type { SimulationState } from '@/types/simulation';

export function deepClone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = deepClone(v[i]);
    return out as T;
  }
  const out: Record<string, unknown> = {};
  for (const k in v as Record<string, unknown>) out[k] = deepClone((v as Record<string, unknown>)[k]);
  return out as T;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  let count = 0;
  for (const k in ao) {
    count++;
    if (!(k in bo)) {
      if (ao[k] === undefined) {
        count--;
        continue;
      }
      return false;
    }
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  let countB = 0;
  for (const k in bo) if (bo[k] !== undefined || k in ao) countB++;
  return count === countB;
}

const COLLECTIONS = ['racks', 'equipment', 'components', 'ports', 'cables', 'faults'] as const;
type CollectionKey = (typeof COLLECTIONS)[number];

function reconcileCollection<T>(prev: Record<string, T> | undefined, work: Record<string, T>): Record<string, T> {
  let changed = !prev;
  const out: Record<string, T> = {};
  let n = 0;
  for (const id in work) {
    n++;
    const p = prev?.[id];
    if (p !== undefined && deepEqual(p, work[id])) out[id] = p;
    else {
      out[id] = deepClone(work[id]);
      changed = true;
    }
  }
  if (!changed && prev) {
    let pn = 0;
    for (const _ in prev) pn++;
    if (pn !== n) changed = true;
  }
  return changed || !prev ? out : prev;
}

/** Build an immutable snapshot of `work`, sharing unchanged entities with `prev`. */
export function reconcile(prev: SimulationState | null, work: SimulationState): SimulationState {
  const next = {
    schemaVersion: work.schemaVersion,
    timeMs: work.timeMs,
    startedAt: work.startedAt,
    seq: prev && deepEqual(prev.seq, work.seq) ? prev.seq : { ...work.seq },
    facility: prev && deepEqual(prev.facility, work.facility) ? prev.facility : deepClone(work.facility),
    events: prev && prev.events.length === work.events.length && prev.events.at(-1)?.id === work.events.at(-1)?.id ? prev.events : work.events.map((e) => ({ ...e })),
  } as SimulationState;
  for (const key of COLLECTIONS) {
    (next as unknown as Record<CollectionKey, unknown>)[key] = reconcileCollection(
      prev?.[key] as Record<string, unknown> | undefined,
      work[key] as Record<string, unknown>,
    );
  }
  if (prev && COLLECTIONS.every((k) => next[k] === prev[k]) && next.facility === prev.facility && next.events === prev.events && next.seq === prev.seq && next.timeMs === prev.timeMs) {
    return prev;
  }
  return next;
}
