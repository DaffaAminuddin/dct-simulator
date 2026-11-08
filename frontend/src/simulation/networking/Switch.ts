/** Switch helpers: port admin control and port summaries. */
import { portsOf } from '@/simulation/core/SimulationState';
import { fail } from '@/simulation/core/util';
import type { Equipment, Port, SimulationState } from '@/types/simulation';

export function assertAdminControllable(s: SimulationState, port: Port): void {
  const eq = s.equipment[port.equipmentId];
  if (eq.kind !== 'switch') {
    fail('NOT_A_SWITCH_PORT', 'Only switch ports can be enabled/disabled from the switch. Host interfaces are managed from the OS (ip link), which arrives in Phase 3.');
  }
  if (port.role === 'console') fail('NOT_ADMINISTRABLE', 'Console ports have no administrative state.');
}

export interface SwitchPortSummary {
  total: number;
  up: number;
  down: number;
  disabled: number;
  faulty: number;
  empty: number;
}

export function switchPortSummary(s: SimulationState, eq: Equipment): SwitchPortSummary {
  const sum: SwitchPortSummary = { total: 0, up: 0, down: 0, disabled: 0, faulty: 0, empty: 0 };
  for (const p of portsOf(s, eq)) {
    if (p.role === 'console') continue;
    sum.total++;
    if (p.state === 'link_up') sum.up++;
    else if (p.state === 'disabled') sum.disabled++;
    else if (p.state === 'faulty') sum.faulty++;
    else if (p.state === 'disconnected') sum.empty++;
    else sum.down++;
  }
  return sum;
}
