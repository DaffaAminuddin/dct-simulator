/**
 * Terminal store: the technician's terminal session (frame stack, history)
 * and its transcript. Every terminal view (Terminal page, laptop app)
 * renders the same transcript, so they always agree. Commands run through
 * the simulation engine; nothing executes on the host machine.
 */
import { create } from 'zustand';
import { complete, execute, type ExecEnv } from '@/simulation/terminal/CommandExecutor';
import { newSession, promptFor, validateSession } from '@/simulation/terminal/Session';
import type { TerminalSession } from '@/simulation/terminal/types';
import { useProgressStore } from './progressStore';
import { engine, useSimulationStore } from './simulationStore';

export interface Chunk {
  id: number;
  text: string;
}

const MAX_CHARS = 400_000;

const crlf = (lines: string[]) => lines.map((l) => l.replace(/\r?\n/g, '\r\n')).join('\r\n');

const env: ExecEnv = {
  getState: () => engine.getState(),
  dispatch: (action) => {
    useProgressStore.getState().recordAction();
    return useSimulationStore.getState().dispatch(action);
  },
};

const WELCOME = [
  '\x1b[1mDCT Simulator terminal\x1b[0m: tech-laptop (simulated Linux; nothing runs on your computer)',
  'Start with \x1b[36mhelp\x1b[0m or \x1b[36mcat README.txt\x1b[0m. Example: \x1b[36mssh admin@dh1-r01-n01-bmc\x1b[0m, then \x1b[36msol activate\x1b[0m.',
  '',
];

interface TerminalStore {
  session: TerminalSession;
  chunks: Chunk[];
  seq: number;
  /** Bumped when the screen is cleared. */
  clearSeq: number;
  prompt: () => string;
  /** Run a command line as if typed at the prompt. */
  submit: (line: string) => void;
  complete: (line: string) => { line: string; options: string[] };
  /** Clear the screen (Ctrl+L / `clear`). */
  clear: () => void;
  /** Close every remote hop and start over on the laptop. */
  resetSession: () => void;
  /** Re-check open connections against the simulation (called on state changes). */
  revalidate: () => void;
}

function appendChunk(chunks: Chunk[], seq: number, text: string): { chunks: Chunk[]; seq: number } {
  const next = [...chunks, { id: seq + 1, text }];
  let total = next.reduce((n, c) => n + c.text.length, 0);
  while (total > MAX_CHARS && next.length > 1) total -= (next.shift() as Chunk).text.length;
  return { chunks: next, seq: seq + 1 };
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  session: newSession(),
  chunks: [{ id: 1, text: `${crlf(WELCOME)}\r\n` }],
  seq: 1,
  clearSeq: 0,
  prompt: () => promptFor(get().session),
  submit: (line) => {
    const st = get();
    const echo = `${promptFor(st.session)}${line}\r\n`;
    const r = execute(env, st.session, line);
    if (r.clear) {
      set({ session: r.session, chunks: [], clearSeq: st.clearSeq + 1 });
      if (r.lines.length) set((s) => appendChunk(s.chunks, s.seq, `${crlf(r.lines)}\r\n`));
      return;
    }
    const body = r.lines.length ? `${crlf(r.lines)}\r\n` : '';
    set({ session: r.session, ...appendChunk(st.chunks, st.seq, echo + body) });
  },
  complete: (line) => complete(engine.getState(), get().session, line),
  clear: () => set((s) => ({ chunks: [], clearSeq: s.clearSeq + 1 })),
  resetSession: () => {
    const st = get();
    if (st.session.frames.length <= 1) return;
    set({ session: { ...st.session, frames: [st.session.frames[0]] }, ...appendChunk(st.chunks, st.seq, '\r\n[All remote sessions closed: back on tech-laptop]\r\n') });
  },
  revalidate: () => {
    const st = get();
    if (st.session.frames.length <= 1) return;
    const v = validateSession(engine.getState(), st.session);
    if (!v.lines.length) return;
    set({ session: v.session, ...appendChunk(st.chunks, st.seq, `\r\n${crlf(v.lines)}\r\n`) });
  },
}));

// Connections drop as soon as the simulation breaks them (host reboot, cable pulled).
let pending = false;
engine.subscribe(() => {
  if (pending || useTerminalStore.getState().session.frames.length <= 1) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    useTerminalStore.getState().revalidate();
  });
});

