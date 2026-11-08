import { Droplets, Thermometer, Zap } from 'lucide-react';
import { Page } from '@/components/layout/AppShell';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout, Mono } from '@/components/ui/misc';
import { KV, Meter, Panel } from '@/components/ui/panel';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { installedComponents } from '@/simulation/core/SimulationState';
import { useAct } from '@/stores/hardwareStore';
import { useSim } from '@/stores/simulationStore';
import { formatTemp, formatW, POWER_TEXT, powerTone } from '@/utils/format';

export function FacilityPage() {
  const s = useSim((st) => st);
  const act = useAct();
  const feeds = Object.values(s.facility.feeds);
  const pdus = Object.values(s.equipment).filter((e) => e.kind === 'pdu' && e.location.kind === 'rack');
  const cdu = s.equipment['cdu-01'];
  const pumps = cdu ? installedComponents(s, cdu) : [];
  const mgx = Object.values(s.racks).filter((r) => r.busbar);

  return (
    <Page className="space-y-3">
      <Callout tone="warn" title="Simplified engineering models">
        Power and thermal figures come from documented teaching models (SIMULATION_SPEC §3–4). They are not suitable for facility design or safety certification.
      </Callout>
      <div className="grid gap-3 lg:grid-cols-3">
        {feeds.map((f) => (
          <Panel key={f.id} title={<span className="flex items-center gap-1.5"><Zap className="size-3.5" /> {f.name}</span>}>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <StatusDot tone={f.up ? 'ok' : 'crit'} />
                <span className="text-[13px]">{f.up ? 'Energised' : 'DOWN'}</span>
                <span className="ml-auto font-mono text-[12px] tabular">
                  {formatW(f.loadW)} / {formatW(f.capacityW)}
                </span>
              </div>
              <Meter value={f.loadW} max={f.capacityW} tone={f.loadW > f.capacityW * 0.8 ? 'warn' : 'ok'} label={`${f.name} load`} />
              <div className="text-[11.5px] text-muted">Feeds every {f.id}-side PDU and power shelf. With A+B redundancy, either feed must be able to carry the whole hall.</div>
            </div>
          </Panel>
        ))}
        <Panel title={<span className="flex items-center gap-1.5"><Thermometer className="size-3.5" /> CRAH supply air</span>}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[20px] tabular">{s.facility.crahSupplyC} °C</span>
              <Badge tone={s.facility.crahSupplyC > 27 || s.facility.crahSupplyC < 18 ? 'warn' : 'ok'}>{s.facility.crahSupplyC > 27 || s.facility.crahSupplyC < 18 ? 'Outside 18–27 °C' : 'Within ASHRAE recommended'}</Badge>
            </div>
            <input
              type="range"
              min={15}
              max={35}
              step={1}
              value={s.facility.crahSupplyC}
              onChange={(e) => act({ type: 'facility/setCrahSupply', tempC: Number(e.target.value) })}
              aria-label="CRAH supply setpoint"
              className="w-full accent-[#7cc33f]"
            />
            <div className="text-[11.5px] text-muted">Raising the setpoint raises every air-cooled inlet temperature. Watch GPU temperatures in R03.</div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Rack PDUs" bodyClassName="p-0">
          <table className="w-full text-[11.5px]">
            <thead className="text-left text-subtle">
              <tr className="border-b border-border">
                <th className="px-3 py-1.5 font-medium">PDU</th>
                <th className="px-2 py-1.5 font-medium">Feed</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="w-[40%] px-3 py-1.5 font-medium">Load</th>
              </tr>
            </thead>
            <tbody>
              {pdus.map((p) => {
                const rating = getEquipmentModel(p.modelId).pdu?.ratingW ?? 1;
                return (
                  <tr key={p.id} className="border-b border-border/60">
                    <td className="px-3 py-1">
                      <Mono>{p.hostname.replace('dh1-', '')}</Mono>
                    </td>
                    <td className="px-2 py-1">{p.feed}</td>
                    <td className="px-2 py-1">
                      <Badge tone={powerTone(p.powerStatus)}>{POWER_TEXT[p.powerStatus]}</Badge>
                    </td>
                    <td className="px-3 py-1">
                      <div className="flex items-center gap-2">
                        <Meter value={p.powerDemandW} max={rating} tone={p.powerDemandW > rating * 0.8 ? 'warn' : 'ok'} label={`${p.hostname} load`} />
                        <span className="w-16 shrink-0 text-right font-mono tabular">{formatW(p.powerDemandW)}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <div className="space-y-3">
          <Panel title="Rack busbars (MGX racks)">
            <div className="space-y-3">
              {mgx.map((r) => (
                <div key={r.id} className="space-y-1">
                  <div className="flex items-center gap-2 text-[12px]">
                    <Mono>{r.id}</Mono>
                    <Badge tone={powerTone(r.busbar!.status)}>{POWER_TEXT[r.busbar!.status]}</Badge>
                    <span className="ml-auto font-mono tabular text-muted">
                      {formatW(r.busbar!.demandW)} / {formatW(r.busbar!.capacityW)}
                    </span>
                  </div>
                  <Meter value={r.busbar!.demandW} max={Math.max(1, r.busbar!.capacityW)} tone={r.busbar!.status === 'degraded' ? 'warn' : 'ok'} label={`${r.id} busbar`} />
                </div>
              ))}
            </div>
          </Panel>
          {cdu && (
            <Panel title={<span className="flex items-center gap-1.5"><Droplets className="size-3.5" /> {cdu.hostname} · coolant distribution</span>}>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {pumps.map((p) => (
                    <Badge key={p.id} tone={p.status === 'ok' ? 'ok' : 'crit'}>
                      {p.id.split('/')[1] === 'pump0' ? 'Pump A' : 'Pump B'}: {p.status}
                    </Badge>
                  ))}
                  <Badge tone={cdu.powerStatus === 'available' ? 'ok' : 'crit'}>Power {cdu.powerStatus === 'available' ? 'OK (dual-fed via ATS)' : 'lost'}</Badge>
                </div>
                {(cdu.servesRackIds ?? []).map((rid) => {
                  const c = s.racks[rid].coolant;
                  if (!c) return null;
                  return (
                    <div key={rid} className="rounded-[5px] border border-border bg-surface-2 p-2">
                      <div className="mb-1 flex items-center gap-2 text-[12px]">
                        <Mono>{rid}</Mono>
                        <Badge tone={c.status === 'normal' ? 'ok' : c.status === 'warning' ? 'warn' : 'crit'}>{c.status}</Badge>
                        {c.leak && <Badge tone="crit">LEAK</Badge>}
                      </div>
                      <KV
                        rows={[
                          ['Flow', `${c.flowLpm} L/min (${c.flowPct} %)`],
                          ['Supply → return', `${formatTemp(c.supplyC)} → ${formatTemp(c.returnC)}`],
                          ['Heat load', formatW(s.racks[rid].powerW)],
                        ]}
                      />
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}
        </div>
      </div>

      <Panel title="Air-cooled rack inlets">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {Object.values(s.racks).map((r) => (
            <div key={r.id} className="rounded-[5px] border border-border bg-surface-2 p-2">
              <Mono className="text-muted">{r.id}</Mono>
              <div className={`font-mono text-[16px] tabular ${r.inletC > 27 ? 'text-warn' : ''}`}>{formatTemp(r.inletC)}</div>
              <div className="text-[11px] text-subtle">{r.openU} open U</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Button size="xs" variant="ghost" onClick={() => act({ type: 'facility/setCrahSupply', tempC: 22 })}>
            Reset setpoint to 22 °C
          </Button>
        </div>
      </Panel>
    </Page>
  );
}
