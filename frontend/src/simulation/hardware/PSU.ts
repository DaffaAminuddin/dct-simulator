/** PSU rules: AC input loss and internal failure. Input/output flags come from PowerDistribution. */
import { cond, type RuleContext } from './rules';

export function derivePsu(rc: RuleContext): string {
  const { comp, slot, conditions } = rc;
  const failed = rc.ctx.faults.has(comp.id, 'psu_failure');
  const label = slot.label;
  if (!comp.inputLive) {
    conditions.push(cond('PSU_NO_INPUT', 'warning', `${label}: AC input lost`, ['bmc', 'led'], true));
    return 'no_input';
  }
  if (failed) {
    conditions.push(cond('PSU_FAILED', 'critical', `${label}: power supply failure`, ['bmc', 'led'], true));
    return 'failed';
  }
  return 'ok';
}
