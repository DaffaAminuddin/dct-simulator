/**
 * Terminal: the technician laptop's shell, full screen. Every command is
 * parsed and evaluated against the live simulation (OS, driver and BMC
 * observation channels); nothing runs on the learner's machine.
 */
import { CircleCheck, CircleDashed, Play } from 'lucide-react';
import { Link } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { Panel } from '@/components/ui/panel';
import { commandReference } from '@/simulation/terminal/CommandRegistry';
import { topFrame } from '@/simulation/terminal/Session';
import { laptopPort } from '@/simulation/workstation/Workstation';
import { useSim } from '@/stores/simulationStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { cn } from '@/utils/cn';

const GROUP_LABEL: Record<string, string> = {
  shell: 'Shell',
  files: 'Files',
  text: 'Text filters',
  system: 'System and hardware',
  network: 'Network',
  nvidia: 'NVIDIA GPU',
  bmc: 'BMC / IPMI',
  fabric: 'Fabric (later phases)',
};

function Run({ cmd }: { cmd: string }) {
  return (
    <button
      type="button"
      onClick={() => useTerminalStore.getState().submit(cmd)}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-left font-mono text-[11.5px] text-fg hover:border-border-strong hover:bg-surface-3"
      title={`Run: ${cmd}`}
    >
      <Play className="size-3 shrink-0 text-ok-ink" aria-hidden />
      <span className="truncate">{cmd}</span>
    </button>
  );
}

function Step({ n, done, title, children }: { n: number; done?: boolean; title: string; children: React.ReactNode }) {
  const Icon = done ? CircleCheck : CircleDashed;
  return (
    <li className="flex gap-3">
      <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', done ? 'bg-ok-soft text-ok-ink' : 'bg-surface-2 text-muted')}>
        {done ? <Icon className="size-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-[13px] font-semibold">{title}</div>
        {children}
      </div>
    </li>
  );
}

export function TerminalPage() {
  const ws = useSim((s) => s.workstation);
  const eth = useSim((s) => laptopPort(s, 'eth0'));
  const frame = useTerminalStore((s) => topFrame(s.session));
  const linked = eth?.state === 'link_up' && !!ws.effective.address && ws.effective.source !== 'apipa';
  const onBmc = frame.kind === 'bmc';
  const onHost = frame.kind === 'host';
  const groups = commandReference(frame.kind).reduce<Record<string, { name: string; summary: string }[]>>((acc, c) => {
    (acc[c.group] ??= []).push(c);
    return acc;
  }, {});

  return (
    <Page className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <TerminalPanel className="h-[calc(100dvh-190px)] min-h-[480px]" />
      <aside className="min-w-0 space-y-6">
        <Panel title="Getting into a server" subtitle="Click a command to run it in the terminal">
          <ol className="space-y-4">
            <Step n={1} done={linked} title="Patch the laptop into the OOB network">
              <p className="text-[12px] text-muted">
                {linked ? (
                  <>
                    eth0 has <span className="font-mono">{ws.effective.address}</span> ({ws.effective.source}).
                  </>
                ) : (
                  <>
                    Cable the laptop&apos;s eth0 to a management switch port from the crash cart in{' '}
                    <Link to="/racks/R01" className="font-medium text-accent-strong hover:underline">
                      Rack Explorer
                    </Link>{' '}
                    (rear view).
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Run cmd="ip -br a" />
                <Run cmd="ping -c 2 dh1-r01-n01-bmc" />
              </div>
            </Step>
            <Step n={2} done={onBmc || onHost} title="Log in to a BMC (vault account admin)">
              <div className="flex flex-wrap gap-1.5">
                <Run cmd="ssh admin@dh1-r01-n01-bmc" />
                <Run cmd="ssh admin@dh1-r03-g01-bmc" />
              </div>
            </Step>
            <Step n={3} done={onHost} title="Open the host console">
              <p className="text-[12px] text-muted">Serial-over-LAN from the BMC, or the USB console cable on the laptop.</p>
              <div className="flex flex-wrap gap-1.5">
                <Run cmd="power status" />
                <Run cmd="sel elist" />
                <Run cmd="sol activate" />
              </div>
            </Step>
            <Step n={4} title="Investigate from the OS">
              <div className="flex flex-wrap gap-1.5">
                <Run cmd="nvidia-smi" />
                <Run cmd="lspci | grep -i nvidia" />
                <Run cmd="sudo dmesg | grep -i xid" />
                <Run cmd="ip -br link" />
                <Run cmd="journalctl -p err" />
              </div>
            </Step>
          </ol>
        </Panel>
        <Panel title="Commands in this shell" subtitle={`${frame.user}@${frame.host} · type help for details`} bodyClassName="space-y-3">
          {Object.entries(groups).map(([g, cmds]) => (
            <div key={g}>
              <div className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">{GROUP_LABEL[g] ?? g}</div>
              <ul className="space-y-0.5">
                {cmds.map((c) => (
                  <li key={c.name} className="flex gap-2 text-[12px]">
                    <span className="w-[92px] shrink-0 font-mono text-fg">{c.name}</span>
                    <span className="min-w-0 text-muted">{c.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Panel>
      </aside>
    </Page>
  );
}
