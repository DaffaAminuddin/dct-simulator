/**
 * Fan rules. Each working fan can push 1.25× its nominal share of airflow, so
 * an N+1 fan set compensates for a single failure (SIMULATION_SPEC §4).
 */
import { cond, type RuleContext } from './rules';

export const FAN_HEADROOM = 1.25;

export function deriveFan(rc: RuleContext): string {
  if (rc.ctx.faults.has(rc.comp.id, 'fan_failure')) {
    rc.conditions.push(cond('FAN_FAILED', 'warning', `${rc.slot.label}: fan failure (0 RPM)`, ['bmc', 'led'], true));
    return 'failed';
  }
  return rc.hostOn ? 'ok' : 'stopped';
}

export interface AirflowResult {
  /** Delivered / required airflow, capped at 1. */
  airflowFactor: number;
  /** Fan duty cycle 0..1 for working fans. */
  duty: number;
  workingFans: number;
}

/**
 * @param fanSlots number of fan slots in the chassis
 * @param workingFans installed, non-failed fans with main power
 * @param loadFraction actual draw / max possible draw (0..1)
 * @param chassisOpen an open lid short-circuits the airflow path
 */
export function computeAirflow(fanSlots: number, workingFans: number, loadFraction: number, chassisOpen: boolean): AirflowResult {
  if (fanSlots === 0) return { airflowFactor: 1, duty: 0, workingFans: 0 };
  const demand = 0.35 + 0.65 * Math.min(1, Math.max(0, loadFraction));
  const capacity = (workingFans * FAN_HEADROOM) / fanSlots;
  let factor = capacity <= 0 ? 0 : Math.min(1, capacity / demand);
  let duty = capacity <= 0 ? 0 : Math.min(1, Math.max(0.25, demand / capacity));
  if (chassisOpen) {
    factor *= 0.7;
    duty = workingFans > 0 ? 1 : 0;
  }
  return { airflowFactor: Math.round(factor * 100) / 100, duty, workingFans };
}
