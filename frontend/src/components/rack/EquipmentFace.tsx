/**
 * Front/rear faceplate of one piece of rack equipment, drawn from catalog
 * layout data and coloured strictly from the engine's physical (LED) channel.
 * Developer mode colours ports by their exact derived state.
 */
import { memo } from 'react';
import { getCableModel } from '@/data/cables/cableCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { componentLed, frontLeds } from '@/simulation/diagnostics/DiagnosticEngine';
import type { PanelSide } from '@/types/catalog';
import type { Component, Equipment, Port, SimulationState } from '@/types/simulation';
import { cn } from '@/utils/cn';
import { Led } from './Led';
import { PORT_SIZE, portPlacements, slotPlacements } from './layout';

export interface FaceProps {
  s: SimulationState;
  eq: Equipment;
  side: PanelSide;
  heightPx: number;
  selected: boolean;
  selectedPortId: string | null;
  devMode: boolean;
  /** Memo keys: entity refs this face depends on. */
  ports: Port[];
  comps: (Component | undefined)[];
  onSelect: (id: string) => void;
  onSelectPort: (portId: string, equipmentId: string) => void;
}

const DEV_PORT: Record<Port['state'], string> = {
  link_up: 'bg-ok',
  link_down: 'bg-warn',
  connected: 'bg-info',
  disconnected: 'bg-transparent',
  disabled: 'bg-[#6b7480]',
  faulty: 'bg-crit',
};

export function PortGlyph({ s, port, x, row, rows, heightPx, selected, devMode, onClick }: { s: SimulationState; port: Port; x: number; row: number; rows: number; heightPx: number; selected: boolean; devMode: boolean; onClick: () => void }) {
  const [w, h] = PORT_SIZE[port.type];
  const cable = port.cableId ? s.cables[port.cableId] : undefined;
  const color = cable ? getCableModel(cable.modelId).color : undefined;
  const top = rows === 2 ? (row === 0 ? Math.max(1, heightPx / 2 - h - 1) : heightPx / 2 + 1) : heightPx > 24 ? heightPx - h - 4 : (heightPx - h) / 2;
  const linkLed = port.role !== 'power_in' && port.role !== 'power_out' && port.state === 'link_up';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`${port.label}${port.osName ? ` (${port.osName})` : ''}${cable ? ` · ${getCableModel(cable.modelId).shortName}` : ' · empty'}`}
      aria-label={`Port ${port.label}`}
      data-port={port.id}
      className={cn('absolute rounded-[1px] border border-[#4a535a] bg-[#07090a]', selected && 'z-10 outline outline-2 outline-accent')}
      style={{ left: `${x}%`, top, width: w, height: h }}
    >
      {cable && <span className="absolute inset-[1px] rounded-[1px]" style={{ background: color === '#111827' || color === '#1f2937' ? '#2b3137' : color, opacity: 0.85 }} />}
      {devMode && port.role !== 'power_in' && port.role !== 'power_out' && port.state !== 'disconnected' && (
        <span className={cn('absolute -top-[2px] -right-[2px] size-[4px] rounded-full', DEV_PORT[port.state])} />
      )}
      {!devMode && linkLed && <span className="absolute -top-[2px] -right-[2px] size-[3px] rounded-full bg-ok shadow-[0_0_3px_var(--color-ok)]" />}
      {port.role === 'power_out' && port.live && cable && <span className="absolute -top-[2px] -right-[2px] size-[3px] rounded-full bg-ok" />}
    </button>
  );
}

function SlotGlyph({ s, category, componentId, x, w, heightPx, side }: { s: SimulationState; category: string; componentId: string | null; x: number; w: number; heightPx: number; side: PanelSide }) {
  const comp = componentId ? s.components[componentId] : undefined;
  const led = comp ? componentLed(s, comp) : 'off';
  const base = 'absolute top-[2px] bottom-[2px] rounded-[1px] border';
  if (!comp) return <div className={cn(base, 'hatch border-dashed border-[#30373c] bg-[#0a0c0d]')} style={{ left: `${x}%`, width: `${w}%` }} />;
  switch (category) {
    case 'nvme':
    case 'ssd':
      return (
        <div className={cn(base, 'border-[#3a4248] bg-[#1b2024]')} style={{ left: `${x}%`, width: `${w}%` }}>
          <Led color={led} className="absolute bottom-[2px] left-[2px] size-[3px]" />
        </div>
      );
    case 'fan':
      return (
        <div className={cn(base, 'grille border-[#2c3338] bg-[#121518]')} style={{ left: `${x}%`, width: `${w}%` }}>
          {heightPx > 20 && <Led color={led} className="absolute top-[2px] right-[2px] size-[3px]" />}
        </div>
      );
    case 'psu':
      return (
        <div className={cn(base, 'border-[#3a4248] bg-[#191d20]')} style={{ left: `${x}%`, width: `${w}%` }}>
          <span className="grille absolute inset-y-[2px] left-[2px] w-[40%]" />
          <Led color={led} className={cn('absolute left-[46%] size-[4px]', heightPx > 24 ? 'top-[3px]' : 'top-1/2 -translate-y-1/2')} />
        </div>
      );
    case 'nic':
    case 'dpu':
      return <div className={cn(base, 'border-[#2f363b] bg-[#0f1214]')} style={{ left: `${x}%`, width: `${w}%` }} />;
    default:
      return <div className={cn(base, 'border-[#2f363b] bg-[#15191c]')} style={{ left: `${x}%`, width: `${w}%` }} title={side} />;
  }
}

