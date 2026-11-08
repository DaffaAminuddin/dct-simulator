/**
 * Terminal sessions: the frame stack (laptop → SSH / SOL / serial hops),
 * prompts, and connection validation against the live simulation state.
 */
import { OS_STATES } from '@/simulation/core/SimulationState';
import { LAPTOP_SOURCE, type ProbeSource, routeFrom } from '@/simulation/networking/Reachability';
import { snapshotCache } from '@/simulation/networking/Vlan';
import { LAPTOP_ID } from '@/simulation/workstation/Workstation';
import type { SimulationState } from '@/types/simulation';
import { homeOf } from './fs/VirtualFs';
import type { ShellFrame, TerminalSession } from './types';

export const LAPTOP_FRAME: ShellFrame = { kind: 'laptop', equipmentId: LAPTOP_ID, host: 'tech-laptop', user: 'dct', cwd: '/home/dct', via: 'local' };

export function newSession(): TerminalSession {
  return { frames: [LAPTOP_FRAME], history: [], lastExit: 0, knownHosts: [] };
}

export const topFrame = (session: TerminalSession): ShellFrame => session.frames[session.frames.length - 1];

export function pushFrame(session: TerminalSession, frame: ShellFrame): TerminalSession {
  return { ...session, frames: [...session.frames, frame] };
}

export function popFrame(session: TerminalSession): TerminalSession {
  return session.frames.length > 1 ? { ...session, frames: session.frames.slice(0, -1) } : session;
}

export function replaceTop(session: TerminalSession, frame: ShellFrame): TerminalSession {
  return { ...session, frames: [...session.frames.slice(0, -1), frame] };
}

/** Pop every frame that runs on `equipmentId` (the host went away). */
export function dropHost(session: TerminalSession, equipmentId: string): TerminalSession {
  const idx = session.frames.findIndex((f, i) => i > 0 && f.equipmentId === equipmentId && f.kind === 'host');
  return idx > 0 ? { ...session, frames: session.frames.slice(0, idx) } : session;
}

export function cwdLabel(frame: ShellFrame): string {
  const home = homeOf(frame);
  if (frame.cwd === home) return '~';
  if (frame.cwd.startsWith(`${home}/`)) return `~${frame.cwd.slice(home.length)}`;
  return frame.cwd;
}

/** Ubuntu-style coloured prompt; the BMC CLI has its own. */
export function promptFor(session: TerminalSession): string {
  const f = topFrame(session);
  if (f.kind === 'bmc') return `\x1b[01;33m${f.user}@${f.host}\x1b[0m> `;
  const sign = f.user === 'root' ? '#' : '$';
  return `\x1b[01;32m${f.user}@${f.host}\x1b[0m:\x1b[01;34m${cwdLabel(f)}\x1b[0m${sign} `;
}

/** Breadcrumb for the UI, e.g. `tech-laptop → dh1-r01-n01-bmc → dh1-r01-n01 (SOL)`. */
export function sessionPath(session: TerminalSession): { host: string; via: ShellFrame['via']; kind: ShellFrame['kind']; user: string }[] {
  return session.frames.filter((f) => !f.sudoShell).map((f) => ({ host: f.host, via: f.via, kind: f.kind, user: f.user }));
}

function sourceOf(frame: ShellFrame): ProbeSource | null {
  if (frame.kind === 'laptop') return LAPTOP_SOURCE;
  if (frame.kind === 'host') return { kind: 'host', equipmentId: frame.equipmentId };
  return null;
}

/** Why the hop into `f` (from `prev`) no longer works; null while it still does. */
function brokenLink(s: SimulationState, prev: ShellFrame, f: ShellFrame): string[] | null {
  const eq = s.equipment[f.equipmentId];
  const targetUp = !!eq && (f.kind === 'bmc' ? eq.bmcAlive : OS_STATES.has(eq.state));
  if (f.sudoShell) return null;
  if (f.via === 'ssh') {
    if (!targetUp) return [`Connection to ${f.address ?? f.host} closed by remote host.`, `Connection to ${f.address ?? f.host} closed.`];
    const src = sourceOf(prev);
    if (!src || !f.address) return null;
    const r = routeFrom(s, src, f.address, snapshotCache(s));
    if (!r.ok) return ['client_loop: send disconnect: Broken pipe'];
    return null;
  }
  if (f.via === 'sol') {
    if (prev.kind === 'laptop' && f.address) {
      const bmcHost = s.equipment[f.equipmentId];
      const r = routeFrom(s, LAPTOP_SOURCE, f.address, snapshotCache(s));
      if (!r.ok || !bmcHost?.bmcAlive) return ['Error: IPMI session lost (BMC unreachable). SOL session closed.'];
    }
    if (!targetUp) return [`[SOL] ${f.host}: operating system went down (${eq?.state.replace('_', ' ') ?? 'removed'}). Login session ended.`];
    return null;
  }
  if (f.via === 'serial') {
    if (s.workstation.consoleEquipmentId !== f.equipmentId) return ['[screen is terminating]'];
    if (!targetUp) return [`${f.host}: operating system went down. Serial login session ended.`, '[screen is terminating]'];
    return null;
  }
  return null;
}

/**
 * Check every hop of the session against the current state. Hops that broke
 * (host rebooted, cable pulled, BMC lost) are dropped together with every
 * frame above them; `lines` says what the learner would see.
 */
export function validateSession(s: SimulationState, session: TerminalSession): { session: TerminalSession; lines: string[] } {
  if (session.frames.length <= 1) return { session, lines: [] };
  if (!s.workstation.poweredOn) {
    return { session: { ...session, frames: [session.frames[0]] }, lines: ['', '*** tech-laptop: battery empty, the laptop shut down. All remote sessions closed. ***'] };
  }
  for (let i = 1; i < session.frames.length; i++) {
    const broken = brokenLink(s, session.frames[i - 1], session.frames[i]);
    if (broken) return { session: { ...session, frames: session.frames.slice(0, i) }, lines: broken };
  }
  return { session, lines: [] };
}
