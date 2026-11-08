import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { LaptopDrawer } from '@/components/laptop/LaptopDrawer';
import { PortDetails } from '@/components/networking/PortDetails';
import { engine, useSimulationStore } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';

function patchLaptop() {
  const cable = Object.values(engine.getState().cables).find((c) => c.modelId === 'cat6-2m' && !c.ends[0].portId && !c.ends[1].portId)!;
  engine.dispatch({ type: 'cable/connect', cableId: cable.id, end: 0, portId: 'laptop-01:eth0' });
  engine.dispatch({ type: 'cable/connect', cableId: cable.id, end: 1, portId: 'oob-r01:ge48' });
}

function renderLaptop(app: 'network' | 'ssh' | 'browser' | 'console') {
  useUiStore.setState({ laptopOpen: true, laptopApp: app });
  return render(
    <MemoryRouter>
      <LaptopDrawer />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useSimulationStore.getState().reset();
  useUiStore.setState({ devMode: false, cableInHand: null, toasts: [], laptopOpen: false });
});

describe('technician laptop UI', () => {
  it('network app shows no cable, then the DHCP lease once patched', () => {
    renderLaptop('network');
    expect(screen.getByText('no cable')).toBeInTheDocument();
    act(() => patchLaptop());
    expect(screen.getByText('DHCP lease')).toBeInTheDocument();
    expect(screen.getByText('10.10.250.100/16 (255.255.0.0)')).toBeInTheDocument();
  });

  it('applying a static address goes through the engine', () => {
    patchLaptop();
    renderLaptop('network');
    fireEvent.click(screen.getByLabelText('Manual'));
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '10.10.250.42' } });
    fireEvent.change(screen.getByLabelText('Gateway'), { target: { value: '10.10.0.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(engine.getState().workstation.effective).toMatchObject({ source: 'static', address: '10.10.250.42' });
  });

  it('SSH app connects to a BMC and is refused with the wrong credential', () => {
    patchLaptop();
    renderLaptop('ssh');
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
    expect(screen.getByText('Connected')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Credential profile'), { target: { value: 'linux-dct' } });
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
    expect(screen.getByTestId('laptop-output').textContent).toMatch(/Permission denied/);
  });

  it('browser opens the BMC web UI and powers the host off through Redfish', () => {
    patchLaptop();
    renderLaptop('browser');
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByTestId('bmc-web-ui')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Power off/ }));
    expect(engine.getState().equipment['srv-r01-01'].state).toBe('standby');
  });

  it('console app explains how to attach a console cable', () => {
    renderLaptop('console');
    expect(screen.getByText('No serial console attached')).toBeInTheDocument();
  });
});

describe('switch port VLAN editor', () => {
  it('changes an access VLAN through the engine', () => {
    render(<PortDetails portId="oob-r01:ge1" onClose={() => {}} onJump={() => {}} />);
    fireEvent.change(screen.getByLabelText('Access VLAN'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(engine.getState().ports['oob-r01:ge1'].vlan).toMatchObject({ mode: 'access', access: 20 });
  });
});
