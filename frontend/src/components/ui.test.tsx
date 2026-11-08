import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortDetails } from '@/components/networking/PortDetails';
import { RackElevation } from '@/components/rack/RackElevation';
import { EquipmentDetails } from '@/components/server/EquipmentDetails';
import { DashboardPage } from '@/pages/DashboardPage';
import { WorkOrdersPage } from '@/pages/WorkOrdersPage';
import { engine, useSimulationStore } from '@/stores/simulationStore';
import { useProgressStore } from '@/stores/progressStore';
import { useUiStore } from '@/stores/uiStore';
import { AppRoutes } from '@/App';

beforeEach(() => {
  useSimulationStore.getState().reset();
  useUiStore.setState({ devMode: false, cableInHand: null, selectedEquipmentId: null, selectedPortId: null, toasts: [] });
});

describe('RackElevation', () => {
  it('renders U numbering, mounted equipment and open positions', () => {
    const onSelect = vi.fn();
    render(<RackElevation rackId="R01" side="front" selectedEquipmentId={null} selectedPortId={null} devMode={false} onSelectEquipment={onSelect} onSelectPort={vi.fn()} />);
    const rack = screen.getByTestId('rack-elevation-R01');
    expect(within(rack).getAllByText('42').length).toBeGreaterThan(0);
    expect(within(rack).getByRole('button', { name: 'Empty U18' })).toBeInTheDocument();
    fireEvent.click(within(rack).getByRole('button', { name: /dh1-r01-n03, RS-1100/ }));
    expect(onSelect).toHaveBeenCalledWith('srv-r01-03');
  });

  it('shows 0U PDUs with outlets on the rear view', () => {
    render(<RackElevation rackId="R01" side="rear" selectedEquipmentId={null} selectedPortId={null} devMode={false} onSelectEquipment={vi.fn()} onSelectPort={vi.fn()} />);
    expect(screen.getByRole('button', { name: /dh1-r01-pdu-a, 0U PDU feed A/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Port Outlet 1 (C13)' })).toHaveLength(2);
  });
});

describe('EquipmentDetails', () => {
  it('reflects engine state and powers the host off through the engine', () => {
    render(
      <MemoryRouter>
        <EquipmentDetails equipmentId="srv-r01-02" />
      </MemoryRouter>,
    );
    expect(screen.getByText('OS running')).toBeInTheDocument();
    expect(screen.getByText('BMC reachable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Power off/ }));
    expect(engine.getState().equipment['srv-r01-02'].state).toBe('standby');
    expect(screen.getByText('Standby')).toBeInTheDocument();
  });
});

describe('PortDetails cable workflow', () => {
  it('connects a compatible cord from inventory and holds the free end', () => {
    render(<PortDetails portId="srv-r02-n04:psu2.ac" onClose={vi.fn()} onJump={vi.fn()} />);
    expect(screen.getByText('No cord')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
    const port = engine.getState().ports['srv-r02-n04:psu2.ac'];
    expect(port.cableId).not.toBeNull();
    expect(useUiStore.getState().cableInHand).toMatchObject({ cableId: port.cableId, freeEnd: 1 });
  });

  it('refuses an incompatible port and keeps the cable in hand', () => {
    const cord = Object.values(engine.getState().cables).find((c) => c.modelId === 'pwr-c13c14-2m' && !c.ends[0].portId)!;
    useUiStore.setState({ cableInHand: { cableId: cord.id, freeEnd: 0 } });
    render(<PortDetails portId="srv-r07-free" onClose={vi.fn()} onJump={vi.fn()} />);
    // Unknown port renders nothing.
    expect(screen.queryByText('Plug in here')).toBeNull();
    render(<PortDetails portId="tor-r01:swp20" onClose={vi.fn()} onJump={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Plug in here/ }));
    expect(engine.getState().ports['tor-r01:swp20'].cableId).toBeNull();
    expect(useUiStore.getState().toasts.at(-1)?.detail).toMatch(/IEC C13 plug does not fit this SFP28 port/);
    expect(useUiStore.getState().cableInHand?.cableId).toBe(cord.id);
  });
});

describe('Dashboard', () => {
  it('shows monitoring alerts derived from the engine', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Facility Record' })).toBeInTheDocument();
    expect(screen.getByText('87/88')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Feed' }), { target: { value: 'alerts' } });
    expect(screen.getByRole('heading', { name: 'Active Alerts' })).toBeInTheDocument();
    expect(screen.getByText('PSU 2: AC input lost')).toBeInTheDocument();
  });

  it('scopes the facility record to one rack', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Scope' }), { target: { value: 'R01' } });
    expect(screen.getByText('10/10')).toBeInTheDocument();
  });
});

describe('Theme and profile', () => {
  it('toggles the dark theme from the sidebar and renames the learner', () => {
    useUiStore.setState({ theme: 'light' });
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Dark theme' }));
    expect(useUiStore.getState().theme).toBe('dark');
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), { target: { value: 'Daffa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(useProgressStore.getState().learnerName).toBe('Daffa');
    expect(screen.getAllByText('Daffa').length).toBeGreaterThan(0);
    useProgressStore.getState().setLearnerName('Technician');
    useUiStore.setState({ theme: 'light' });
  });
});

describe('Work orders', () => {
  it('validates the seeded DCT-0002 ticket against the simulation', () => {
    render(
      <MemoryRouter initialEntries={['/workorders/DCT-0002']}>
        <Routes>
          <Route path="/workorders/:id" element={<WorkOrdersPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Run validation/ }));
    expect(screen.getByText('PSU 2 receives AC input')).toBeInTheDocument();
    expect(useUiStore.getState().toasts.at(-1)?.title).toBe('Validation failed');
  });
});

describe('Routing', () => {
  it('renders every main route without crashing', () => {
    const routes = ['/', '/racks/R05', '/hardware/srv-r03-g01', '/network', '/gpu', '/facility', '/terminal', '/workorders', '/learn', '/inventory', '/progress', '/settings', '/nope'];
    for (const r of routes) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[r]}>
          <AppRoutes />
        </MemoryRouter>,
      );
      expect(screen.getAllByText('DCT Sim').length).toBeGreaterThan(0);
      unmount();
    }
  });
});
