/**
 * Rack elevation: front or rear view of one rack with U numbering, mounted
 * equipment, free positions and (rear view) 0U PDUs and the busbar.
 */
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { freeUnits } from '@/simulation/hardware/Rack';
import { useSim } from '@/stores/simulationStore';
import type { Equipment, Id, Port, SimulationState } from '@/types/simulation';
import { cn } from '@/utils/cn';
import { formatW } from '@/utils/format';
import { EquipmentFace } from './EquipmentFace';
import { Led } from './Led';

export const U_PX = 18;

interface Props {
  rackId: Id;
  side: 'front' | 'rear';
  selectedEquipmentId: Id | null;
  selectedPortId: Id | null;
  devMode: boolean;
  selectedFreeU?: number | null;
  onSelectEquipment: (id: Id) => void;
  onSelectPort: (portId: Id, equipmentId: Id) => void;
  onSelectFreeU?: (u: number) => void;
}

function PduStrip({ s, pdu, selectedPortId, onSelectPort, onSelect, selected }: { s: SimulationState; pdu: Equipment; selectedPortId: Id | null; onSelectPort: (p: Id, e: Id) => void; onSelect: (id: Id) => void; selected: boolean }) {
  const ports = pdu.portIds.map((id) => s.ports[id]);
  const powered = pdu.powerStatus === 'available';
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${pdu.hostname}, 0U PDU feed ${pdu.feed}`}
      onClick={() => onSelect(pdu.id)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(pdu.id)}
      data-equipment={pdu.id}
      className={cn('relative flex w-[30px] shrink-0 flex-col items-center rounded-[3px] border bg-[#141719] py-1', selected ? 'border-accent' : 'border-[#2c3337] hover:border-[#4a535a]')}
    >
      <div className="mb-1 flex flex-col items-center gap-0.5">
        <span className="text-[8px] font-semibold text-muted">{pdu.feed}</span>
        <Led color={powered ? 'green' : 'off'} title={powered ? 'PDU energised' : 'PDU dead'} />
      </div>
      <div className="flex flex-1 flex-col-reverse justify-evenly gap-[3px]">
        {ports.map((p: Port) => (
          <button
            key={p.id}
            type="button"
            data-port={p.id}
            aria-label={`Port ${p.label}`}
            title={`${p.label}${p.cableId ? ' · in use' : ' · free'}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectPort(p.id, pdu.id);
            }}
            className={cn(
              'relative rounded-[2px] border',
              p.type === 'pdu_c19' ? 'h-[8px] w-[14px]' : 'h-[7px] w-[11px]',
              p.cableId ? 'border-[#5d676e] bg-[#2b3137]' : 'border-[#3a4248] bg-[#07090a]',
              selectedPortId === p.id && 'outline outline-2 outline-accent',
            )}
          >
            {p.cableId && p.live && <span className="absolute -top-[2px] -right-[2px] size-[3px] rounded-full bg-ok" />}
          </button>
        ))}
      </div>
      <span className="mt-1 text-[7.5px] text-subtle tabular">{formatW(pdu.powerDemandW).replace(' ', '')}</span>
    </div>
  );
}

