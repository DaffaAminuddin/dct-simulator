/**
 * Component servicing rules (SIMULATION_SPEC §7): field-replaceability, form
 * factor compatibility, matching PSU/GPU models, hot-swap vs. power-off,
 * chassis access and attached cables.
 */
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { isMainPowerOn, portsOf } from '@/simulation/core/SimulationState';
import { fail } from '@/simulation/core/util';
import type { ComponentModel, PortDef, SlotDef } from '@/types/catalog';
import type { Equipment, Id, Port, SimulationState } from '@/types/simulation';
import { mixedCapacityWarning } from './Memory';

export const UNSAFE_STANDBY_WARNING =
  'Unsafe procedure: standby power is still present. Industry practice is to disconnect AC power before servicing internal components.';

function accessChecks(eq: Equipment, slot: SlotDef, model: ComponentModel, verb: 'remove' | 'install'): string[] {
  const warnings: string[] = [];
  if (slot.access === 'internal' && !eq.chassisOpen) fail('CHASSIS_CLOSED', `Open the chassis lid before you ${verb} the ${slot.label}`);
  if (!model.hotSwap) {
    if (isMainPowerOn(eq)) fail('HOST_RUNNING', `${slot.label} is not hot-swappable: power off ${eq.hostname} first`);
    if (eq.powerCapacityW > 0) warnings.push(UNSAFE_STANDBY_WARNING);
  }
  return warnings;
}

export function validateRemove(s: SimulationState, componentId: Id): string[] {
  const comp = s.components[componentId];
  if (!comp) fail('UNKNOWN_COMPONENT', `Unknown component ${componentId}`);
  if (comp.location.kind !== 'equipment') fail('NOT_INSTALLED', 'Component is not installed');
  const eq = s.equipment[comp.location.equipmentId];
  const slotId = comp.location.slotId;
  const slot = getEquipmentModel(eq.modelId).slots.find((sl) => sl.id === slotId) as SlotDef;
  const model = getComponentModel(comp.modelId);
  if (!model.fieldReplaceable) {
    const unit = eq.kind === 'compute_tray' ? 'compute tray' : eq.kind === 'nvlink_switch_tray' ? 'switch tray' : 'parent assembly';
    fail('NOT_FRU', `${model.name} is not a field-replaceable unit in this system: replace the ${unit}`);
  }
  const cabled = portsOf(s, eq).filter((p) => p.componentId === componentId && p.cableId);
  if (cabled.length > 0) fail('CABLES_ATTACHED', `Disconnect the cable(s) from ${cabled.map((p) => p.label).join(', ')} first`);
  return accessChecks(eq, slot, model, 'remove');
}

export function validateInstall(s: SimulationState, componentId: Id, equipmentId: Id, slotId: string): string[] {
  const comp = s.components[componentId];
  if (!comp) fail('UNKNOWN_COMPONENT', `Unknown component ${componentId}`);
  if (comp.location.kind !== 'inventory') fail('ALREADY_INSTALLED', 'Remove the component from its current system first');
  const eq = s.equipment[equipmentId];
  if (!eq) fail('UNKNOWN_EQUIPMENT', `Unknown equipment ${equipmentId}`);
  const eqModel = getEquipmentModel(eq.modelId);
  const slot = eqModel.slots.find((sl) => sl.id === slotId);
  if (!slot) fail('UNKNOWN_SLOT', `${eqModel.shortName} has no slot ${slotId}`);
  if (eq.slots[slotId]) fail('SLOT_OCCUPIED', `${slot.label} is already populated`);
  const model = getComponentModel(comp.modelId);
  if (!slot.accepts.includes(model.formFactor)) {
    fail('INCOMPATIBLE', `Incompatible part: ${slot.label} accepts ${slot.accepts.join(' / ')}; ${model.name} is ${model.formFactor}`);
  }

  const warnings: string[] = [];
  const siblings = eqModel.slots
    .filter((sl) => sl.category === slot.category && sl.id !== slotId)
    .map((sl) => eq.slots[sl.id])
    .filter((id): id is Id => !!id)
    .map((id) => s.components[id]);

  if (model.category === 'psu' && siblings.some((c) => c.modelId !== comp.modelId)) {
    const installed = getComponentModel(siblings[0].modelId).name;
    fail('PSU_MISMATCH', `Mixed PSU models are not supported: installed PSUs are ${installed}`);
  }
  if (model.category === 'gpu' && siblings.some((c) => c.modelId !== comp.modelId)) {
    fail('GPU_MISMATCH', 'All GPUs on the baseboard must be the same model');
  }
  if (model.category === 'dimm') {
    const caps = [...siblings, comp].map((c) => Number(getComponentModel(c.modelId).specs.capacityGB));
    const w = mixedCapacityWarning(caps);
    if (w) warnings.push(w);
  }
  warnings.push(...accessChecks(eq, slot, model, 'install'));
  return warnings;
}

