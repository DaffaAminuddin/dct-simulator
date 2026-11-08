/**
 * Rack workbench: elevation + crash cart + cable rendering + drag-and-drop.
 * Drops are validated by the engine (connector fit, length, U constraints).
 */
import { type DragEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { LaptopCart } from '@/components/laptop/LaptopCart';
import { getCableModel } from '@/data/cables/cableCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { endFor, getDrag, setDrag, useCableActions } from '@/hooks/useCableActions';
import { validateMount } from '@/simulation/hardware/Rack';
import { useAct } from '@/stores/hardwareStore';
import { getSim, useSim } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import type { Id, SimulationState } from '@/types/simulation';
import { RackElevation } from './RackElevation';

interface Props {
  rackId: Id;
  side: 'front' | 'rear';
  selectedEquipmentId: Id | null;
  selectedPortId: Id | null;
  devMode: boolean;
  selectedFreeU: number | null;
  onSelectEquipment: (id: Id) => void;
  onSelectPort: (portId: Id, equipmentId: Id) => void;
  onSelectFreeU: (u: number) => void;
}

interface CablePath {
  id: Id;
  d: string;
  color: string;
  selected: boolean;
  stub: boolean;
}

function visibleColor(hex: string): string {
  return hex === '#111827' || hex === '#1f2937' || hex === '#374151' ? '#7a858d' : hex;
}

function CableOverlay({ rootRef, s, side, selectedPortId, enabled }: { rootRef: RefObject<HTMLDivElement | null>; s: SimulationState; side: string; selectedPortId: Id | null; enabled: boolean }) {
  const [paths, setPaths] = useState<CablePath[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const cables = s.cables;
  const ports = s.ports;
  // Passive effect: runs after the parent's ref is attached (child layout effects run first).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) {
      setPaths([]);
      return;
    }
    const measure = () => {
      const rr = root.getBoundingClientRect();
      const pos = new Map<string, { x: number; y: number }>();
      root.querySelectorAll<HTMLElement>('[data-port]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0) return;
        pos.set(el.dataset.port as string, { x: r.left - rr.left + r.width / 2, y: r.top - rr.top + r.height / 2 });
      });
      const selectedCable = selectedPortId ? ports[selectedPortId]?.cableId : null;
      const out: CablePath[] = [];
      const seen = new Set<Id>();
      for (const [pid, a] of pos) {
        const port = ports[pid];
        if (!port?.cableId || seen.has(port.cableId)) continue;
        const cable = cables[port.cableId];
        if (!cable) continue;
        seen.add(cable.id);
        const otherId = cable.ends.find((e) => e.portId && e.portId !== pid)?.portId;
        const b = otherId ? pos.get(otherId) : undefined;
        const color = visibleColor(getCableModel(cable.modelId).color);
        if (b) {
          const bulge = Math.max(18, Math.min(60, Math.abs(a.y - b.y) * 0.15)) * (a.x + b.x > rr.width ? 1 : -1);
          out.push({ id: cable.id, d: `M ${a.x} ${a.y} C ${a.x + bulge} ${a.y}, ${b.x + bulge} ${b.y}, ${b.x} ${b.y}`, color, selected: cable.id === selectedCable, stub: false });
        } else if (otherId) {
          // Leaves this view (other rack, other side, laptop elsewhere): draw a short riser.
          out.push({ id: cable.id, d: `M ${a.x} ${a.y} q 0 -9 6 -14`, color, selected: cable.id === selectedCable, stub: true });
        }
      }
      setSize({ w: rr.width, h: rr.height });
      setPaths(out);
    };
    const raf = requestAnimationFrame(measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    ro?.observe(root);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [rootRef, cables, ports, side, selectedPortId, enabled]);

  if (!enabled || paths.length === 0) return null;
  return (
    <svg className="pointer-events-none absolute top-0 left-0 z-30" width={size.w} height={size.h} aria-hidden data-testid="cable-overlay">
      {paths
        .filter((p) => !p.selected)
        .map((p) => (
          <path key={p.id} d={p.d} fill="none" stroke={p.color} strokeWidth={p.stub ? 1.2 : 1.4} strokeOpacity={0.5} strokeLinecap="round" />
        ))}
      {paths
        .filter((p) => p.selected)
        .map((p) => (
          <path key={p.id} d={p.d} fill="none" stroke="#93d65a" strokeWidth={2.6} strokeLinecap="round" />
        ))}
    </svg>
  );
}

function clearMarks(root: HTMLElement | null) {
  root?.querySelectorAll('[data-drop]').forEach((el) => el.removeAttribute('data-drop'));
}

export function RackWorkbench(props: Props) {
  const { rackId, side, selectedPortId } = props;
  const s = useSim((st) => st);
  const showCables = useUiStore((st) => st.showCables);
  const rootRef = useRef<HTMLDivElement>(null);
  const { plug } = useCableActions();
  const act = useAct();
  const select = useUiStore((st) => st.selectEquipment);

  const targetOf = (e: DragEvent) => (e.target as HTMLElement).closest<HTMLElement>('[data-port],[data-free-u]');

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    const drag = getDrag();
    const el = targetOf(e);
    clearMarks(rootRef.current);
    if (!drag || !el) return;
    e.preventDefault();
    const st = getSim();
    if (drag.kind === 'cable' && el.dataset.port) {
      const fit = endFor(st, drag.cableId, el.dataset.port);
      el.setAttribute('data-drop', fit.end === null ? 'bad' : 'ok');
      // Allow the drop even when it will not fit: the engine refuses it with an explanation.
      e.dataTransfer.dropEffect = 'copy';
    } else if (drag.kind === 'equipment' && el.dataset.freeU) {
      el.setAttribute('data-drop', mountStart(st, drag.equipmentId, rackId, Number(el.dataset.freeU)) === null ? 'bad' : 'ok');
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const drag = getDrag();
    const el = targetOf(e);
    clearMarks(rootRef.current);
    setDrag(null);
    if (!drag || !el) return;
    e.preventDefault();
    if (drag.kind === 'cable' && el.dataset.port) plug(drag.cableId, el.dataset.port);
    if (drag.kind === 'equipment' && el.dataset.freeU) {
      const u = Number(el.dataset.freeU);
      const start = mountStart(getSim(), drag.equipmentId, rackId, u) ?? u;
      const r = act({ type: 'equipment/mount', equipmentId: drag.equipmentId, rackId, uStart: start }, `Mounted at ${rackId} U${start}`);
      if (r.ok) select(drag.equipmentId, rackId);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block min-w-full space-y-3" onDragOver={onDragOver} onDragLeave={() => clearMarks(rootRef.current)} onDrop={onDrop}>
      <RackElevation {...props} />
      <LaptopCart rackId={rackId} side={side} selectedPortId={selectedPortId} onSelectPort={props.onSelectPort} />
      <CableOverlay rootRef={rootRef} s={s} side={side} selectedPortId={selectedPortId} enabled={showCables} />
    </div>
  );
}

/** First U start that lets the equipment cover the dropped U (null if none fits). */
function mountStart(s: SimulationState, equipmentId: Id, rackId: Id, u: number): number | null {
  const eq = s.equipment[equipmentId];
  if (!eq) return null;
  const h = getEquipmentModel(eq.modelId).heightU;
  for (let start = u; start >= Math.max(1, u - h + 1); start--) {
    try {
      validateMount(s, equipmentId, rackId, start);
      return start;
    } catch {
      // try the next position
    }
  }
  return null;
}