export function RackElevation({ rackId, side, selectedEquipmentId, selectedPortId, devMode, selectedFreeU, onSelectEquipment, onSelectPort, onSelectFreeU }: Props) {
  const s = useSim((st) => st);
  const rack = s.racks[rackId];
  const inRack = Object.values(s.equipment).filter((e) => e.location.kind === 'rack' && e.location.rackId === rackId);
  const mounted = inRack.filter((e) => e.location.kind === 'rack' && e.location.uStart !== null);
  const pdus = inRack.filter((e) => e.kind === 'pdu');
  const free = new Set(freeUnits(s, rackId));
  const H = rack.heightU * U_PX;
  const uTop = (u: number, h: number) => (rack.heightU - (u + h - 1)) * U_PX;
  const rails = Array.from({ length: rack.heightU }, (_, i) => rack.heightU - i);

  return (
    <div className="flex items-stretch gap-1.5" data-testid={`rack-elevation-${rackId}`}>
      {side === 'rear' && pdus.filter((p) => p.location.kind === 'rack' && p.location.side === 'left').map((p) => <PduStrip key={p.id} s={s} pdu={p} selectedPortId={selectedPortId} onSelectPort={onSelectPort} onSelect={onSelectEquipment} selected={selectedEquipmentId === p.id} />)}
      <div className="flex rounded-[4px] border-2 border-[#2b3236] bg-[#08090a] p-1 shadow-[inset_0_0_12px_rgba(0,0,0,0.8)]">
        <RailNumbers rails={rails} />
        <div className="relative w-[min(440px,62vw)] border-x border-[#3a4248] bg-[#060707]" style={{ height: H }}>
          {rails.map((u) =>
            free.has(u) ? (
              <button
                key={`free-${u}`}
                type="button"
                aria-label={`Empty U${u}`}
                onClick={() => onSelectFreeU?.(u)}
                className={cn('absolute inset-x-0 border-b border-[#111416] text-left text-[8px] text-transparent hover:bg-accent/5 hover:text-subtle', selectedFreeU === u && 'bg-accent/10 text-accent shadow-[inset_0_0_0_1px_var(--color-accent-dim)]')}
                style={{ top: uTop(u, 1), height: U_PX }}
              >
                <span className="pl-1">free U{u}</span>
              </button>
            ) : null,
          )}
          {side === 'rear' && rack.type === 'mgx' && <div className="pointer-events-none absolute top-0 bottom-0 left-1/2 z-0 w-[6px] -translate-x-1/2 bg-copper/25" title="Rack busbar" />}
          {mounted.map((eq) => {
            const loc = eq.location;
            if (loc.kind !== 'rack' || loc.uStart === null) return null;
            const h = getEquipmentModel(eq.modelId).heightU;
            return (
              <div key={eq.id} className="absolute inset-x-0" style={{ top: uTop(loc.uStart, h), height: h * U_PX }}>
                <EquipmentFace
                  s={s}
                  eq={eq}
                  side={side}
                  heightPx={h * U_PX}
                  selected={selectedEquipmentId === eq.id}
                  selectedPortId={selectedPortId}
                  devMode={devMode}
                  ports={eq.portIds.map((id) => s.ports[id])}
                  comps={Object.values(eq.slots).map((id) => (id ? s.components[id] : undefined))}
                  onSelect={onSelectEquipment}
                  onSelectPort={onSelectPort}
                />
              </div>
            );
          })}
        </div>
        <RailNumbers rails={rails} />
      </div>
      {side === 'rear' && pdus.filter((p) => p.location.kind === 'rack' && p.location.side === 'right').map((p) => <PduStrip key={p.id} s={s} pdu={p} selectedPortId={selectedPortId} onSelectPort={onSelectPort} onSelect={onSelectEquipment} selected={selectedEquipmentId === p.id} />)}
      <div className="relative hidden w-[150px] shrink-0 sm:block" style={{ height: H + 12 }} aria-hidden>
        {mounted.map((eq) => {
          const loc = eq.location;
          if (loc.kind !== 'rack' || loc.uStart === null || eq.kind === 'blank') return null;
          const m = getEquipmentModel(eq.modelId);
          return (
            <button
              key={eq.id}
              type="button"
              tabIndex={-1}
              onClick={() => onSelectEquipment(eq.id)}
              className={cn('absolute left-0 flex w-full items-center gap-1 truncate text-left font-mono text-[10px] leading-none hover:text-fg', selectedEquipmentId === eq.id ? 'text-accent-strong' : 'text-muted')}
              style={{ top: uTop(loc.uStart, m.heightU) + 6 + (m.heightU * U_PX) / 2 - 5 }}
            >
              <span className="truncate">{eq.hostname.replace(/^dh1-/, '')}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RailNumbers({ rails }: { rails: number[] }) {
  return (
    <div className="flex w-[22px] flex-col bg-[#101315]">
      {rails.map((u) => (
        <div key={u} className={cn('flex items-center justify-center border-b border-[#191d20] font-mono text-[8.5px] tabular', u % 5 === 0 ? 'text-muted' : 'text-subtle/70')} style={{ height: U_PX }}>
          {u}
        </div>
      ))}
    </div>
  );
}
