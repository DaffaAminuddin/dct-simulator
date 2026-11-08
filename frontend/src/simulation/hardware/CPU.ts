/** CPU rules: internal error (IERR) detection. POST impact lives in Server.postCheck. */
import { cond, type RuleContext } from './rules';

export function deriveCpu(rc: RuleContext): string {
  if (rc.ctx.faults.has(rc.comp.id, 'cpu_failure')) {
    rc.conditions.push(cond('CPU_IERR', 'critical', `${rc.slot.label}: processor internal error (IERR)`, ['bmc', 'led'], true));
    return 'failed';
  }
  return rc.hostOn ? 'ok' : 'not_powered';
}
