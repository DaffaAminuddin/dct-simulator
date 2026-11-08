/**
 * UI-only state: selection, view options, developer mode, toasts and the
 * "cable in hand" interaction. Never holds simulation state.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Id } from '@/types/simulation';

export type TrainingMode = 'guided' | 'practice' | 'incident';
export type RackSide = 'front' | 'rear';

export interface Toast {
  id: number;
  tone: 'ok' | 'warn' | 'crit' | 'info';
  title: string;
  detail?: string;
}

export interface CableInHand {
  cableId: Id;
  /** The end still free (to be plugged next); null = fresh from the tray, both ends free. */
  freeEnd: 0 | 1 | null;
}

export type LaptopApp = 'home' | 'network' | 'ping' | 'ssh' | 'browser' | 'console';

interface UiStore {
  selectedRackId: Id;
  selectedEquipmentId: Id | null;
  selectedComponentId: Id | null;
  selectedPortId: Id | null;
  rackSide: RackSide;
  devMode: boolean;
  trainingMode: TrainingMode;
  sidebarOpen: boolean;
  dataHallView: '3d' | '2d';
  cableInHand: CableInHand | null;
  showCables: boolean;
  laptopOpen: boolean;
  laptopApp: LaptopApp;
  toasts: Toast[];
  selectRack: (id: Id) => void;
  selectEquipment: (id: Id | null, rackId?: Id) => void;
  selectComponent: (id: Id | null) => void;
  selectPort: (id: Id | null) => void;
  setRackSide: (side: RackSide) => void;
  setDevMode: (on: boolean) => void;
  setTrainingMode: (m: TrainingMode) => void;
  setSidebarOpen: (open: boolean) => void;
  setDataHallView: (v: '3d' | '2d') => void;
  setCableInHand: (c: CableInHand | null) => void;
  setShowCables: (on: boolean) => void;
  setLaptopOpen: (open: boolean) => void;
  openLaptopApp: (app: LaptopApp) => void;
  notify: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  clearSelection: () => void;
}

let toastSeq = 0;

export const useUiStore = create<UiStore>()(
  persist(
    (set) => ({
      selectedRackId: 'R01',
      selectedEquipmentId: null,
      selectedComponentId: null,
      selectedPortId: null,
      rackSide: 'front',
      devMode: false,
      trainingMode: 'practice',
      sidebarOpen: false,
      dataHallView: '3d',
      cableInHand: null,
      showCables: true,
      laptopOpen: false,
      laptopApp: 'home',
      toasts: [],
      selectRack: (id) => set((st) => (st.selectedRackId === id ? st : { selectedRackId: id, selectedEquipmentId: null, selectedPortId: null })),
      selectEquipment: (id, rackId) =>
        set((st) => ({
          selectedEquipmentId: id,
          selectedRackId: rackId ?? st.selectedRackId,
          selectedComponentId: null,
          selectedPortId: null,
        })),
      selectComponent: (id) => set({ selectedComponentId: id }),
      selectPort: (id) => set({ selectedPortId: id }),
      setRackSide: (rackSide) => set({ rackSide }),
      setDevMode: (devMode) => set({ devMode }),
      setTrainingMode: (trainingMode) => set({ trainingMode }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setDataHallView: (dataHallView) => set({ dataHallView }),
      setCableInHand: (cableInHand) => set({ cableInHand }),
      setShowCables: (showCables) => set({ showCables }),
      setLaptopOpen: (laptopOpen) => set({ laptopOpen }),
      openLaptopApp: (laptopApp) => set({ laptopApp, laptopOpen: true }),
      notify: (t) => {
        const id = ++toastSeq;
        set((st) => ({ toasts: [...st.toasts.slice(-3), { ...t, id }] }));
        setTimeout(() => set((st) => ({ toasts: st.toasts.filter((x) => x.id !== id) })), t.tone === 'crit' ? 7000 : 4500);
      },
      dismiss: (id) => set((st) => ({ toasts: st.toasts.filter((x) => x.id !== id) })),
      clearSelection: () => set({ selectedEquipmentId: null, selectedComponentId: null, selectedPortId: null }),
    }),
    {
      name: 'dct-sim-ui',
      partialize: (st) => ({ devMode: st.devMode, trainingMode: st.trainingMode, rackSide: st.rackSide, dataHallView: st.dataHallView, showCables: st.showCables }),
    },
  ),
);
