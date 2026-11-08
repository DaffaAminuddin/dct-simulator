import { FlaskConical, X } from 'lucide-react';
import { NavLink } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { NAV } from './nav';

const MODE_LABEL = { guided: 'Guided Learning', practice: 'Practice Lab', incident: 'Incident Simulation' } as const;

export function Sidebar() {
  const open = useUiStore((s) => s.sidebarOpen);
  const setOpen = useUiStore((s) => s.setSidebarOpen);
  const devMode = useUiStore((s) => s.devMode);
  const mode = useUiStore((s) => s.trainingMode);
  const groups = ['Operate', 'Train', 'System'] as const;

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-surface transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-12 items-center gap-2.5 border-b border-border px-3">
          <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
            <rect width="32" height="32" rx="6" fill="#171b1e" />
            <g fill="none" stroke="#7cc33f" strokeWidth="2">
              <rect x="9" y="5" width="14" height="22" rx="1.5" />
              <path d="M12 10h8M12 14h8M12 18h8" />
            </g>
            <circle cx="20" cy="23" r="1.4" fill="#7cc33f" />
          </svg>
          <div className="min-w-0 leading-tight">
            <div className="text-[13px] font-semibold tracking-[0.12em]">DCT SIMULATOR</div>
            <div className="truncate text-[10.5px] text-subtle">Data Center Technician Virtual Lab</div>
          </div>
          <button type="button" className="ml-auto text-muted hover:text-fg lg:hidden" aria-label="Close navigation" onClick={() => setOpen(false)}>
            <X className="size-4" />
          </button>
        </div>
        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-2 py-2">
          {groups.map((g) => (
            <div key={g} className="mb-2">
              <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle">{g}</div>
              {NAV.filter((n) => n.group === g).map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === '/'}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'group flex h-8 items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] text-muted hover:bg-surface-3 hover:text-fg',
                      isActive && 'bg-surface-3 text-fg shadow-[inset_2px_0_0_var(--color-accent)]',
                    )
                  }
                >
                  <n.icon className="size-4 shrink-0" />
                  <span className="truncate">{n.label}</span>
                  {n.phase && (
                    <Badge tone="muted" className="ml-auto h-4 px-1 text-[10px]">
                      P{n.phase}
                    </Badge>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="space-y-1.5 border-t border-border px-3 py-2.5 text-[11px]">
          <div className="flex items-center justify-between text-muted">
            <span>Mode</span>
            <span className="text-fg">{MODE_LABEL[mode]}</span>
          </div>
          {devMode && (
            <div className="flex items-center gap-1.5 text-warn">
              <FlaskConical className="size-3.5" /> Developer mode: ground truth visible
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
