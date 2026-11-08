/** Storage and PCIe-path rules: drives, RAID controllers, risers. */
import { cond, type RuleContext } from './rules';

export function deriveDrive(rc: RuleContext): string {
  const { comp, slot, hostOn, depOk, conditions } = rc;
  if (rc.ctx.faults.has(comp.id, 'nvme_failure')) {
    conditions.push(cond('DRIVE_FAILED', 'critical', `${slot.label}: drive failed`, ['bmc', 'os', 'led'], true));
    return 'failed';
  }
  if (hostOn && !depOk) {
    conditions.push(cond('DRIVE_NOT_VISIBLE', 'warning', `${slot.label}: not visible (storage controller missing or failed)`, ['os'], true));
    return 'not_detected';
  }
  return hostOn ? 'ok' : 'not_powered';
}

export function deriveRaid(rc: RuleContext): string {
  if (rc.hostOn && !rc.depOk) {
    rc.conditions.push(cond('PCIE_DEVICE_MISSING', 'critical', `${rc.slot.label}: not enumerated (riser missing or failed)`, ['os', 'bmc'], true));
    return 'not_detected';
  }
  return rc.hostOn ? 'ok' : 'not_powered';
}

export function deriveRiser(rc: RuleContext): string {
  if (rc.ctx.faults.has(rc.comp.id, 'riser_failure')) {
    rc.conditions.push(cond('RISER_FAILED', 'critical', `${rc.slot.label}: PCIe link failure, downstream devices lost`, ['bmc', 'os'], true));
    return 'failed';
  }
  return rc.hostOn ? 'ok' : 'not_powered';
}
