/**
 * Panel layout helpers: where each slot and port sits on a front/rear face.
 * Pure functions of catalog data and the current port list.
 */
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel, getSlotDef } from '@/data/hardware/equipmentCatalog';
import type { PanelSide, PortType } from '@/types/catalog';
import type { Equipment, Port, SimulationState } from '@/types/simulation';

export interface PortPlacement {
  port: Port;
  /** Left edge in percent of face width. */
  x: number;
  row: number;
  rows: number;
}

/** Physical receptacle size in px (w × h) for drawing. */
export const PORT_SIZE: Record<PortType, [number, number]> = {
  rj45: [8, 7],
  serial_rj45: [8, 7],
  sfp: [6, 5],
  sfp_plus: [6, 5],
  sfp28: [6, 5],
  qsfp28: [9, 6],
  qsfp112: [9, 6],
  qsfp_dd: [9, 7],
  osfp: [10, 7],
  usb_a: [7, 3],
  usb_c: [5, 3],
  hdmi: [8, 4],
  psu_c14: [9, 7],
  psu_c20: [10, 7],
  pdu_c13: [7, 6],
  pdu_c19: [8, 7],
  dc_in: [5, 5],
};

export function portPlacements(s: SimulationState, eq: Equipment, side: PanelSide): PortPlacement[] {
  const model = getEquipmentModel(eq.modelId);
  const out: PortPlacement[] = [];
  const byComponent = new Map<string, Port[]>();
  for (const pid of eq.portIds) {
    const p = s.ports[pid];
    if (!p || p.side !== side) continue;
    if (p.componentId) {
      const list = byComponent.get(p.componentId) ?? [];
      list.push(p);
      byComponent.set(p.componentId, list);
      continue;
    }
    const def = model.ports.find((d) => d.id === p.defId);
    const twoRows = model.ports.some((d) => (d.panelRow ?? 0) > 0);
    out.push({ port: p, x: def?.panelX ?? 50, row: def?.panelRow ?? 0, rows: twoRows ? 2 : 1 });
  }
  for (const [, ports] of byComponent) {
    const first = ports[0];
    const slot = first.slotId ? getSlotDef(eq.modelId, first.slotId) : undefined;
    const panel = slot?.panel ?? { x: 50, w: 10 };
    const isPsu = first.role === 'power_in';
    ports.forEach((p, i) => {
      const x = isPsu ? panel.x + panel.w * 0.62 : panel.x + ((i + 0.5) * panel.w) / ports.length - 2.5;
      out.push({ port: p, x, row: 0, rows: 1 });
    });
  }
  return out;
}

export interface SlotPlacement {
  slotId: string;
  label: string;
  category: string;
  x: number;
  w: number;
  componentId: string | null;
}

export function slotPlacements(eq: Equipment, side: PanelSide): SlotPlacement[] {
  const model = getEquipmentModel(eq.modelId);
  return model.slots
    .filter((sl) => sl.panel?.side === side)
    .map((sl) => ({ slotId: sl.id, label: sl.label, category: sl.category, x: sl.panel!.x, w: sl.panel!.w, componentId: eq.slots[sl.id] }));
}

export function componentShortName(modelId: string): string {
  return getComponentModel(modelId).name;
}
