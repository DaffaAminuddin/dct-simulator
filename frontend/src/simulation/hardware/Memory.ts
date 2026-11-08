/** Memory rules: uncorrectable ECC on DIMMs. */
import { cond, type RuleContext } from './rules';

export function deriveDimm(rc: RuleContext): string {
  if (rc.ctx.faults.has(rc.comp.id, 'dimm_uncorrectable')) {
    // DIMM fault LEDs are lit from standby power, so the LED channel works even with the host off.
    rc.conditions.push(cond('DIMM_UNCORRECTABLE', 'critical', `Uncorrectable ECC error on ${rc.slot.label}`, ['bmc', 'os', 'led'], true));
    return 'failed';
  }
  return rc.hostOn ? 'ok' : 'not_powered';
}

/** DIMM population sanity (best practice, not enforced): same capacity per channel. */
export function mixedCapacityWarning(capacities: number[]): string | null {
  const uniq = new Set(capacities);
  return uniq.size > 1 ? `Mixed DIMM capacities (${[...uniq].join(' / ')} GB) reduce memory performance` : null;
}
