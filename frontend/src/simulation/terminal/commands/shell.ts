/** Shell built-ins and filesystem / text commands (laptop and host shells). */
import { homeOf, lookup, resolvePath, rootFor, toPath, type FsNode } from '../fs/VirtualFs';
import { dateString, wallClock } from '../os/HostOs';
import { popFrame, replaceTop } from '../Session';
import type { CommandContext, CommandDef, CommandResult } from '../types';
import { err, ok } from '../types';
import { C, globToRegExp, parseFlags } from './util';

const SHELLS: CommandDef['contexts'] = ['laptop', 'host'];

/** GNU basic regex → JS: `\|`, `\(`, `\+` are operators; bare `|`, `(`, `+` are literals. */
function breToJs(p: string): string {
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\' && i + 1 < p.length) {
      const n = p[++i];
      out += '|()+?{}'.includes(n) ? n : `\\${n}`;
    } else out += '|()+?{}'.includes(c) ? `\\${c}` : c;
  }
  return out;
}

function fsOf(ctx: CommandContext): FsNode | null {
  return rootFor(ctx.state, ctx.frame);
}

/** Read named files, or stdin when no file is given. */
function inputLines(ctx: CommandContext, files: string[], cmd: string): { lines: string[]; errors: string[] } {
  if (files.length === 0) return { lines: ctx.stdin ?? [], errors: [] };
  const root = fsOf(ctx);
  const lines: string[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const node = root ? lookup(root, resolvePath(ctx.frame.cwd, f)) : null;
    if (!node) errors.push(`${cmd}: ${f}: No such file or directory`);
    else if (node.kind === 'dir') errors.push(`${cmd}: ${f}: Is a directory`);
    else {
      const text = node.read();
      const body = text.endsWith('\n') ? text.slice(0, -1) : text;
      if (body) lines.push(...body.split('\n'));
    }
  }
  return { lines, errors };
}

const exit_: CommandDef = {
  name: 'exit',
  summary: 'Leave the current shell (closes SSH / SOL / console hops)',
  contexts: ['laptop', 'host', 'bmc'],
  group: 'shell',
  run: (ctx) => {
    const f = ctx.frame;
    if (ctx.session.frames.length <= 1) return ok(['This is the laptop\'s local shell. Close the terminal window to leave it.']);
    const session = popFrame(ctx.session);
    if (f.sudoShell) return ok(['logout'], { session });
    if (f.via === 'ssh') return ok(['logout', `Connection to ${f.address ?? f.host} closed.`], { session });
    if (f.via === 'sol') return ok(['logout', '', `[SOL session closed. Back on ${session.frames.at(-1)?.host}]`], { session });
    if (f.via === 'serial') return ok(['logout', '', '[screen is terminating]'], { session });
    return ok(['logout'], { session });
  },
};