function RearFeatures({ eq, heightPx }: { eq: Equipment; heightPx: number }) {
  if (eq.kind === 'compute_tray' || eq.kind === 'nvlink_switch_tray') {
    return (
      <>
        <span className="absolute top-[3px] bottom-[3px] left-[8%] w-[30%] rounded-[1px] border border-[#3b3226] bg-[#1d1813]" title="NVLink spine connectors" />
        <span className="absolute top-1/2 left-[44%] size-[6px] -translate-y-1/2 rounded-full bg-coolant-cold/80" title="Coolant supply quick-disconnect" />
        <span className="absolute top-1/2 left-[49%] size-[6px] -translate-y-1/2 rounded-full bg-coolant-hot/80" title="Coolant return quick-disconnect" />
        <span className="absolute top-[2px] right-[46%] bottom-[2px] w-[5px] bg-copper/70" title="Busbar clip" />
      </>
    );
  }
  if (eq.kind === 'power_shelf') {
    return (
      <>
        <span className="absolute top-1/2 left-[6%] -translate-y-1/2 text-[8px] text-subtle" style={{ display: heightPx >= 16 ? 'block' : 'none' }}>
          AC IN (hard-wired) · feed {eq.feed}
        </span>
        <span className="absolute top-[2px] right-[46%] bottom-[2px] w-[5px] bg-copper/80" title="DC busbar output" />
      </>
    );
  }
  return null;
}

function FaceInner({ s, eq, side, heightPx, selected, selectedPortId, devMode, onSelect, onSelectPort }: FaceProps) {
  const model = getEquipmentModel(eq.modelId);
  const leds = frontLeds(s, eq);
  const isBlank = eq.kind === 'blank';
  const bg =
    eq.kind === 'switch'
      ? 'bg-[#16191b]'
      : eq.kind === 'power_shelf'
        ? 'bg-[#1d2124]'
        : eq.kind === 'compute_tray'
          ? 'bg-[#1a1e1a]'
          : eq.kind === 'nvlink_switch_tray'
            ? 'bg-[#1b1a20]'
            : 'bg-[#1a1d20]';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${eq.hostname}${isBlank ? '' : `, ${model.shortName}`}`}
      aria-pressed={selected}
      data-equipment={eq.id}
      onClick={() => onSelect(eq.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(eq.id);
        }
      }}
      className={cn(
        'absolute inset-x-0 overflow-hidden border-y border-black/70 outline-none',
        isBlank ? 'hatch bg-[#0d0f10]' : bg,
        selected ? 'z-20 shadow-[inset_0_0_0_2px_var(--color-accent)]' : 'hover:shadow-[inset_0_0_0_1px_#56606a] focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent)]',
      )}
      style={{ height: heightPx }}
    >
      {isBlank ? null : (
        <>
          {slotPlacements(eq, side).map((sp) => (
            <SlotGlyph key={sp.slotId} s={s} category={sp.category} componentId={sp.componentId} x={sp.x} w={sp.w} heightPx={heightPx} side={side} />
          ))}
          {side === 'rear' && <RearFeatures eq={eq} heightPx={heightPx} />}
          {portPlacements(s, eq, side).map((pp) => (
            <PortGlyph
              key={pp.port.id}
              s={s}
              port={pp.port}
              x={pp.x}
              row={pp.row}
              rows={pp.rows}
              heightPx={heightPx}
              selected={selectedPortId === pp.port.id}
              devMode={devMode}
              onClick={() => onSelectPort(pp.port.id, eq.id)}
            />
          ))}
          {(side === 'front' || eq.kind === 'server') && eq.kind !== 'pdu' && (
            <div className="pointer-events-none absolute top-1/2 right-[3px] flex -translate-y-1/2 items-center gap-[3px]">
              {side === 'front' && <Led color={leds.power} title="Power" />}
              {side === 'front' && <Led color={leds.health} title="Health" />}
              <Led color={leds.uid} title="UID locator" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function sameRefs<T>(a: T[], b: T[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const EquipmentFace = memo(FaceInner, (a, b) =>
  a.eq === b.eq &&
  a.side === b.side &&
  a.heightPx === b.heightPx &&
  a.selected === b.selected &&
  a.selectedPortId === b.selectedPortId &&
  a.devMode === b.devMode &&
  sameRefs(a.ports, b.ports) &&
  sameRefs(a.comps, b.comps) &&
  // Cable colours and peer links can change without the port object changing.
  a.ports.every((p) => !p.cableId || a.s.cables[p.cableId] === b.s.cables[p.cableId]),
);
