import { Outlet } from 'react-router';
import { LaptopDrawer } from '@/components/laptop/LaptopDrawer';
import { Toaster } from '@/components/ui/misc';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell() {
  return (
    <div className="flex h-full min-h-0">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <LaptopDrawer />
      <Toaster />
    </div>
  );
}

export function Page({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1600px] p-3 sm:p-4 ${className}`}>{children}</div>;
}
