/**
 * Per-tab persistence: the simulation survives a page reload (sessionStorage),
 * but a new tab or window starts a fresh scenario. In-progress work orders are
 * bound to SESSION_ID, so they stay valid exactly when the state is restored.
 */
import type { SimulationState } from '@/types/simulation';

const STATE_KEY = 'dct-sim-state';
const SESSION_KEY = 'dct-sim-session';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function read(): SimulationState | null {
  const st = storage();
  if (!st) return null;
  try {
    const raw = st.getItem(STATE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SimulationState;
    if (s?.schemaVersion !== 2 || !s.workstation || !s.equipment || !s.components || !s.ports) return null;
    return s;
  } catch {
    return null;
  }
}

function newSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const restoredState: SimulationState | null = read();

export const SESSION_ID: string = (() => {
  const st = storage();
  try {
    const existing = st?.getItem(SESSION_KEY);
    if (restoredState && existing) return existing;
    const id = newSessionId();
    st?.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return newSessionId();
  }
})();

export function saveState(s: SimulationState): void {
  try {
    storage()?.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    // Quota exceeded or storage disabled: persistence is best-effort.
  }
}

export function clearSavedState(): void {
  try {
    storage()?.removeItem(STATE_KEY);
  } catch {
    // ignore
  }
}
