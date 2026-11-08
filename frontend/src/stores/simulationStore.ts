/**
 * Zustand mirror of the SimulationEngine. The engine owns all simulation
 * state; this store only holds the latest immutable snapshot plus clock
 * controls. Components read through selectors and write through dispatch().
 */
import { create } from 'zustand';
import { SimulationClock, type ClockSpeed } from '@/simulation/core/SimulationClock';
import { SimulationEngine } from '@/simulation/core/SimulationEngine';
import { clearSavedState, restoredState } from '@/simulation/core/persistence';
import { buildInitialState } from '@/simulation/scenario/buildInitialState';
import type { ActionResult, SimAction, SimulationState } from '@/types/simulation';

export const engine = restoredState ? new SimulationEngine(restoredState, { restore: true }) : new SimulationEngine(buildInitialState());
export const clock = new SimulationClock(engine);

interface SimulationStore {
  state: SimulationState;
  running: boolean;
  speed: ClockSpeed;
  /** Increments on reset so views can drop transient UI state. */
  epoch: number;
  dispatch: (action: SimAction) => ActionResult;
  setRunning: (running: boolean) => void;
  setSpeed: (speed: ClockSpeed) => void;
  skip: (ms: number) => void;
  reset: () => void;
}

export const useSimulationStore = create<SimulationStore>((set) => ({
  state: engine.getState(),
  running: false,
  speed: 1,
  epoch: 0,
  dispatch: (action) => engine.dispatch(action),
  setRunning: (running) => {
    if (running) clock.start();
    else clock.stop();
    set({ running });
  },
  setSpeed: (speed) => {
    clock.setSpeed(speed);
    set({ speed });
  },
  skip: (ms) => clock.skip(ms),
  reset: () => {
    clearSavedState();
    engine.reset(buildInitialState());
    set((st) => ({ epoch: st.epoch + 1 }));
  },
}));

engine.subscribe((state) => useSimulationStore.setState({ state }));

/** Select from the current simulation snapshot. Selectors must return stable references. */
export function useSim<T>(selector: (s: SimulationState) => T): T {
  return useSimulationStore((st) => selector(st.state));
}

/** Non-reactive access for event handlers. */
export function getSim(): SimulationState {
  return useSimulationStore.getState().state;
}
