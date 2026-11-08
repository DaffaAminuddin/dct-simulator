/**
 * Learner progress, persisted in localStorage (backend sync arrives with Phase 6).
 *
 * Two different things are tracked:
 * - Ticket status (`workOrders`) describes the CURRENT simulation. It is bound
 *   to the per-tab SESSION_ID and is reopened when the simulation is reset,
 *   because a reset (or a new tab) rebuilds the hall with every scenario
 *   problem back in place.
 * - Completions (`completed`) are the learner's record: how often a ticket
 *   was resolved and the best time. They survive resets and drive points.
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

/** A learner's record for one ticket, kept across simulation resets. */
export interface Completion {
  count: number;
  bestMs?: number;
  lastMs?: number;
  /** Wall-clock time of the last completion. */
  lastAt: number;
}

export interface ActivityEntry {
  at: number;
  text: string;
}

interface ProgressStore {
  learnerName: string;
  modulesCompleted: string[];
  workOrders: Record<string, WorkOrderRun>;
  completed: Record<string, Completion>;
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
  /** Simulation was reset: every ticket goes back to Open; completions are kept. */
  reopenTickets: () => void;
}

export { SESSION_ID } from '@/simulation/core/persistence';

export const useProgressStore = create<ProgressStore>()(
  persist(
    (set) => ({
      learnerName: 'Technician',
      modulesCompleted: [],
      workOrders: {},
      completed: {},
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
          const next = { ...prev, ...run };
          const justResolved = run.status === 'resolved' && effectiveStatus(prev) !== 'resolved';
          return { workOrders: { ...st.workOrders, [id]: next }, ...(justResolved ? { completed: withCompletion(st.completed, id, next.resolvedInMs) } : {}) };
        }),
      recordMistake: (code) => set((st) => ({ mistakes: { ...st.mistakes, [code]: (st.mistakes[code] ?? 0) + 1 } })),
      recordAction: () => set((st) => ({ actions: st.actions + 1 })),
      log: (text) => set((st) => ({ activity: [{ at: Date.now(), text }, ...st.activity].slice(0, 50) })),
      resetProgress: () => set({ modulesCompleted: [], workOrders: {}, completed: {}, mistakes: {}, actions: 0, activity: [] }),
      setLearnerName: (learnerName) => set({ learnerName: learnerName.trim().slice(0, 40) || 'Technician' }),
      reopenTickets: () =>
        set((st) => {
          let completed = st.completed;
          for (const [id, r] of Object.entries(st.workOrders)) completed = keepRecord(completed, id, r);
          return { workOrders: Object.fromEntries(Object.entries(st.workOrders).map(([id, r]) => [id, reopened(r)])), completed };
        }),
    }),
    {
      name: 'dct-sim-progress',
      // Ticket status belongs to the simulation of one tab; another tab starts a fresh hall.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.completed ??= {};
        for (const [id, run] of Object.entries(state.workOrders)) {
          if (run.status !== 'open' && run.session !== SESSION_ID) {
            state.completed = keepRecord(state.completed, id, run);
            state.workOrders[id] = reopened(run);
          }
        }
      },
    },
  ),
);

function withCompletion(completed: Record<string, Completion>, id: string, ms: number | undefined): Record<string, Completion> {
  const prev = completed[id];
  const bestMs = ms === undefined ? prev?.bestMs : prev?.bestMs === undefined ? ms : Math.min(prev.bestMs, ms);
  return { ...completed, [id]: { count: (prev?.count ?? 0) + 1, bestMs, lastMs: ms, lastAt: Date.now() } };
}

/** Make sure a resolved / closed run is on the learner's record (runs saved before completions existed). */
function keepRecord(completed: Record<string, Completion>, id: string, run: WorkOrderRun): Record<string, Completion> {
  if ((run.status === 'resolved' || run.status === 'closed') && !completed[id]) return withCompletion(completed, id, run.resolvedInMs);
  return completed;
}

const reopened = (run: WorkOrderRun): WorkOrderRun => ({ validations: run.validations ?? 0, status: 'open' });

/** Ticket status in the current simulation (runs from another tab's simulation read as Open). */
export function effectiveStatus(run: WorkOrderRun | undefined): WorkOrderStatus {
  if (!run) return 'open';
  if (run.status !== 'open' && run.session !== SESSION_ID) return 'open';
  return run.status;
}

/** Distinct tickets the learner has ever resolved (out of `ids`). */
export function completedCount(completed: Record<string, Completion>, ids: string[]): number {
  return ids.filter((id) => completed[id]).length;
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