export const SHELL_COMMANDS: CommandDef[] = [
  exit_,
  { ...exit_, name: 'logout', hidden: true },
  {
    name: 'clear',
    summary: 'Clear the screen (Ctrl+L)',
    contexts: ['laptop', 'host', 'bmc'],
    group: 'shell',
    run: () => ok([], { clear: true }),
  },
  {
    name: 'history',
    summary: 'Show command history',
    contexts: SHELLS,
    group: 'shell',
    run: (ctx) => {
      const n = Number(ctx.argv[1]);
      const all = ctx.session.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`);
      return ok(Number.isFinite(n) && n > 0 ? all.slice(-n) : all);
    },
  },
  {
    name: 'echo',
    summary: 'Print text',
    contexts: SHELLS,
    group: 'shell',
    run: (ctx) => {
      const args = ctx.argv.slice(1);
      const noNl = args[0] === '-n';
      return ok([(noNl ? args.slice(1) : args).join(' ')]);
    },
  },
  { name: 'true', summary: 'Exit with status 0', contexts: SHELLS, group: 'shell', hidden: true, run: () => ok([]) },
  { name: 'false', summary: 'Exit with status 1', contexts: SHELLS, group: 'shell', hidden: true, run: () => ({ stdout: [], exit: 1 }) },
  {
    name: 'whoami',
    summary: 'Print the current user',
    contexts: SHELLS,
    group: 'shell',
    run: (ctx) => ok([ctx.root ? 'root' : ctx.frame.user]),
  },
  {
    name: 'id',
    summary: 'Print user and group IDs',
    contexts: SHELLS,
    group: 'shell',
    run: (ctx) => {
      if (ctx.root || ctx.frame.user === 'root') return ok(['uid=0(root) gid=0(root) groups=0(root)']);
      return ok([`uid=1000(${ctx.frame.user}) gid=1000(${ctx.frame.user}) groups=1000(${ctx.frame.user}),4(adm),27(sudo)`]);
    },
  },
  {
    name: 'date',
    summary: 'Print the simulated date and time',
    contexts: SHELLS,
    group: 'shell',
    run: (ctx) => ok([dateString(wallClock(ctx.state))]),
  },
  {
    name: 'pwd',
    summary: 'Print the working directory',
    contexts: SHELLS,
    group: 'files',
    run: (ctx) => ok([ctx.frame.cwd]),
  },
  {
    name: 'cd',
    summary: 'Change directory',
    contexts: SHELLS,
    group: 'files',
    run: (ctx) => {
      const target = ctx.argv[1] ?? homeOf(ctx.frame);
      const root = fsOf(ctx);
      const segs = resolvePath(ctx.frame.cwd, target === '-' ? homeOf(ctx.frame) : target);
      const node = root ? lookup(root, segs) : null;
      if (!node) return err(`-bash: cd: ${target}: No such file or directory`);
      if (node.kind !== 'dir') return err(`-bash: cd: ${target}: Not a directory`);
      return ok([], { session: replaceTop(ctx.session, { ...ctx.frame, cwd: toPath(segs) }) });
    },
  },
  {
    name: 'ls',
    summary: 'List directory contents',
    usage: 'ls [-l] [-a] [path...]',
    contexts: SHELLS,
    group: 'files',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1));
      const root = fsOf(ctx);
      const targets = f.positional.length ? f.positional : ['.'];
      const out: string[] = [];
      const errors: string[] = [];
      const long = f.has('l');
      const all = f.has('a');
      const color = (name: string, node: FsNode) => (ctx.tty && node.kind === 'dir' ? `${C.boldBlue}${name}${C.reset}` : name);
      targets.forEach((t, ti) => {
        const node = root ? lookup(root, resolvePath(ctx.frame.cwd, t)) : null;
        if (!node) {
          errors.push(`ls: cannot access '${t}': No such file or directory`);
          return;
        }
        if (node.kind === 'file') {
          out.push(long ? `-r--r--r-- 1 root root ${String(node.read().length).padStart(6)} ${t}` : t);
          return;
        }
        if (targets.length > 1) out.push(`${ti > 0 ? '\n' : ''}${t}:`);
        const entries = Object.entries(node.entries()).sort(([a], [b]) => a.localeCompare(b));
        const names = all ? [['.', node] as const, ['..', node] as const, ...entries] : entries;
        if (long) {
          out.push(`total ${entries.length * 4}`);
          for (const [name, n] of names) {
            const size = n.kind === 'file' ? n.read().length : 4096;
            out.push(`${n.kind === 'dir' ? 'dr-xr-xr-x' : '-r--r--r--'} 1 root root ${String(size).padStart(6)} ${color(name, n)}`);
          }
        } else if (names.length) out.push(names.map(([name, n]) => color(name, n)).join('  '));
      });
      return { stdout: out, stderr: errors, exit: errors.length ? 2 : 0 };
    },
  },
  {
    name: 'cat',
    summary: 'Print files',
    usage: 'cat <file...>',
    contexts: SHELLS,
    group: 'files',
    run: (ctx) => {
      const files = ctx.argv.slice(1).filter((a) => a !== '-');
      const r = inputLines(ctx, files, 'cat');
      return { stdout: r.lines, stderr: r.errors, exit: r.errors.length ? 1 : 0 };
    },
  },
  {
    name: 'find',
    summary: 'Search for files (-name, -type)',
    usage: 'find [path] [-name PATTERN] [-type f|d]',
    contexts: SHELLS,
    group: 'files',
    run: (ctx) => {
      const args = ctx.argv.slice(1);
      const start = args[0] && !args[0].startsWith('-') ? args.shift() as string : '.';
      let name: RegExp | null = null;
      let type: 'f' | 'd' | null = null;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-name' || args[i] === '-iname') name = new RegExp(globToRegExp(args[++i] ?? '*').source, args[i - 1] === '-iname' ? 'i' : '');
        else if (args[i] === '-type') type = args[++i] === 'd' ? 'd' : 'f';
        else if (args[i] === '-maxdepth') i++;
        else return err(`find: unknown predicate '${args[i]}'`);
      }
      const root = fsOf(ctx);
      const base = root ? lookup(root, resolvePath(ctx.frame.cwd, start)) : null;
      if (!base) return err(`find: '${start}': No such file or directory`);
      const out: string[] = [];
      const walk = (node: FsNode, path: string, leaf: string, depth: number) => {
        const matches = (!name || name.test(leaf)) && (!type || (type === 'd') === (node.kind === 'dir'));
        if (matches) out.push(path);
        if (node.kind === 'dir' && depth < 8) {
          for (const [n, child] of Object.entries(node.entries()).sort(([a], [b]) => a.localeCompare(b))) walk(child, `${path === '/' ? '' : path}/${n}`, n, depth + 1);
        }
      };
      walk(base, start, start.split('/').filter(Boolean).at(-1) ?? start, 0);
      return ok(out);
    },
  },
  {
    name: 'grep',
    summary: 'Filter lines matching a pattern (-i -v -c -n -E -w)',
    usage: 'grep [-ivcnEw] PATTERN [file...]',
    contexts: SHELLS,
    group: 'text',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1), ['e']);
      const pattern = f.value('e') ?? f.positional.shift();
      if (pattern === undefined) return err(['Usage: grep [OPTION]... PATTERNS [FILE]...', "Try 'grep --help' for more information."], 2);
      let re: RegExp;
      try {
        const src = f.has('E') ? pattern : breToJs(pattern);
        re = new RegExp(f.has('w') ? `\\b(?:${src})\\b` : src, f.has('i') ? 'i' : '');
      } catch {
        return err(`grep: invalid regular expression: ${pattern}`, 2);
      }
      const r = inputLines(ctx, f.positional, 'grep');
      const hits = r.lines.map((l, i) => ({ l, i })).filter(({ l }) => re.test(l.replace(/\x1b\[[0-9;]*m/g, '')) !== f.has('v'));
      if (f.has('c')) return { stdout: [String(hits.length)], stderr: r.errors, exit: hits.length ? 0 : 1 };
      const lines = hits.map(({ l, i }) => (f.has('n') ? `${i + 1}:${l}` : l));
      return { stdout: lines, stderr: r.errors, exit: r.errors.length ? 2 : hits.length ? 0 : 1 };
    },
  },
  ...(['head', 'tail'] as const).map(
    (name): CommandDef => ({
      name,
      summary: name === 'head' ? 'First lines of input (-n N)' : 'Last lines of input (-n N)',
      contexts: SHELLS,
      group: 'text',
      run: (ctx) => {
        const args = ctx.argv.slice(1).map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a));
        const f = parseFlags(args, ['n']);
        if (f.has('f')) return err(`${name}: following files (-f) is not supported in the simulator`);
        const n = Number(f.value('n') ?? 10);
        const r = inputLines(ctx, f.positional, name);
        const lines = name === 'head' ? r.lines.slice(0, n) : r.lines.slice(Math.max(0, r.lines.length - n));
        return { stdout: lines, stderr: r.errors, exit: r.errors.length ? 1 : 0 };
      },
    }),
  ),
  {
    name: 'wc',
    summary: 'Count lines, words and characters (-l -w -c)',
    contexts: SHELLS,
    group: 'text',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1));
      const r = inputLines(ctx, f.positional, 'wc');
      const l = r.lines.length;
      const w = r.lines.reduce((n, x) => n + x.split(/\s+/).filter(Boolean).length, 0);
      const c = r.lines.reduce((n, x) => n + x.length + 1, 0);
      const pick = [f.has('l') ? l : null, f.has('w') ? w : null, f.has('c', 'm') ? c : null].filter((x) => x !== null);
      const vals = pick.length ? pick : [l, w, c];
      return { stdout: [vals.map((v) => String(v).padStart(vals.length > 1 ? 7 : 0)).join(' ').trim() + (f.positional[0] ? ` ${f.positional[0]}` : '')], stderr: r.errors, exit: r.errors.length ? 1 : 0 };
    },
  },
  {
    name: 'sort',
    summary: 'Sort lines (-r -n -u)',
    contexts: SHELLS,
    group: 'text',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1));
      const r = inputLines(ctx, f.positional, 'sort');
      let lines = [...r.lines].sort(f.has('n') ? (a, b) => parseFloat(a) - parseFloat(b) : (a, b) => a.localeCompare(b));
      if (f.has('u')) lines = [...new Set(lines)];
      if (f.has('r')) lines.reverse();
      return { stdout: lines, stderr: r.errors, exit: 0 };
    },
  },
  {
    name: 'uniq',
    summary: 'Collapse repeated lines (-c)',
    contexts: SHELLS,
    group: 'text',
    run: (ctx) => {
      const f = parseFlags(ctx.argv.slice(1));
      const r = inputLines(ctx, f.positional, 'uniq');
      const out: { l: string; n: number }[] = [];
      for (const l of r.lines) {
        const last = out.at(-1);
        if (last && last.l === l) last.n++;
        else out.push({ l, n: 1 });
      }
      return ok(out.map((x) => (f.has('c') ? `${String(x.n).padStart(7)} ${x.l}` : x.l)));
    },
  },
  {
    name: 'less',
    summary: 'View a file (prints it; no pager in the simulator)',
    contexts: SHELLS,
    group: 'files',
    hidden: true,
    run: (ctx) => {
      const r = inputLines(ctx, ctx.argv.slice(1), ctx.argv[0]);
      return { stdout: r.lines, stderr: r.errors, exit: r.errors.length ? 1 : 0 };
    },
  },
];

export const LESS_ALIAS: CommandDef = { ...(SHELL_COMMANDS.find((c) => c.name === 'less') as CommandDef), name: 'more' };

export function runHelp(ctx: CommandContext, all: CommandDef[]): CommandResult {
  const kind = ctx.frame.kind;
  const groups: Record<string, string> = {
    shell: 'Shell',
    files: 'Files',
    text: 'Text filters (use with |)',
    system: 'System and hardware',
    network: 'Network',
    nvidia: 'NVIDIA GPU',
    bmc: 'BMC / IPMI',
    fabric: 'Fabric and DCGM (later phases)',
  };
  const out: string[] = [];
  if (kind === 'bmc') out.push(`${C.bold}BMC CLI (reference)${C.reset}: commands follow the IPMI vocabulary used by ipmitool.`, '');
  else if (kind === 'laptop') out.push(`${C.bold}tech-laptop${C.reset}: local shell. Reach servers with ssh, ipmitool or the serial console.`, '');
  else out.push(`${C.bold}${ctx.frame.host}${C.reset}: Linux host shell (simulated). sudo works for the dct account.`, '');
  for (const [g, label] of Object.entries(groups)) {
    const cmds = all.filter((c) => c.group === g && c.contexts.includes(kind) && !c.hidden);
    if (!cmds.length) continue;
    out.push(`${C.cyan}${label}${C.reset}`);
    for (const c of cmds) out.push(`  ${c.name.padEnd(13)} ${c.summary}`);
    out.push('');
  }
  out.push('Tab completes commands, paths and host names. ↑/↓ browse history. Ctrl+C cancels the line.');
  return ok(out);
}
