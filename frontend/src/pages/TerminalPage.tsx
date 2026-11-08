import { Page } from '@/components/layout/AppShell';
import { Mono, PhaseNotice } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';

const GROUPS: [string, string[]][] = [
  ['Linux', ['ls', 'pwd', 'cd', 'cat', 'grep', 'find', 'ps', 'top', 'free', 'df', 'lsblk', 'lscpu', 'lspci', 'lsusb', 'ip addr', 'ip route', 'ping', 'traceroute', 'ethtool', 'dmesg', 'journalctl', 'systemctl', 'uname', 'hostname', 'ssh', 'reboot', 'shutdown']],
  ['NVIDIA', ['nvidia-smi', 'nvidia-smi -q', 'nvidia-smi -L', 'nvidia-smi -i 0 -q', 'dcgmi discovery -l', 'dcgmi health -c', 'dcgmi diag -r 1|2|3']],
  ['Fabric', ['ibstat', 'ibv_devinfo', 'iblinkinfo', 'ibdiagnet', 'rdma link', 'mlxlink', 'mlxconfig', 'nccl-tests']],
];

export function TerminalPage() {
  return (
    <Page className="space-y-3">
      <PhaseNotice phase={3} title="Virtual terminal (xterm.js) is not built yet">
        This screen has no command input yet: a terminal that printed canned output would contradict the simulation. In Phase 3 every command is parsed, validated and evaluated against the live engine state through the OS, driver and DCGM observation channels. Output then matches the hardware you see in the racks, and nothing ever runs on your machine.
      </PhaseNotice>
      <Panel title="Planned command coverage">
        <div className="grid gap-3 md:grid-cols-3">
          {GROUPS.map(([name, cmds]) => (
            <div key={name}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">{name}</div>
              <div className="flex flex-wrap gap-1">
                {cmds.map((c) => (
                  <Mono key={c} className="rounded-[3px] border border-border bg-surface-2 px-1.5 py-0.5 text-muted">
                    {c}
                  </Mono>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="What already works without a terminal">
        <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted">
          <li>GPU state the driver would report (nvidia-smi equivalent): GPU Diagnostics</li>
          <li>BMC SEL and sensor health: Rack Explorer → equipment → SEL</li>
          <li>Link state, speed and peers (ip link / ethtool equivalent): Rack Explorer port inspector and Network Lab</li>
        </ul>
      </Panel>
    </Page>
  );
}
