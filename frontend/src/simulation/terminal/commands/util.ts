/** Helpers shared by command implementations. */
import type { Equipment } from '@/types/simulation';
import type { CommandContext, CommandResult } from '../types';
import { err } from '../types';

export const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  boldBlue: '\x1b[01;34m',
  boldGreen: '\x1b[01;32m',
};

/** Strip ANSI escape sequences (tests, pipes). */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export interface Flags {
  /** Single-letter and long flags that were present. */
  has: (...names: string[]) => boolean;
  /** Value of an option (`-n 5`, `-n5`, `--lines=5`, `--lines 5`). */
  value: (...names: string[]) => string | undefined;
  positional: string[];
}

/**
 * Small getopt: `valued` lists options that take an argument (short letters
 * and long names). Bundled short flags (`-la`) are split.
 */
export function parseFlags(args: string[], valued: string[] = []): Flags {
  const present = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const [name, v] = a.slice(2).split(/=(.*)/s, 2);
      present.add(name);
      if (v !== undefined) values.set(name, v);
      else if (valued.includes(name) && i + 1 < args.length) values.set(name, args[++i]);
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      const body = a.slice(1);
      for (let k = 0; k < body.length; k++) {
        const f = body[k];
        present.add(f);
        if (valued.includes(f)) {
          const rest = body.slice(k + 1);
          if (rest) values.set(f, rest);
          else if (i + 1 < args.length) values.set(f, args[++i]);
          break;
        }
      }
      continue;
    }
    positional.push(a);
  }
  return {
    has: (...names) => names.some((n) => present.has(n)),
    value: (...names) => {
      for (const n of names) if (values.has(n)) return values.get(n);
      return undefined;
    },
    positional,
  };
}

/** Equipment the current shell runs on. */
export function shellHost(ctx: CommandContext): Equipment {
  return ctx.state.equipment[ctx.frame.equipmentId];
}

export function needRoot(ctx: CommandContext, what: string): CommandResult | null {
  if (ctx.root) return null;
  return err(`${what}: Permission denied (are you root? try: sudo ${ctx.argv.join(' ')})`, 1);
}

/** Pad columns to a fixed-width table (left aligned unless the column index is in `right`). */
export function table(rows: string[][], right: number[] = [], gap = 2): string[] {
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, stripAnsi(c).length)));
  return rows.map((r) =>
    r
      .map((c, i) => {
        const padN = widths[i] - stripAnsi(c).length;
        if (i === r.length - 1 && !right.includes(i)) return c;
        return right.includes(i) ? ' '.repeat(padN) + c : c + ' '.repeat(padN);
      })
      .join(' '.repeat(gap))
      .replace(/\s+$/, ''),
  );
}

export function usage(name: string, text: string): CommandResult {
  return err([`Usage: ${name} ${text}`], 2);
}

/** Glob (`*`, `?`) to RegExp. */
export function globToRegExp(glob: string): RegExp {
  const re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${re}$`);
}

export function fmtGiB(kib: number, unit: 'h' | 'k' | 'm' | 'g'): string {
  if (unit === 'k') return String(kib);
  if (unit === 'm') return String(Math.round(kib / 1024));
  if (unit === 'g') return String(Math.round(kib / 1024 / 1024));
  const mib = kib / 1024;
  if (mib < 1024) return `${Math.round(mib)}Mi`;
  const gib = mib / 1024;
  if (gib < 1024) return `${gib < 10 ? gib.toFixed(1) : Math.round(gib)}Gi`;
  return `${(gib / 1024).toFixed(1)}Ti`;
}