/** Spare components in inventory that physically fit a slot. */
export function compatibleSpares(s: SimulationState, equipmentId: Id, slotId: string): Id[] {
  const eq = s.equipment[equipmentId];
  const slot = getEquipmentModel(eq.modelId).slots.find((sl) => sl.id === slotId);
  if (!slot) return [];
  return Object.values(s.components)
    .filter((c) => c.location.kind === 'inventory' && slot.accepts.includes(getComponentModel(c.modelId).formFactor))
    .map((c) => c.id);
}

/** Linux-style interface name for a component port. */
function osNameFor(slot: SlotDef, def: PortDef, index: number): string | undefined {
  const n = Number(/(\d+)$/.exec(slot.id)?.[1] ?? 0);
  if (def.type === 'osfp') return `ibp${n}s0`;
  if (slot.id.startsWith('ocp')) return `ens${n + 1}f${index}np${index}`;
  if (slot.category === 'dpu') return `enP${n + 2}p${index}s0`;
  if (def.role === 'data') return `enp${n + 3}s0f${index}`;
  return def.osName;
}

/** Create the ports a component brings with it (NIC cages, PSU inlet). */
export function createComponentPorts(s: SimulationState, eq: Equipment, slotId: string, componentId: Id): void {
  const slot = getEquipmentModel(eq.modelId).slots.find((sl) => sl.id === slotId) as SlotDef;
  const model = getComponentModel(s.components[componentId].modelId);
  (model.ports ?? []).forEach((def, i) => {
    const id = `${eq.id}:${slotId}.${def.id}`;
    const port: Port = {
      id,
      equipmentId: eq.id,
      componentId,
      slotId,
      defId: def.id,
      label: model.category === 'psu' ? `${slot.label} AC inlet` : `${slot.label} ${def.label}`,
      osName: osNameFor(slot, def, i),
      type: def.type,
      role: def.role,
      speedsGbps: def.speedsGbps,
      side: slot.panel?.side ?? def.side,
      adminUp: true,
      cableId: null,
      cableEnd: null,
      state: 'disconnected',
      speedGbps: 0,
      peerPortId: null,
    };
    s.ports[id] = port;
    eq.portIds.push(id);
  });
}

export function removeComponentPorts(s: SimulationState, eq: Equipment, componentId: Id): void {
  const remove = eq.portIds.filter((pid) => s.ports[pid]?.componentId === componentId);
  for (const pid of remove) delete s.ports[pid];
  eq.portIds = eq.portIds.filter((pid) => !remove.includes(pid));
}

export function removeComponent(s: SimulationState, componentId: Id): string[] {
  const warnings = validateRemove(s, componentId);
  const comp = s.components[componentId];
  if (comp.location.kind !== 'equipment') return warnings;
  const eq = s.equipment[comp.location.equipmentId];
  eq.slots[comp.location.slotId] = null;
  removeComponentPorts(s, eq, componentId);
  comp.location = { kind: 'inventory' };
  return warnings;
}

export function installComponent(s: SimulationState, componentId: Id, equipmentId: Id, slotId: string): string[] {
  const warnings = validateInstall(s, componentId, equipmentId, slotId);
  const eq = s.equipment[equipmentId];
  const comp = s.components[componentId];
  eq.slots[slotId] = componentId;
  comp.location = { kind: 'equipment', equipmentId, slotId };
  createComponentPorts(s, eq, slotId, componentId);
  return warnings;
}
