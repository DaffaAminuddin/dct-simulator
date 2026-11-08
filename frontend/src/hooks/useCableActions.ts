/**
 * Physical cable workflow shared by click and drag-and-drop interactions:
 * pick a cable from the tray, plug an end into a port, unplug an end. Every
 * plug goes through the engine, which validates connector fit and length.
 */
import { useCallback } from 'react';
import { getCableModel } from '@/data/cables/cableCatalog';
import { checkFit } from '@/simulation/networking/Cable';
import { useAct } from '@/stores/hardwareStore';
import { getSim } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import type { Id, SimulationState } from '@/types/simulation';

export const CABLE_MIME = 'text/x-dct-cable';
export const EQUIPMENT_MIME = 'text/x-dct-equipment';

/** Which end of a cable would go into this port (null = neither fits / none free). */
export function endFor(s: SimulationState, cableId: Id, portId: Id): { end: 0 | 1 | null; reason?: string } {
  const cable = s.cables[cableId];
  const port = s.ports[portId];
  if (!cable || !port) return { end: null, reason: 'Unknown cable or port' };
  if (port.cableId) return { end: null, reason: `${port.label} already has a cable` };
  const model = getCableModel(cable.modelId);
  const free = ([0, 1] as const).filter((e) => !cable.ends[e].portId);
  if (free.length === 0) return { end: null, reason: 'Both ends of this cable are already plugged in' };
  let lastReason: string | undefined;
  for (const e of free) {
    const fit = checkFit(port, model.ends[e]);
    if (fit.ok) return { end: e };
    lastReason = fit.reason;
  }
  return { end: null, reason: lastReason };
}

export function freeCableOfModel(s: SimulationState, modelId: string): Id | undefined {
  return Object.values(s.cables).find((c) => c.modelId === modelId && !c.ends[0].portId && !c.ends[1].portId)?.id;
}

export function useCableActions() {
  const act = useAct();
  const setInHand = useUiStore((st) => st.setCableInHand);
  const notify = useUiStore((st) => st.notify);

  /** Plug a cable (by id) into a port, choosing the end that fits. */
  const plug = useCallback(
    (cableId: Id, portId: Id): boolean => {
      const s = getSim();
      const hand = useUiStore.getState().cableInHand;
      let end: 0 | 1 | null;
      if (hand && hand.cableId === cableId && hand.freeEnd !== null) end = hand.freeEnd;
      else {
        const r = endFor(s, cableId, portId);
        if (r.end === null) {
          // Let the engine produce the authoritative refusal (and record the mistake).
          const free = s.cables[cableId]?.ends[0].portId ? 1 : 0;
          act({ type: 'cable/connect', cableId, end: free, portId });
          return false;
        }
        end = r.end;
      }
      const port = s.ports[portId];
      const res = act({ type: 'cable/connect', cableId, end, portId }, `Plugged ${getCableModel(s.cables[cableId].modelId).shortName} into ${port?.label ?? portId}`);
      if (!res.ok) return false;
      const after = getSim().cables[cableId];
      const other = end === 0 ? 1 : 0;
      setInHand(after.ends[other].portId ? null : { cableId, freeEnd: other });
      return true;
    },
    [act, setInHand],
  );

  /** Pick a fresh cable of this model from the spares cage. */
  const pickUp = useCallback(
    (modelId: string) => {
      const id = freeCableOfModel(getSim(), modelId);
      if (!id) {
        notify({ tone: 'warn', title: 'Out of stock', detail: `No ${getCableModel(modelId).shortName} left in the spares cage` });
        return;
      }
      setInHand({ cableId: id, freeEnd: null });
      notify({ tone: 'info', title: `Picked up ${getCableModel(modelId).name}`, detail: 'Drag it onto a port, or select a port and choose "Plug in here".' });
    },
    [notify, setInHand],
  );

  /** Unplug the cable end sitting in this port and keep it in hand. */
  const unplug = useCallback(
    (portId: Id) => {
      const s = getSim();
      const port = s.ports[portId];
      if (!port?.cableId || port.cableEnd === null) return;
      const cable = s.cables[port.cableId];
      const end = port.cableEnd;
      const res = act({ type: 'cable/disconnect', cableId: cable.id, end }, `Unplugged ${getCableModel(cable.modelId).shortName} from ${port.label}`);
      if (res.ok) {
        const other = end === 0 ? 1 : 0;
        setInHand({ cableId: cable.id, freeEnd: getSim().cables[cable.id].ends[other].portId ? end : null });
      }
    },
    [act, setInHand],
  );

  /** Put a cable back in the spares cage (unplug any end still attached). */
  const stow = useCallback(
    (cableId: Id) => {
      const s = getSim();
      for (const e of [0, 1] as const) {
        if (s.cables[cableId]?.ends[e].portId) act({ type: 'cable/disconnect', cableId, end: e });
      }
      setInHand(null);
    },
    [act, setInHand],
  );

  return { plug, pickUp, unplug, stow };
}

// ---------------------------------------------------------------------------
// Drag state: browsers hide dataTransfer contents during dragover, so the
// current drag payload is tracked here for drop-target feedback.
// ---------------------------------------------------------------------------
export type DragPayload = { kind: 'cable'; cableId: Id } | { kind: 'equipment'; equipmentId: Id } | null;
let currentDrag: DragPayload = null;
export function setDrag(p: DragPayload): void {
  currentDrag = p;
}
export function getDrag(): DragPayload {
  return currentDrag;
}
