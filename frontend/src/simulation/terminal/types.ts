/**
 * Terminal model types. A terminal session is plain data: a stack of shell
 * frames (the laptop's local shell, then any SSH / SOL / serial hops) plus
 * command history. Commands read the simulation snapshot and may dispatch
 * engine actions; they never touch the host machine.
 */
import type { ActionResult, Id, SimAction, SimulationState } from '@/types/simulation';

/** Where a shell runs. */
export type FrameKind = 'laptop' | 'host' | 'bmc';

/** How a frame was reached from the frame below it. */
export type FrameVia = 'local' | 'ssh' | 'sol' | 'serial';

export interface ShellFrame {
  kind: FrameKind;
  /** Equipment whose OS / BMC this shell runs on. */
  equipmentId: Id;
  /** Name shown in the prompt (hostname, `<host>-bmc`, `tech-laptop`). */
  host: string;
  user: string;
  cwd: string;
  via: FrameVia;
  /** Address used to reach this frame (SSH). */
  address?: string;
  /** Root shell opened with `sudo -i` on top of a user shell. */
  sudoShell?: boolean;
}

export interface TerminalSession {
  frames: ShellFrame[];
  history: string[];
  lastExit: number;
  /** Hosts already in ~/.ssh/known_hosts on the laptop. */
  knownHosts: string[];
}

/** Context handed to every command. */
export interface CommandContext {
  state: SimulationState;
  session: TerminalSession;
  frame: ShellFrame;
  argv: string[];
  /** Lines piped in from the previous command. */
  stdin: string[] | null;
  /** Running with root privileges (`sudo` or a root shell). */
  root: boolean;
  /** Dispatch an engine action (the only side effect a command may cause). */
  dispatch: (action: SimAction) => ActionResult;
  /** Output goes to the terminal (last command of a pipeline), not to a pipe. */
  tty: boolean;
  /** Run a command line in another session (ssh host <command>). */
  subshell: (session: TerminalSession, line: string) => { lines: string[]; exit: number };
}

export interface CommandResult {
  stdout: string[];
  stderr?: string[];
  exit: number;
  /** Replace the session (push / pop frames, change directory). */
  session?: TerminalSession;
  /** Clear the screen. */
  clear?: boolean;
}

export interface CommandDef {
  name: string;
  /** One-line description for `help`. */
  summary: string;
  usage?: string;
  /** Shells that provide this command. */
  contexts: FrameKind[];
  /** Hidden from `help` and completion (aliases). */
  hidden?: boolean;
  /** Group label for the reference panel. */
  group: 'shell' | 'files' | 'text' | 'system' | 'network' | 'nvidia' | 'bmc' | 'fabric';
  run: (ctx: CommandContext) => CommandResult;
}

export const ok = (stdout: string[] = [], extra: Partial<CommandResult> = {}): CommandResult => ({ stdout, exit: 0, ...extra });
export const err = (stderr: string[] | string, exit = 1, extra: Partial<CommandResult> = {}): CommandResult => ({
  stdout: [],
  stderr: Array.isArray(stderr) ? stderr : [stderr],
  exit,
  ...extra,
});
