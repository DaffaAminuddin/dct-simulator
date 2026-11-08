/**
 * Command executor: parse a line, validate the session against the live
 * state, run each pipeline (stdout of one command is stdin of the next),
 * honour `;`, `&&`, `||` and `sudo`. Commands read the latest snapshot and
 * change the simulation only through engine actions.
 */
import { listEndpoints, hostsFileEntries } from '@/simulation/networking/Reachability';
import type { ActionResult, SimAction, SimulationState } from '@/types/simulation';
import { commandNames, findCommand } from './CommandRegistry';
import { parse, type Pipeline } from './CommandParser';
import { homeOf, lookup, resolvePath, rootFor } from './fs/VirtualFs';
import { services } from './os/HostOs';
import { pushFrame, topFrame, validateSession } from './Session';
import type { CommandContext, CommandResult, TerminalSession } from './types';
import { err } from './types';

export interface ExecEnv {
  getState: () => SimulationState;
  dispatch: (action: SimAction) => ActionResult;
}

export interface ExecResult {
  lines: string[];
  session: TerminalSession;
  clear: boolean;
  exit: number;
}

const MAX_HISTORY = 500;

function withHistory(session: TerminalSession, line: string): TerminalSession {
  if (session.history.at(-1) === line) return session;
  return { ...session, history: [...session.history, line].slice(-MAX_HISTORY) };
}

function runPipeline(env: ExecEnv, session: TerminalSession, p: Pipeline): { lines: string[]; exit: number; session: TerminalSession; clear: boolean } {
  let sess = session;
  let stdin: string[] | null = null;
  const errLines: string[] = [];
  let exit = 0;
  let clear = false;

  for (let k = 0; k < p.commands.length; k++) {
    let argv = p.commands[k].argv;
    const frame = topFrame(sess);
    let root = frame.user === 'root';
    const tty = k === p.commands.length - 1;

    if (argv[0] === 'sudo' && frame.kind !== 'bmc') {
      const rest = argv.slice(1).filter((a) => !/^-[EHnk]$/.test(a));
      if (rest[0] === '-u') rest.splice(0, 2);
      const shell = rest.length === 0 || ['-i', '-s', '--login', '--shell'].includes(rest[0]) || (rest[0] === 'su' && rest.length <= 2) || (rest[0] === 'bash' && rest.length === 1);
      if (rest.length === 0 && !argv.includes('-i') && !argv.includes('-s')) {
        errLines.push('usage: sudo -h | -K | -k | -V', 'usage: sudo [-ABbEHknPS] [-u user] [command [arg ...]]');
        exit = 1;
        stdin = [];
        continue;
      }
      if (shell) {
        if (!root) sess = pushFrame(sess, { ...frame, user: 'root', cwd: '/root', sudoShell: true, via: 'local' });
        exit = 0;
        stdin = [];
        continue;
      }
      argv = rest;
      root = true;
    }
    if (argv[0] === 'su' && !root) {
      errLines.push('Password: ', 'su: Authentication failure (the root password is not in the vault: use sudo)');
      exit = 1;
      stdin = [];
      continue;
    }

    const def = findCommand(argv[0], frame.kind);
    if (!def) {
      errLines.push(frame.kind === 'bmc' ? `Unknown command '${argv[0]}'. Type 'help' for the command list.` : `${argv[0]}: command not found`);
      exit = 127;
      stdin = [];
      continue;
    }
    const ctx: CommandContext = {
      state: env.getState(),
      session: sess,
      frame,
      argv,
      stdin,
      root,
      dispatch: env.dispatch,
      tty,
      subshell: (s2, line) => {
        const r = execute(env, s2, line, { record: false });
        return { lines: r.lines, exit: r.exit };
      },
    };
    let r: CommandResult;
    try {
      r = def.run(ctx);
    } catch (e) {
      r = err(`${argv[0]}: internal simulator error: ${(e as Error).message}`, 70);
    }
    if (r.session) sess = r.session;
    if (r.clear) clear = true;
    if (r.stderr?.length) errLines.push(...r.stderr);
    stdin = r.stdout;
    exit = r.exit;
  }
  return { lines: [...errLines, ...(stdin ?? [])], exit, session: sess, clear };
}

