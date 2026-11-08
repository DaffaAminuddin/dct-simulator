/** Every simulated command, looked up by name and shell kind. */
import { BMC_COMMANDS } from './commands/bmc';
import { NETWORK_COMMANDS } from './commands/network';
import { NVIDIA_COMMANDS, PLANNED_COMMANDS } from './commands/nvidia';
import { LESS_ALIAS, runHelp, SHELL_COMMANDS } from './commands/shell';
import { SYSTEM_COMMANDS } from './commands/system';
import type { CommandDef, FrameKind } from './types';
import { err } from './types';

const HELP: CommandDef = {
  name: 'help',
  summary: 'List the commands available in this shell',
  contexts: ['laptop', 'host', 'bmc'],
  group: 'shell',
  run: (ctx) => runHelp(ctx, ALL_COMMANDS),
};

/** `sudo` is handled by the executor; this entry documents it for help and completion. */
const SUDO: CommandDef = {
  name: 'sudo',
  summary: 'Run a command as root (sudo -i for a root shell)',
  contexts: ['laptop', 'host'],
  group: 'shell',
  run: () => err('sudo: a command is required', 1),
};

export const ALL_COMMANDS: CommandDef[] = [HELP, SUDO, ...SHELL_COMMANDS, LESS_ALIAS, ...SYSTEM_COMMANDS, ...NETWORK_COMMANDS, ...BMC_COMMANDS, ...NVIDIA_COMMANDS, ...PLANNED_COMMANDS];

const index = new Map<string, CommandDef[]>();
for (const c of ALL_COMMANDS) {
  const list = index.get(c.name) ?? [];
  list.push(c);
  index.set(c.name, list);
}

export function findCommand(name: string, kind: FrameKind): CommandDef | undefined {
  return index.get(name)?.find((c) => c.contexts.includes(kind));
}

export function commandNames(kind: FrameKind): string[] {
  return [...new Set(ALL_COMMANDS.filter((c) => c.contexts.includes(kind)).map((c) => c.name))].sort();
}

/** Reference list for the UI: visible commands per shell, grouped. */
export function commandReference(kind: FrameKind): { group: CommandDef['group']; name: string; summary: string }[] {
  return ALL_COMMANDS.filter((c) => c.contexts.includes(kind) && !c.hidden).map((c) => ({ group: c.group, name: c.name, summary: c.summary }));
}
