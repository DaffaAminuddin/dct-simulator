/**
 * The crash cart as shown beside a rack: the laptop's physical ports (cable
 * drop targets) and controls to move the cart or open the laptop.
 */
import { Laptop, Move } from 'lucide-react';
import { PortGlyph } from '@/components/rack/EquipmentFace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Mono } from '@/components/ui/misc';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { useAct, useDevMode } from '@/stores/hardwareStore';
import { useSim } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import type { Id } from '@/types/simulation';

export function LaptopCart({ rackId, side, selectedPortId, onSelectPort }: { rackId: Id; side: 'front' | 'rear'; selectedPortId: Id | null; onSelectPort: (portId: Id, equipmentId: Id) => void }) {
  const s = useSim((st) => st);
  const act = useAct();
  const devMode = useDevMode();
  const openApp = useUiStore((st) => st.openLaptopApp);
  const ws = s.workstation;
  const eq = s.equipment[ws.equipmentId];
  if (!eq) return null;
  const loc = eq.location;
  const here = loc.kind === 'cart' && loc.rackId === rackId;

  if (!here) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-box border border-dashed border-border-strong px-3 py-2 text-[12px] text-muted">
        <Laptop className="size-4" />
        Crash cart is at {loc.kind === 'cart' ? `${loc.rackId} (${loc.side === 'front' ? 'cold aisle' : 'hot aisle'})` : 'an unknown location'}.
        <Button size="xs" variant="outline" className="ml-auto" onClick={() => act({ type: 'workstation/move', rackId, side }, `Cart moved to ${rackId}`)}>
          <Move /> Move cart here ({side === 'front' ? 'cold aisle' : 'hot aisle'})
        </Button>
      </div>
    );
  }

  const model = getEquipmentModel(eq.modelId);
  const ports = eq.portIds.map((id) => s.ports[id]);
  const H = 22;
  return (
    <div className="space-y-1.5 rounded-box border border-border bg-surface-2 p-2" data-testid="laptop-cart">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Laptop className="size-4 text-accent" />
        <span className="font-medium">Crash cart · {eq.hostname}</span>
        <Badge tone={ws.onAc ? 'ok' : ws.batteryPct < 20 ? 'warn' : 'muted'}>{ws.onAc ? 'AC' : 'battery'} {Math.round(ws.batteryPct)}%</Badge>
        <Mono className="text-muted">{ws.effective.address || 'no IP'}</Mono>
        <div className="ml-auto flex gap-1.5">
          {loc.kind === 'cart' && loc.side !== side && (
            <Button size="xs" variant="ghost" onClick={() => act({ type: 'workstation/move', rackId, side })}>
              <Move /> To {side === 'front' ? 'cold' : 'hot'} aisle
            </Button>
          )}
          <Button size="xs" variant="primary" onClick={() => openApp('home')}>
            <Laptop /> Open laptop
          </Button>
        </div>
      </div>
      <div className="relative h-[22px] w-full max-w-[420px] rounded-[3px] border border-[#3a4248] bg-[#1b1f22]" aria-label="Laptop side ports">
        {ports.map((p) => {
          const def = model.ports.find((d) => d.id === p.defId);
          return (
            <PortGlyph key={p.id} s={s} port={p} x={def?.panelX ?? 10} row={0} rows={1} heightPx={H} selected={selectedPortId === p.id} devMode={devMode} onClick={() => onSelectPort(p.id, eq.id)} />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 text-[10.5px] text-subtle">
        {ports.map((p) => (
          <span key={p.id}>
            {p.label}
            {p.cableId ? ' ●' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
