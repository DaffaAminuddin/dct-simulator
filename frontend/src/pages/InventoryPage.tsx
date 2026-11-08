import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AccuracyBadge, Mono } from '@/components/ui/misc';
import { EmptyState, Panel } from '@/components/ui/panel';
import { Tabs } from '@/components/ui/tabs';
import { getCableModel } from '@/data/cables/cableCatalog';
import { getComponentModel } from '@/data/hardware/componentCatalog';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { useDevMode } from '@/stores/hardwareStore';
import { useSim } from '@/stores/simulationStore';

type TabId = 'components' | 'equipment' | 'cables';

export function InventoryPage() {
  const s = useSim((st) => st);
  const devMode = useDevMode();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('components');
  const comps = useMemo(() => Object.values(s.components).filter((c) => c.location.kind === 'inventory'), [s.components]);
  const eqs = useMemo(() => Object.values(s.equipment).filter((e) => e.location.kind === 'inventory'), [s.equipment]);
  const cables = useMemo(() => {
    const byModel = new Map<string, { free: number; used: number; partial: number }>();
    for (const c of Object.values(s.cables)) {
      const v = byModel.get(c.modelId) ?? { free: 0, used: 0, partial: 0 };
      const ends = c.ends.filter((e) => e.portId).length;
      if (ends === 0) v.free++;
      else if (ends === 2) v.used++;
      else v.partial++;
      byModel.set(c.modelId, v);
    }
    return [...byModel.entries()];
  }, [s.cables]);
  const faultyIds = new Set(Object.values(s.faults).map((f) => f.targetId));

  return (
    <Page className="space-y-3">
      <Tabs
        label="Inventory"
        items={[
          { id: 'components', label: `Spare parts (${comps.length})` },
          { id: 'equipment', label: `Equipment (${eqs.length})` },
          { id: 'cables', label: `Cables (${cables.reduce((n, [, v]) => n + v.free, 0)} free)` },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'components' && (
        <Panel title="Spares cage · components" subtitle="Parts removed from systems also land here" bodyClassName="p-0">
          {comps.length === 0 ? (
            <EmptyState title="No spare parts" />
          ) : (
            <table className="w-full text-[11.5px]">
              <thead className="text-left text-subtle">
                <tr className="border-b border-border">
                  <th className="px-3 py-1.5 font-medium">Part</th>
                  <th className="px-2 py-1.5 font-medium">Category</th>
                  <th className="px-2 py-1.5 font-medium">Form factor</th>
                  <th className="px-2 py-1.5 font-medium">Serial</th>
                  <th className="px-2 py-1.5 font-medium">Origin</th>
                  <th className="px-2 py-1.5 font-medium">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {comps
                  .sort((a, b) => a.category.localeCompare(b.category))
                  .map((c) => {
                    const m = getComponentModel(c.modelId);
                    return (
                      <tr key={c.id} className="border-b border-border/60">
                        <td className="px-3 py-1">{m.name}</td>
                        <td className="px-2 py-1 text-muted">{m.category}</td>
                        <td className="px-2 py-1 text-muted">{m.formFactor}</td>
                        <td className="px-2 py-1">
                          <Mono>{c.serial}</Mono>
                        </td>
                        <td className="px-2 py-1">
                          {c.id.startsWith('spare-') ? <Badge>new spare</Badge> : <Badge tone="info">removed from {c.id.split('/')[0]}</Badge>}
                          {devMode && faultyIds.has(c.id) && (
                            <Badge tone="crit" className="ml-1">
                              faulty (truth)
                            </Badge>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <AccuracyBadge accuracy={m.accuracy} note={m.note} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </Panel>
      )}
      {tab === 'equipment' && (
        <Panel title="Staged equipment" bodyClassName="p-0">
          {eqs.length === 0 ? (
            <EmptyState title="No equipment in inventory" />
          ) : (
            <ul className="divide-y divide-border">
              {eqs.map((e) => {
                const m = getEquipmentModel(e.modelId);
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12px]">
                    <Mono className="text-fg">{e.hostname}</Mono>
                    <span className="text-muted">{m.name}</span>
                    <Badge>{m.heightU}U</Badge>
                    <Badge>{m.rackTypes.join(' / ') || 'floor'}</Badge>
                    <span className="ml-auto flex gap-2">
                      {m.slots.length > 0 && (
                        <Button size="xs" variant="outline" onClick={() => navigate(`/hardware/${e.id}`)}>
                          Inspect on bench
                        </Button>
                      )}
                      <Button size="xs" variant="primary" onClick={() => navigate(`/racks/${m.rackTypes.includes('mgx') && !m.rackTypes.includes('standard') ? 'R05' : 'R07'}`)}>
                        Mount…
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
      {tab === 'cables' && (
        <Panel title="Cable stock" subtitle="Connect cables from the Rack Explorer port inspector" bodyClassName="p-0">
          <table className="w-full text-[11.5px]">
            <thead className="text-left text-subtle">
              <tr className="border-b border-border">
                <th className="px-3 py-1.5 font-medium">Cable</th>
                <th className="px-2 py-1.5 font-medium">Ends</th>
                <th className="px-2 py-1.5 font-medium">Length</th>
                <th className="px-2 py-1.5 text-right font-medium">In stock</th>
                <th className="px-2 py-1.5 text-right font-medium">Installed</th>
                <th className="px-2 py-1.5 text-right font-medium">One end loose</th>
              </tr>
            </thead>
            <tbody>
              {cables.map(([modelId, v]) => {
                const m = getCableModel(modelId);
                return (
                  <tr key={modelId} className="border-b border-border/60">
                    <td className="px-3 py-1">
                      <span className="mr-2 inline-block size-2.5 rounded-sm align-middle" style={{ background: m.color }} />
                      {m.name}
                    </td>
                    <td className="px-2 py-1 font-mono text-muted">{m.ends.join(' ↔ ')}</td>
                    <td className="px-2 py-1 text-muted">{m.lengthM} m</td>
                    <td className="px-2 py-1 text-right font-mono tabular">{v.free}</td>
                    <td className="px-2 py-1 text-right font-mono tabular text-muted">{v.used}</td>
                    <td className={`px-2 py-1 text-right font-mono tabular ${v.partial ? 'text-warn' : 'text-subtle'}`}>{v.partial}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </Page>
  );
}
