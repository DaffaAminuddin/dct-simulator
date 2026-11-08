import { useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { AppShell, Page } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/panel';
import { DashboardPage } from '@/pages/DashboardPage';
import { DataCenterPage } from '@/pages/DataCenterPage';
import { FacilityPage } from '@/pages/FacilityPage';
import { GpuDiagnosticsPage } from '@/pages/GpuDiagnosticsPage';
import { HardwareLabPage } from '@/pages/HardwareLabPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { LearningCenterPage } from '@/pages/LearningCenterPage';
import { NetworkLabPage } from '@/pages/NetworkLabPage';
import { ProgressPage } from '@/pages/ProgressPage';
import { RackExplorerPage } from '@/pages/RackExplorerPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TerminalPage } from '@/pages/TerminalPage';
import { WorkOrdersPage } from '@/pages/WorkOrdersPage';
import { saveState } from '@/simulation/core/persistence';
import { engine, useSimulationStore } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';

function NotFound() {
  return (
    <Page>
      <EmptyState title="Page not found">
        <Link to="/">
          <Button>Back to dashboard</Button>
        </Link>
      </EmptyState>
    </Page>
  );
}

function PageError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <Page>
      <EmptyState title="This view failed to render">
        <div className="mb-3 font-mono text-[11px] text-crit">{error.message}</div>
        <Button onClick={reset}>Try again</Button>
      </EmptyState>
    </Page>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="datacenter" element={<DataCenterPage />} />
        <Route path="racks/:rackId?" element={<RackExplorerPage />} />
        <Route path="hardware/:equipmentId?" element={<HardwareLabPage />} />
        <Route path="network" element={<NetworkLabPage />} />
        <Route path="gpu" element={<GpuDiagnosticsPage />} />
        <Route path="facility" element={<FacilityPage />} />
        <Route path="terminal" element={<TerminalPage />} />
        <Route path="workorders/:id?" element={<WorkOrdersPage />} />
        <Route path="learn/:moduleId?" element={<LearningCenterPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="progress" element={<ProgressPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function useThemeAttribute() {
  const theme = useUiStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}

export default function App() {
  useThemeAttribute();
  useEffect(() => {
    // Start the real-time clock; in development expose the engine for debugging and E2E checks.
    useSimulationStore.getState().setRunning(true);
    if (import.meta.env.DEV) (window as unknown as { __dct?: unknown }).__dct = { engine, store: useSimulationStore };
    // Warm the lazily loaded 3D chunk so the data hall opens instantly.
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => void import('@/scenes/DataHallScene/DataHallScene'));
    // Persist the lab across reloads of this tab.
    const save = () => saveState(engine.getState());
    const onVisibility = () => document.visibilityState === 'hidden' && save();
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onVisibility);
      useSimulationStore.getState().setRunning(false);
    };
  }, []);

  return (
    <BrowserRouter>
      <ErrorBoundary fallback={(e, reset) => <PageError error={e} reset={reset} />}>
        <AppRoutes />
      </ErrorBoundary>
    </BrowserRouter>
  );
}
