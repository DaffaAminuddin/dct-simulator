/**
 * Sidebar (DESIGN.md §6.1): logo, profile, text navigation, and a bottom group
 * with Settings and the Theme toggle. Collapses to an icon rail at
 * 1024–1279 px and becomes a drawer below 1024 px.
 */
import { FlaskConical, Moon, Settings as SettingsIcon, Sun, X } from 'lucide-react';
import { NavLink } from 'react-router';
import { WORK_ORDERS } from '@/data/workorders/workOrders';
import { effectiveStatus, skillLevel, useProgressStore } from '@/stores/progressStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { NAV } from './nav';

const LABEL = 'inline lg:hidden xl:inline';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden>
      <rect x="9" y="3" width="20" height="26" rx="5" fill="#4cc38a" />
      <rect x="5" y="7" width="20" height="26" rx="5" fill="var(--text-primary)" />
      <path d="M10 14h10M10 19h10M10 24h10" stroke="var(--bg-main)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || 'T';
}

export function Sidebar() {
  const open = useUiStore((s) => s.sidebarOpen);
  const setOpen = useUiStore((s) => s.setSidebarOpen);
  const devMode = useUiStore((s) => s.devMode);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const name = useProgressStore((s) => s.learnerName);
  const modules = useProgressStore((s) => s.modulesCompleted.length);
  const runs = useProgressStore((s) => s.workOrders);
  const resolved = WORK_ORDERS.filter((w) => ['resolved', 'closed'].includes(effectiveStatus(runs[w.id]))).length;
  const skill = skillLevel(modules, resolved);
  const main = NAV.filter((n) => n.group !== 'System');
  const dark = theme === 'dark';

  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex h-[43px] items-center gap-3 rounded-full text-[15px] transition-colors lg:justify-center xl:justify-start',
      isActive ? 'font-semibold text-fg' : 'text-muted hover:text-fg',
    );

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        aria-label="Sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-sidebar px-6 py-7 transition-transform lg:static lg:w-[76px] lg:translate-x-0 lg:px-3 xl:w-60 xl:px-8',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2.5 lg:justify-center xl:justify-start">
          <BrandMark className="size-9 shrink-0" />
          <div className={cn(LABEL, 'leading-tight')}>
            <div className="text-[22px] font-bold tracking-tight">DCT Sim</div>
            <div className="text-[11px] whitespace-nowrap text-muted">Data Center Tech Lab</div>
          </div>
          <button type="button" className="ml-auto text-muted hover:text-fg lg:hidden" aria-label="Close navigation" onClick={() => setOpen(false)}>
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-7 flex flex-col items-center text-center">
          <div className="flex size-[72px] items-center justify-center rounded-full bg-avatar text-[24px] font-bold text-[#16151c] lg:size-11 lg:text-[15px] xl:size-[72px] xl:text-[24px]" aria-hidden>
            {initials(name)}
          </div>
          <div className={cn(LABEL, 'mt-3 max-w-full truncate text-[18px] leading-6 font-semibold')}>{name}</div>
          <div className={cn(LABEL, 'text-[12px] text-muted')}>
            {skill.title} · DC Technician
          </div>
        </div>

        <div className="mx-auto my-6 h-px w-full max-w-40 bg-border" />

        <nav aria-label="Main navigation" className="-mx-2 flex-1 overflow-y-auto px-2">
          {main.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setOpen(false)} className={navClass} title={n.label}>
              <n.icon className="hidden size-[18px] shrink-0 lg:block xl:hidden" />
              <span className={cn(LABEL, 'truncate')}>{n.label}</span>
              {n.phase && <span className={cn(LABEL, 'ml-auto text-[11px] font-medium text-subtle')}>P{n.phase}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="mx-auto my-4 h-px w-full max-w-40 bg-border" />
        <div className="space-y-0.5">
          <NavLink to="/settings" onClick={() => setOpen(false)} className={navClass} title="Settings">
            <SettingsIcon className="hidden size-[18px] shrink-0 lg:block xl:hidden" />
            <span className={LABEL}>Settings</span>
          </NavLink>
          <div className="flex h-[43px] items-center gap-3 text-[15px] text-muted lg:justify-center xl:justify-between">
            <span className={LABEL}>Theme</span>
            <button
              type="button"
              role="switch"
              aria-checked={dark}
              aria-label="Dark theme"
              title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setTheme(dark ? 'light' : 'dark')}
              className={cn('relative h-[22px] w-11 shrink-0 rounded-full transition-colors duration-200', dark ? 'bg-fg' : 'bg-border-strong')}
            >
              <span className={cn('absolute top-[3px] flex size-4 items-center justify-center rounded-full bg-bg transition-[left] duration-200', dark ? 'left-[25px]' : 'left-[3px]')}>
                {dark ? <Moon className="size-2.5 text-fg" /> : <Sun className="size-2.5 text-muted" />}
              </span>
            </button>
          </div>
          {devMode && (
            <div className="flex items-center gap-1.5 pt-1 text-[12px] text-warn-ink lg:justify-center xl:justify-start" title="Developer mode: ground truth visible">
              <FlaskConical className="size-4 shrink-0" />
              <span className={LABEL}>Developer mode</span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
