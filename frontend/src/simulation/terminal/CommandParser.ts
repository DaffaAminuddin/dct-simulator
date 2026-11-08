/**
 * Shell-line parser: words with single/double quotes and backslash escapes,
 * pipelines (`|`), sequences (`;`, `&&`, `||`), `~` and a few variables.
 * Redirection, background jobs and command substitution are rejected: the
 * simulator has no writable files or job control.
 */

export interface SimpleCommand {
  argv: string[];
}

export interface Pipeline {
  commands: SimpleCommand[];
  /** How this pipeline joins the NEXT one. */
  next: ';' | '&&' | '||' | null;
}

export type ParseResult = { ok: true; pipelines: Pipeline[] } | { ok: false; error: string };

export interface ParseEnv {
  home: string;
  vars: Record<string, string>;
}

type Token = { kind: 'word'; value: string } | { kind: 'op'; value: '|' | ';' | '&&' | '||' };

const UNSUPPORTED: Record<string, string> = {
  '>': 'output redirection is not supported (the simulated filesystem is read-only)',
  '<': 'input redirection is not supported',
  '&': 'background jobs are not supported',
  '`': 'command substitution is not supported',
  '$(': 'command substitution is not supported',
};

function expandVar(name: string, env: ParseEnv): string {
  return env.vars[name] ?? '';
}

export function tokenize(line: string, env: ParseEnv): { tokens: Token[] } | { error: string } {
  const tokens: Token[] = [];
  let word = '';
  let inWord = false;
  let i = 0;
  const flush = () => {
    if (inWord) tokens.push({ kind: 'word', value: word });
    word = '';
    inWord = false;
  };
  const readVar = (): string | null => {
    // Called with line[i] === '$'
    const rest = line.slice(i + 1);
    if (rest.startsWith('(')) return null;
    if (rest.startsWith('?')) {
      i += 2;
      return expandVar('?', env);
    }
    const braced = /^\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(rest);
    if (braced) {
      i += 1 + braced[0].length;
      return expandVar(braced[1], env);
    }
    const plain = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (plain) {
      i += 1 + plain[0].length;
      return expandVar(plain[0], env);
    }
    i += 1;
    return '$';
  };

  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') {
      flush();
      i++;
      continue;
    }
    if (c === '#' && !inWord) break; // comment
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) return { error: 'unexpected EOF while looking for matching `\'\'' };
      word += line.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      inWord = true;
      i++;
      let closed = false;
      while (i < line.length) {
        const d = line[i];
        if (d === '"') {
          closed = true;
          i++;
          break;
        }
        if (d === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) {
          word += line[i + 1];
          i += 2;
          continue;
        }
        if (d === '`') return { error: UNSUPPORTED['`'] };
        if (d === '$') {
          const v = readVar();
          if (v === null) return { error: UNSUPPORTED['$('] };
          word += v;
          continue;
        }
        word += d;
        i++;
      }
      if (!closed) return { error: 'unexpected EOF while looking for matching `"\'' };
      continue;
    }
    if (c === '\\') {
      if (i + 1 < line.length) word += line[i + 1];
      inWord = true;
      i += 2;
      continue;
    }
    if (c === '|' || c === ';' || c === '&') {
      flush();
      if (line.startsWith('||', i)) {
        tokens.push({ kind: 'op', value: '||' });
        i += 2;
      } else if (line.startsWith('&&', i)) {
        tokens.push({ kind: 'op', value: '&&' });
        i += 2;
      } else if (c === '&') {
        return { error: UNSUPPORTED['&'] };
      } else {
        tokens.push({ kind: 'op', value: c as '|' | ';' });
        i++;
      }
      continue;
    }
    if (c === '>' || c === '<') return { error: UNSUPPORTED[c] };
    if (c === '`') return { error: UNSUPPORTED['`'] };
    if (c === '$') {
      const v = readVar();
      if (v === null) return { error: UNSUPPORTED['$('] };
      word += v;
      inWord = true;
      continue;
    }
    if (c === '~' && !inWord && (i + 1 === line.length || line[i + 1] === '/' || line[i + 1] === ' ')) {
      word += env.home;
      inWord = true;
      i++;
      continue;
    }
    word += c;
    inWord = true;
    i++;
  }
  flush();
  return { tokens };
}

export function parse(line: string, env: ParseEnv): ParseResult {
  const t = tokenize(line, env);
  if ('error' in t) return { ok: false, error: t.error };
  const pipelines: Pipeline[] = [];
  let commands: SimpleCommand[] = [];
  let argv: string[] = [];
  const near = (op: string) => ({ ok: false as const, error: `syntax error near unexpected token \`${op}'` });

  for (const tok of t.tokens) {
    if (tok.kind === 'word') {
      argv.push(tok.value);
      continue;
    }
    if (argv.length === 0) return near(tok.value);
    commands.push({ argv });
    argv = [];
    if (tok.value === '|') continue;
    pipelines.push({ commands, next: tok.value });
    commands = [];
  }
  if (argv.length > 0) commands.push({ argv });
  else if (commands.length > 0) return near('|');
  if (commands.length > 0) pipelines.push({ commands, next: null });
  else if (pipelines.length > 0) pipelines[pipelines.length - 1].next = null;
  return { ok: true, pipelines };
}