export function execute(env: ExecEnv, session: TerminalSession, line: string, opts: { record?: boolean } = {}): ExecResult {
  const trimmed = line.trim();
  const checked = validateSession(env.getState(), session);
  if (checked.lines.length) return { lines: checked.lines, session: checked.session, clear: false, exit: 255 };
  if (!trimmed) return { lines: [], session, clear: false, exit: session.lastExit };

  let sess = opts.record === false ? session : withHistory(session, trimmed);
  const frame = topFrame(sess);
  const parsed = parse(trimmed, {
    home: homeOf(frame),
    vars: { HOME: homeOf(frame), USER: frame.user, LOGNAME: frame.user, HOSTNAME: frame.host, PWD: frame.cwd, SHELL: '/bin/bash', PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', '?': String(sess.lastExit) },
  });
  if (!parsed.ok) return { lines: [`-bash: ${parsed.error}`], session: { ...sess, lastExit: 2 }, clear: false, exit: 2 };

  const lines: string[] = [];
  let exit = sess.lastExit;
  let clear = false;
  for (let i = 0; i < parsed.pipelines.length; i++) {
    const op = i > 0 ? parsed.pipelines[i - 1].next : null;
    if (op === '&&' && exit !== 0) continue;
    if (op === '||' && exit === 0) continue;
    const r = runPipeline(env, sess, parsed.pipelines[i]);
    lines.push(...r.lines);
    exit = r.exit;
    sess = r.session;
    if (r.clear) {
      clear = true;
      lines.length = 0;
    }
  }
  return { lines, session: { ...sess, lastExit: exit }, clear, exit };
}

// ---------------------------------------------------------------------------
// Tab completion
// ---------------------------------------------------------------------------

function commonPrefix(items: string[]): string {
  if (!items.length) return '';
  let p = items[0];
  for (const it of items) while (!it.startsWith(p)) p = p.slice(0, -1);
  return p;
}

const HOST_ARG = new Set(['ssh', 'ping', 'traceroute']);

/** Complete the word under the cursor (end of line). Returns the new line and, when ambiguous, the options. */
export function complete(s: SimulationState, session: TerminalSession, line: string): { line: string; options: string[] } {
  const frame = topFrame(session);
  const m = /(\S*)$/.exec(line);
  const word = m ? m[1] : '';
  const before = line.slice(0, line.length - word.length);
  const prevWords = before.trim().split(/\s+/).filter(Boolean);
  const segment = prevWords.slice(prevWords.map((w, i) => (['|', ';', '&&', '||'].includes(w) ? i : -1)).reduce((a, b) => Math.max(a, b), -1) + 1);
  const cmdWords = segment[0] === 'sudo' ? segment.slice(1) : segment;
  const cmd = cmdWords[0];

  let candidates: string[] = [];
  let prefix = word;
  let base = '';
  let dirs = new Set<string>();

  if (!cmd) {
    candidates = commandNames(frame.kind);
  } else if (HOST_ARG.has(cmd) || (cmd === 'ipmitool' && cmdWords.at(-1) === '-H')) {
    const at = word.lastIndexOf('@');
    base = at >= 0 ? word.slice(0, at + 1) : '';
    prefix = word.slice(base.length);
    candidates = frame.kind === 'host' ? hostsFileEntries(s).map((h) => h.name) : listEndpoints(s).filter((e) => e.services.includes('ssh') || e.services.includes('icmp')).map((e) => e.dnsName);
  } else if (cmd === 'systemctl' && cmdWords.length >= 2 && frame.kind === 'host') {
    const eq = s.equipment[frame.equipmentId];
    candidates = eq ? services(s, eq).map((x) => x.unit) : [];
  } else if (cmd === 'ip' && cmdWords.length === 1) {
    candidates = ['address', 'link', 'route', 'neigh'];
  } else if (frame.kind !== 'bmc') {
    const slash = word.lastIndexOf('/');
    base = slash >= 0 ? word.slice(0, slash + 1) : '';
    prefix = word.slice(base.length);
    const root = rootFor(s, frame);
    const node = root ? lookup(root, resolvePath(frame.cwd, base || '.')) : null;
    if (node?.kind === 'dir') {
      const entries = node.entries();
      candidates = Object.keys(entries);
      dirs = new Set(candidates.filter((n) => entries[n].kind === 'dir'));
    }
  }
  const hits = [...new Set(candidates)].filter((c) => c.startsWith(prefix)).sort();
  if (hits.length === 0) return { line, options: [] };
  if (hits.length === 1) {
    const h = hits[0];
    return { line: `${before}${base}${h}${dirs.has(h) ? '/' : ' '}`, options: [] };
  }
  const common = commonPrefix(hits);
  if (common.length > prefix.length) return { line: `${before}${base}${common}`, options: [] };
  return { line, options: hits.map((h) => (dirs.has(h) ? `${h}/` : h)) };
}
