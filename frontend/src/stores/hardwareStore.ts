/**
 * Hardware selectors and the `useAct` dispatcher. Holds no state of its own:
 * everything is derived from the simulation snapshot, so views cannot
 * contradict the engine.
 */
import { useCallback, useMemo } from 'react';
import type { ActionResult, Equipment, Id, SimAction } from '@/types/simulation';
import { useProgressStore } from './progressStore';
import { useSim, useSimulationStore } from './simulationStore';
import { useUiStore } from './uiStore';

export const useEquipment = (id: Id | null | undefined) => useSim((s) => (id ? s.equipment[id] : undefined));
export const useRack = (id: Id | null | undefined) => useSim((s) => (id ? s.racks[id] : undefined));
export const useComponent = (id: Id | null | undefined) => useSim((s) => (id ? s.components[id] : undefined));
export const usePort = (id: Id | null | undefined) => useSim((s) => (id ? s.ports[id] : undefined));
export const useDevMode = () => useUiStore((s) => s.devMode);

/** Equipment in a rack; recomputed only when some equipment changes. */
export function useRackEquipment(rackId: Id): Equipment[] {
  const equipment = useSim((s) => s.equipment);
  return useMemo(() => Object.values(equipment).filter((e) => e.location.kind === 'rack' && e.location.rackId === rackId), [equipment, rackId]);
}

const LEARNER_CODES_IGNORED = new Set(['FAULT_EXISTS', 'BAD_TARGET', 'UNKNOWN_FAULT']);

/** Dispatch an action, surface errors and warnings as toasts, and record mistakes. */
export function useAct() {
  const notify = useUiStore((s) => s.notify);
  return useCallback(
    (action: SimAction, success?: string): ActionResult => {
      const r = useSimulationStore.getState().dispatch(action);
      const progress = useProgressStore.getState();
      progress.recordAction();
      if (!r.ok) {
        notify({ tone: 'crit', title: 'Action refused', detail: r.message });
        if (!LEARNER_CODES_IGNORED.has(r.code)) progress.recordMistake(r.code);
      } else {
        for (const w of r.warnings) notify({ tone: 'warn', title: 'Warning', detail: w });
        if (success) notify({ tone: 'ok', title: success });
      }
      return r;
    },
    [notify],
  );
}
