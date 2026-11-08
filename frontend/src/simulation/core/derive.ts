/**
 * Derivation pipeline (ARCHITECTURE §3.3). Runs the independent rule modules in
 * dependency order so that derived state is always consistent with base inputs.
 */
import { deriveCooling } from '@/simulation/cooling/CoolingSystem';
import { deriveThermal } from '@/simulation/cooling/ThermalModel';
import { finalizeHealth } from '@/simulation/diagnostics/HealthMonitor';
import { deriveComponents } from '@/simulation/hardware/ComponentRules';
import { deriveHostStates } from '@/simulation/hardware/Server';
import { deriveCables, derivePorts } from '@/simulation/networking/NetworkPort';
import { accountPower, derivePower } from '@/simulation/power/PowerDistribution';
import { deriveWorkstationNetwork, deriveWorkstationPower } from '@/simulation/workstation/Workstation';
import type { SimulationState } from '@/types/simulation';
import { type DeriveContext, FaultIndex } from './SimulationState';

export function derive(s: SimulationState): void {
  const ctx: DeriveContext = { faults: new FaultIndex(s.faults), power: {} };
  deriveCooling(s, ctx); //   CDU pumps → rack loop flow / temperatures
  derivePower(s, ctx); //     feeds → PDUs/shelves/busbar → PSUs → host capacity
  deriveWorkstationPower(s, ctx); // laptop AC adapter / battery
  deriveHostStates(s, ctx); // host state machine, POST, BMC liveness
  deriveComponents(s, ctx); // per-category status, power, conditions (GPU telemetry)
  derivePorts(s, ctx); //     physical link state
  deriveCables(s, ctx);
  deriveWorkstationNetwork(s); // laptop DHCP / static IP, serial console
  deriveThermal(s, ctx); //   inlet, airflow, fan RPM, component target temperatures
  accountPower(s, ctx); //    actual draw, PDU/feed/busbar/rack totals
  finalizeHealth(s, ctx); //  equipment conditions, degraded state, health roll-ups
}
