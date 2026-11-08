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

export type Theme = 'light' | 'dark';

export type LaptopApp = 'home' | 'terminal' | 'network' | 'ping' | 'ssh' | 'browser' | 'console';

/**
 * What each page had open last time. Persisted, so leaving a page (or
 * reloading) and coming back resumes the work instead of resetting it.
 */
export interface PageMemory {
  workOrderId: string | null;
  moduleId: string | null;
  hardwareEquipmentId: Id | null;
  hardwareSlotId: string | null;
  gpuNodeId: Id | null;
  networkQuery: string;
  networkMedia: string;
  networkProblemsOnly: boolean;
  dataHallPreset: string;
  dataHallRackId: Id | null;
  dataHallUnitId: Id | null;
  equipmentTab: string;
  inventoryTab: string;
  dashboardScope: string;
  dashboardWindow: string;
}

export const PAGE_DEFAULTS: PageMemory = {
  workOrderId: null,
  moduleId: null,
  hardwareEquipmentId: null,
  hardwareSlotId: null,
  gpuNodeId: null,
  networkQuery: '',
  networkMedia: 'all',
  networkProblemsOnly: false,
  dataHallPreset: 'overview',
  dataHallRackId: null,
  dataHallUnitId: null,
  equipmentTab: 'overview',
  inventoryTab: 'components',
  dashboardScope: 'all',
  dashboardWindow: '900000',
};

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
  theme: Theme;
  page: PageMemory;
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
  setTheme: (t: Theme) => void;
  setPage: (patch: Partial<PageMemory>) => void;
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
      theme: 'light',
      page: PAGE_DEFAULTS,
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
      setTheme: (theme) => set({ theme }),
      setPage: (patch) => set((st) => (Object.entries(patch).every(([k, v]) => st.page[k as keyof PageMemory] === v) ? st : { page: { ...st.page, ...patch } })),
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
      partialize: (st) => ({
        devMode: st.devMode,
        trainingMode: st.trainingMode,
        rackSide: st.rackSide,
        dataHallView: st.dataHallView,
        showCables: st.showCables,
        theme: st.theme,
        selectedRackId: st.selectedRackId,
        selectedEquipmentId: st.selectedEquipmentId,
        selectedComponentId: st.selectedComponentId,
        selectedPortId: st.selectedPortId,
        laptopApp: st.laptopApp,
        page: st.page,
      }),
      // Fields added in later versions keep their defaults.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiStore>;
        return { ...current, ...p, page: { ...current.page, ...(p.page ?? {}) } };
      },
    },
  ),
);
