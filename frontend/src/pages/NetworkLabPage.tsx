import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { Badge } from '@/components/ui/badge';
import { Mono, PhaseNotice } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Input, Select } from '@/components/ui/select';
import { switchPortSummary } from '@/simulation/networking/Switch';
import { patchSchedule } from '@/simulation/networking/NetworkTopology';
import { useSim, getSim } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import type { CableState } from '@/types/simulation';
import { PORT_STATE_TEXT, portTone } from '@/utils/format';

const CABLE_TONE: Record<CableState, 'ok' | 'warn' | 'crit' | 'muted'> = { connected: 'ok', available: 'muted', damaged: 'crit', incompatible: 'warn' };

export function NetworkLabPage() {
  const s = useSim((st) => st);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [media, setMedia] = useState('all');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const rows = useMemo(() => patchSchedule(s), [s]);
  const switches = Object.values(s.equipment).filter((e) => e.kind === 'switch' && e.location.kind === 'rack');

  const filtered = rows.filter((r) => {
    if (media !== 'all' && (media === 'power' ? r.media !== 'power' : r.media === 'power')) return false;
    const problem = r.state !== 'connected' || !r.aEquipment || !r.bEquipment || (r.media !== 'power' && r.aState !== 'link_up');
    if (problemsOnly && !problem) return false;
    if (!q) return true;
    const hay = `${r.label} ${r.model} ${r.aEquipment} ${r.aPort} ${r.bEquipment} ${r.bPort}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const openPort = (equipmentHostname?: string, portLabel?: string) => {
    const st = getSim();
    const eq = Object.values(st.equipment).find((e) => e.hostname === equipmentHostname);
    if (!eq || eq.location.kind !== 'rack') return;
    const port = eq.portIds.map((id) => st.ports[id]).find((p) => p.label === portLabel);
    const ui = useUiStore.getState();
    ui.selectEquipment(eq.id, eq.location.rackId);
    if (port) {
      ui.selectPort(port.id);
      ui.setRackSide(port.side);
    }
    navigate(`/racks/${eq.location.rackId}`);
  };

  return (
    <Page className="space-y-3">
      <Panel title="Switches" subtitle="Port summary from each switch's management plane">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
          {switches.map((sw) => {
            const sum = switchPortSummary(s, sw);
            return (
              <button key={sw.id} type="button" onClick={() => { useUiStore.getState().selectEquipment(sw.id, sw.location.kind === 'rack' ? sw.location.rackId : undefined); useUiStore.getState().setRackSide('rear'); navigate(`/racks/${sw.location.kind === 'rack' ? sw.location.rackId : ''}`); }} className="rounded-[5px] border border-border bg-surface-2 p-2 text-left hover:border-border-strong">
                <Mono className="text-fg">{sw.hostname.replace('dh1-', '')}</Mono>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone="ok">{sum.up} up</Badge>
                  {sum.down > 0 && <Badge tone="warn">{sum.down} down</Badge>}
                  {sum.disabled > 0 && <Badge>{sum.disabled} disabled</Badge>}
                  {sum.faulty > 0 && <Badge tone="crit">{sum.faulty} faulty</Badge>}
                  <Badge>{sum.empty} empty</Badge>
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Patch schedule"
        subtitle={`${filtered.length} of ${rows.length} cables`}
        actions={
          <>
            <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
              <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} className="accent-[#7cc33f]" /> Problems only
            </label>
            <Select aria-label="Media filter" value={media} onChange={(e) => setMedia(e.target.value)}>
              <option value="all">All media</option>
              <option value="data">Data / management</option>
              <option value="power">Power cords</option>
            </Select>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle" />
              <Input aria-label="Search cables" placeholder="host, port, cable…" value={q} onChange={(e) => setQ(e.target.value)} className="w-48 pl-7" />
            </div>
          </>
        }
        bodyClassName="p-0"
      >
        <div className="max-h-[calc(100vh-330px)] min-h-[240px] overflow-auto">
          <table className="w-full min-w-[860px] text-[11.5px]">
            <thead className="sticky top-0 z-10 bg-surface text-left text-subtle">
              <tr className="border-b border-border">
                <th className="px-3 py-1.5 font-medium">Cable</th>
                <th className="px-2 py-1.5 font-medium">Type</th>
                <th className="px-2 py-1.5 font-medium">A end</th>
                <th className="px-2 py-1.5 font-medium">B end</th>
                <th className="px-2 py-1.5 font-medium">Link</th>
                <th className="px-2 py-1.5 font-medium">Cable state</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.cableId} className="border-b border-border/60 hover:bg-surface-2">
                  <td className="px-3 py-1">
                    <Mono>{r.label}</Mono>
                  </td>
                  <td className="px-2 py-1 text-muted">{r.model}</td>
                  <td className="px-2 py-1">
                    {r.aEquipment ? (
                      <button type="button" className="text-left hover:text-accent-strong" onClick={() => openPort(r.aEquipment, r.aPort)}>
                        <Mono className="text-muted">{r.aEquipment}</Mono> {r.aPort}
                      </button>
                    ) : (
                      <span className="text-warn">unplugged</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {r.bEquipment ? (
                      <button type="button" className="text-left hover:text-accent-strong" onClick={() => openPort(r.bEquipment, r.bPort)}>
                        <Mono className="text-muted">{r.bEquipment}</Mono> {r.bPort}
                      </button>
                    ) : (
                      <span className="text-warn">unplugged</span>
                    )}
                  </td>
                  <td className="px-2 py-1">{r.media === 'power' ? <span className="text-subtle">power</span> : r.aState ? <Badge tone={portTone(r.aState)}>{PORT_STATE_TEXT[r.aState]}</Badge> : null}</td>
                  <td className="px-2 py-1">
                    <Badge tone={CABLE_TONE[r.state]} title={r.reason}>
                      {r.state}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <PhaseNotice phase={5} title="IP, VLAN, routing and fabric diagnostics">
        Layer 1 (cabling, optics, speed negotiation, admin state) is live now. You can unplug and re-plug cables from the Rack Explorer port inspector. The technician laptop (Phase 2), VLAN/IP/MTU/routing, packet loss and InfiniBand tools (Phase 5) build on this link model.
      </PhaseNotice>
    </Page>
  );
}
