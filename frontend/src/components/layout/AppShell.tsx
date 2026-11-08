import { Outlet } from 'react-router';
import { LaptopDrawer } from '@/components/laptop/LaptopDrawer';
import { Toaster } from '@/components/ui/misc';
import { cn } from '@/utils/cn';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * App frame (DESIGN.md §2): canvas, rounded frame with a soft shadow, sidebar,
 * and the main panel whose rounded left edge sits over the sidebar.
 */
export function AppShell() {
  return (
    <div className="h-full bg-canvas xl:p-3">
      <div className="flex h-full min-h-0 overflow-hidden bg-sidebar xl:rounded-panel xl:shadow-[0_40px_80px_rgba(22,21,28,0.12)]">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col bg-bg lg:rounded-l-panel">
          <TopBar />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <LaptopDrawer />
      <Toaster />
    </div>
  );
}

export function Page({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1680px] px-4 py-5 lg:px-10 lg:py-7', className)}>{children}</div>;
}
