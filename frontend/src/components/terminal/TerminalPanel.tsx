/**
 * Dark terminal card: session breadcrumb (laptop → BMC → host), controls,
 * and the lazily loaded xterm view.
 */
import { ChevronRight, Cpu, Eraser, Laptop, Server, Unplug } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useNavigate } from 'react-router';
import { sessionPath } from '@/simulation/terminal/Session';
import { useTerminalStore } from '@/stores/terminalStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';

const TerminalView = lazy(() => import('./TerminalView'));

const VIA: Record<string, string> = { local: '', ssh: 'SSH', sol: 'SOL', serial: 'serial' };

export function SessionPath({ className }: { className?: string }) {
  const session = useTerminalStore((s) => s.session);
  const path = sessionPath(session);
  return (
    <ol className={cn('flex min-w-0 flex-wrap items-center gap-1', className)} aria-label="Terminal session">
      {path.map((f, i) => {
        const Icon = f.kind === 'laptop' ? Laptop : f.kind === 'bmc' ? Cpu : Server;
        return (
          <li key={`${f.host}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 text-[#6b6a74]" aria-hidden />}
            <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11.5px]', i === path.length - 1 ? 'bg-[#4cc38a]/15 text-[#7ee0ad]' : 'bg-white/5 text-[#c9c8cf]')}>
              <Icon className="size-3.5" aria-hidden />
              {f.user}@{f.host}
              {VIA[f.via] && <span className="text-[10px] tracking-wide text-[#8e8d96] uppercase">{VIA[f.via]}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Terminal app inside the laptop window. */
export function LaptopTerminalApp() {
  const navigate = useNavigate();
  return (
    <div className="space-y-2">
      <TerminalPanel compact className="h-[440px]" />
      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>Same session as the Terminal page.</span>
        <button
          type="button"
          className="font-medium text-accent-strong hover:underline"
          onClick={() => {
            useUiStore.getState().setLaptopOpen(false);
            navigate('/terminal');
          }}
        >
          Open full screen
        </button>
      </div>
    </div>
  );
}

export function TerminalPanel({ className, compact = false }: { className?: string; compact?: boolean }) {
  const depth = useTerminalStore((s) => s.session.frames.length);
  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden rounded-box border border-border bg-[#16151c] text-[#e7e6ea]', className)} aria-label="Terminal">
      <header className={cn('flex items-center gap-2 border-b border-white/10', compact ? 'px-3 py-2' : 'px-4 py-2.5')}>
        <SessionPath className="flex-1" />
        <button
          type="button"
          onClick={() => useTerminalStore.getState().clear()}
          className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-[#c9c8cf] hover:bg-white/10"
          title="Clear screen (Ctrl+L)"
        >
          <Eraser className="size-3.5" /> Clear
        </button>
        <button
          type="button"
          disabled={depth <= 1}
          onClick={() => useTerminalStore.getState().resetSession()}
          className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-[#c9c8cf] hover:bg-white/10 disabled:opacity-40"
          title="Close every SSH / SOL / console hop"
        >
          <Unplug className="size-3.5" /> Disconnect all
        </button>
      </header>
      <div className={cn('min-h-0 flex-1', compact ? 'p-2' : 'p-3')}>
        <Suspense fallback={<div className="p-2 font-mono text-[12px] text-[#8e8d96]">Loading terminal…</div>}>
          <TerminalView />
        </Suspense>
      </div>
    </section>
  );
}
