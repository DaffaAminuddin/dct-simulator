/** Shared types for per-category component rule modules. */
import type { ComponentModel, SlotDef } from '@/types/catalog';
import type { DeriveContext } from '@/simulation/core/SimulationState';
import type { Channel, Component, Condition, Equipment, Severity, SimulationState } from '@/types/simulation';

export interface RuleContext {
  s: SimulationState;
  ctx: DeriveContext;
  comp: Component;
  eq: Equipment;
  model: ComponentModel;
  slot: SlotDef;
  /** Main power applied to the host. */
  hostOn: boolean;
  /** This component is energised. */
  powered: boolean;
  /** Upstream slot dependency (riser, CPU) is present and healthy. */
  depOk: boolean;
  conditions: Condition[];
  /** Healthy, powered NVLink switch trays in the rack (MGX racks only). */
  healthySwitchTrays: number;
}

export function cond(
  code: string,
  severity: Severity,
  message: string,
  channels: Channel[],
  degradesHost = false,
): Condition {
  return { code, severity, message, channels, degradesHost };
}
