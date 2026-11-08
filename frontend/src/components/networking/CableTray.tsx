/** Cable tray: spare cables by type. Drag one onto a port, or pick it up. */
import { Hand } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { getCableModel } from '@/data/cables/cableCatalog';
import { CABLE_MIME, freeCableOfModel, setDrag, useCableActions } from '@/hooks/useCableActions';
import { getSim, useSim } from '@/stores/simulationStore';

export function CableTray() {
  const cables = useSim((s) => s.cables);
  const { pickUp } = useCableActions();
  const stock = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of Object.values(cables)) if (!c.ends[0].portId && !c.ends[1].portId) m.set(c.modelId, (m.get(c.modelId) ?? 0) + 1);
    return [...m.entries()];
  }, [cables]);

  return (
    <Panel title="Cable tray" subtitle="Drag a cable onto a port; green = fits, red = refused" bodyClassName="p-1.5">
      {stock.length === 0 ? (
        <div className="p-2 text-[12px] text-subtle">Spares cage is empty.</div>
      ) : (
        <ul className="grid gap-0.5 sm:grid-cols-2" aria-label="Spare cables">
          {stock.map(([modelId, n]) => {
            const m = getCableModel(modelId);
            return (
              <li
                key={modelId}
                draggable
                onDragStart={(e) => {
                  const id = freeCableOfModel(getSim(), modelId);
                  if (!id) return e.preventDefault();
                  setDrag({ kind: 'cable', cableId: id });
                  e.dataTransfer.setData(CABLE_MIME, id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onDragEnd={() => setDrag(null)}
                className="flex cursor-grab items-center gap-2 rounded-[4px] px-2 py-1 text-[11.5px] hover:bg-surface-3 active:cursor-grabbing"
                data-cable-model={modelId}
              >
                <span className="h-1.5 w-5 shrink-0 rounded-full" style={{ background: m.color === '#111827' || m.color === '#1f2937' ? '#59636b' : m.color }} />
                <span className="min-w-0 flex-1 truncate" title={m.name}>
                  {m.shortName}
                </span>
                <span className="text-subtle tabular">×{n}</span>
                <Button size="icon" variant="ghost" className="size-5" aria-label={`Pick up ${m.shortName}`} title="Pick up" onClick={() => pickUp(modelId)}>
                  <Hand />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
