/**
 * Learner progress, persisted in localStorage (backend sync arrives with Phase 6).
 * Work-order runs are bound to the per-tab SESSION_ID: the simulation survives
 * reloads of the same tab, but a new tab starts a fresh scenario, so runs from
 * another session fall back to Open.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SESSION_ID } from '@/simulation/core/persistence';

export type WorkOrderStatus = 'open' | 'in_progress' | 'pending_validation' | 'resolved' | 'closed';

export interface WorkOrderRun {
  status: WorkOrderStatus;
  startedAtSimMs?: number;
  resolvedInMs?: number;
  validations: number;
  /** Session the run belongs to; runs from another session revert to open. */
  session?: string;
}

export interface ActivityEntry {
  at: number;
  text: string;
}

interface ProgressStore {
  learnerName: string;
  modulesCompleted: string[];
  workOrders: Record<string, WorkOrderRun>;
  mistakes: Record<string, number>;
  actions: number;
  activity: ActivityEntry[];
  toggleModule: (id: string) => void;
  setRun: (id: string, run: Partial<WorkOrderRun>) => void;
  recordMistake: (code: string) => void;
  recordAction: () => void;
  log: (text: string) => void;
  resetProgress: () => void;
  setLearnerName: (name: string) => void;
  /** Simulation was reset: in-progress tickets no longer have their scenario. */
  abandonRuns: () => void;
}

export { SESSION_ID } from '@/simulation/core/persistence';

export const useProgressStore = create<ProgressStore>()(
  persist(
    (set) => ({
      learnerName: 'Technician',
      modulesCompleted: [],
      workOrders: {},
      mistakes: {},
      actions: 0,
      activity: [],
      toggleModule: (id) =>
        set((st) => {
          const done = st.modulesCompleted.includes(id);
          return {
            modulesCompleted: done ? st.modulesCompleted.filter((m) => m !== id) : [...st.modulesCompleted, id],
            activity: [{ at: Date.now(), text: `${done ? 'Reopened' : 'Completed'} module ${id}` }, ...st.activity].slice(0, 50),
          };
        }),
      setRun: (id, run) =>
        set((st) => {
          const prev: WorkOrderRun = st.workOrders[id] ?? { validations: 0, status: 'open' };
          return { workOrders: { ...st.workOrders, [id]: { ...prev, ...run } } };
        }),
      recordMistake: (code) => set((st) => ({ mistakes: { ...st.mistakes, [code]: (st.mistakes[code] ?? 0) + 1 } })),
      recordAction: () => set((st) => ({ actions: st.actions + 1 })),
      log: (text) => set((st) => ({ activity: [{ at: Date.now(), text }, ...st.activity].slice(0, 50) })),
      resetProgress: () => set({ modulesCompleted: [], workOrders: {}, mistakes: {}, actions: 0, activity: [] }),
      setLearnerName: (learnerName) => set({ learnerName: learnerName.trim().slice(0, 40) || 'Technician' }),
      abandonRuns: () =>
        set((st) => ({
          workOrders: Object.fromEntries(
            Object.entries(st.workOrders).map(([id, r]) => [id, r.status === 'in_progress' || r.status === 'pending_validation' ? { ...r, status: 'open' as const, session: undefined } : r]),
          ),
        })),
    }),
    {
      name: 'dct-sim-progress',
      // In-progress runs belong to a simulation session that no longer exists after reload.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        for (const [id, run] of Object.entries(state.workOrders)) {
          if ((run.status === 'in_progress' || run.status === 'pending_validation') && run.session !== SESSION_ID) {
            state.workOrders[id] = { ...run, status: 'open', session: undefined };
          }
        }
      },
    },
  ),
);

export function effectiveStatus(run: WorkOrderRun | undefined): WorkOrderStatus {
  if (!run) return 'open';
  if ((run.status === 'in_progress' || run.status === 'pending_validation') && run.session !== SESSION_ID) return 'open';
  return run.status;
}

export interface SkillLevel {
  level: number;
  title: string;
  points: number;
  next: number;
}

const TITLES = ['Trainee', 'DCT I', 'DCT II', 'DCT III', 'Senior DCT', 'Lead DCT'];

export function skillLevel(modules: number, resolved: number): SkillLevel {
  const points = modules * 50 + resolved * 150;
  const thresholds = [0, 150, 450, 900, 1500, 2200];
  let level = 0;
  for (let i = 0; i < thresholds.length; i++) if (points >= thresholds[i]) level = i;
  return { level, title: TITLES[level], points, next: thresholds[level + 1] ?? points };
}
