/**
 * State helpers: typed accessors and state-classification predicates shared by
 * all rule modules. The state types live in `@/types/simulation`.
 */
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import type { EquipmentKind } from '@/types/catalog';
import type {
  Component,
  Equipment,
  EquipmentState,
  Fault,
  FaultType,
  FeedId,
  Id,
  Port,
  Rack,
  SimulationState,
} from '@/types/simulation';

export type { SimulationState } from '@/types/simulation';

export const HOST_KINDS: ReadonlySet<EquipmentKind> = new Set(['server', 'compute_tray', 'nvlink_switch_tray', 'switch']);

/** States in which main (not just standby) power is applied. */
export const MAIN_POWER_STATES: ReadonlySet<EquipmentState> = new Set(['powered_on', 'booting', 'boot_failed', 'os_running', 'degraded']);
/** States in which the operating system is up. */
export const OS_STATES: ReadonlySet<EquipmentState> = new Set(['os_running', 'degraded']);

export const isHost = (eq: Equipment) => HOST_KINDS.has(eq.kind);
export const isMainPowerOn = (eq: Equipment) => MAIN_POWER_STATES.has(eq.state);
export const isOsUp = (eq: Equipment) => OS_STATES.has(eq.state);
export const isMounted = (eq: Equipment) => eq.location.kind !== 'inventory';
export const hasStandbyPower = (eq: Equipment) => eq.powerCapacityW > 0;

export const feedTargetId = (feed: FeedId) => `feed:${feed}`;

/** Equipment mounted in a rack (U-mounted and 0U). */
export function equipmentInRack(s: SimulationState, rackId: Id): Equipment[] {
  const out: Equipment[] = [];
  for (const eq of Object.values(s.equipment)) {
    if (eq.location.kind === 'rack' && eq.location.rackId === rackId) out.push(eq);
  }
  return out;
}

export function rackOf(s: SimulationState, eq: Equipment): Rack | undefined {
  return eq.location.kind === 'rack' ? s.racks[eq.location.rackId] : undefined;
}

/** Installed components of an equipment, in slot order. */
export function installedComponents(s: SimulationState, eq: Equipment): Component[] {
  const out: Component[] = [];
  for (const cid of Object.values(eq.slots)) {
    if (cid) {
      const c = s.components[cid];
      if (c) out.push(c);
    }
  }
  return out;
}

export function componentInSlot(s: SimulationState, eq: Equipment, slotId: string): Component | undefined {
  const cid = eq.slots[slotId];
  return cid ? s.components[cid] : undefined;
}

export function portsOf(s: SimulationState, eq: Equipment): Port[] {
  const out: Port[] = [];
  for (const pid of eq.portIds) {
    const p = s.ports[pid];
    if (p) out.push(p);
  }
  return out;
}

export function slotOf(c: Component): string | undefined {
  return c.location.kind === 'equipment' ? c.location.slotId : undefined;
}

export function equipmentOf(s: SimulationState, c: Component): Equipment | undefined {
  return c.location.kind === 'equipment' ? s.equipment[c.location.equipmentId] : undefined;
}

export function modelOf(eq: Equipment) {
  return getEquipmentModel(eq.modelId);
}

export function componentModelOf(c: Component) {
  return getComponentModel(c.modelId);
}

/** Far-end port of the cable plugged into `port`, if both ends are attached. */
export function peerPort(s: SimulationState, port: Port): Port | undefined {
  if (!port.cableId || port.cableEnd === null) return undefined;
  const cable = s.cables[port.cableId];
  if (!cable) return undefined;
  const otherId = cable.ends[port.cableEnd === 0 ? 1 : 0].portId;
  return otherId ? s.ports[otherId] : undefined;
}

/** Location label such as `DH01 / R05 / U27`. */
export function locationLabel(s: SimulationState, eq: Equipment): string {
  const loc = eq.location;
  if (loc.kind === 'inventory') return 'Inventory / spares cage';
  if (loc.kind === 'floor') return `${s.facility.id} / floor`;
  const model = getEquipmentModel(eq.modelId);
  if (loc.uStart === null) return `${s.facility.id} / ${loc.rackId} / 0U ${loc.side ?? ''}`.trim();
  const u = model.heightU > 1 ? `U${loc.uStart}–U${loc.uStart + model.heightU - 1}` : `U${loc.uStart}`;
  return `${s.facility.id} / ${loc.rackId} / ${u}`;
}

/** Lookup structure for active faults, rebuilt once per derivation pass. */
export class FaultIndex {
  private readonly byTarget = new Map<Id, Fault[]>();

  constructor(faults: Record<Id, Fault>) {
    for (const f of Object.values(faults)) {
      const list = this.byTarget.get(f.targetId);
      if (list) list.push(f);
      else this.byTarget.set(f.targetId, [f]);
    }
  }

  get(targetId: Id): Fault[] {
    return this.byTarget.get(targetId) ?? [];
  }

  has(targetId: Id, type: FaultType): boolean {
    const list = this.byTarget.get(targetId);
    return !!list && list.some((f) => f.type === type);
  }

  find(targetId: Id, type: FaultType): Fault | undefined {
    return this.byTarget.get(targetId)?.find((f) => f.type === type);
  }
}

export interface PowerContext {
  hasPower: boolean;
  canRun: boolean;
  brake: boolean;
  runDemandW: number;
  idleDemandW: number;
}

export interface DeriveContext {
  faults: FaultIndex;
  power: Record<Id, PowerContext>;
}
