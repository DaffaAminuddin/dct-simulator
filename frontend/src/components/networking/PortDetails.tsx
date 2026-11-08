/**
 * Port inspector with the physical cable workflow:
 * unplug → cable in hand → plug into another port (validated by the engine).
 */
import { Cable, Plug, PlugZap, Power, Unplug, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout, Mono } from '@/components/ui/misc';
import { KV, Panel } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { getCableModel, getTransceiverModel } from '@/data/cables/cableCatalog';
import { checkFit, PORT_TYPE_LABEL } from '@/simulation/networking/Cable';
import { useAct, useDevMode, usePort } from '@/stores/hardwareStore';
import { useSim, useSimulationStore } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import type { Id } from '@/types/simulation';
import { formatSpeed, PORT_STATE_TEXT, portTone } from '@/utils/format';

export function PortDetails({ portId, onClose, onJump }: { portId: Id; onClose: () => void; onJump: (portId: Id) => void }) {
  const port = usePort(portId);
  const eq = useSim((s) => (port ? s.equipment[port.equipmentId] : undefined));
  const cable = useSim((s) => (port?.cableId ? s.cables[port.cableId] : undefined));
  const peer = useSim((s) => (port?.peerPortId ? s.ports[port.peerPortId] : undefined));
  const peerEq = useSim((s) => (peer ? s.equipment[peer.equipmentId] : undefined));
  const cables = useSim((s) => s.cables);
  const inHand = useUiStore((s) => s.cableInHand);
  const setInHand = useUiStore((s) => s.setCableInHand);
  const devMode = useDevMode();
  const act = useAct();
  const [pick, setPick] = useState('');

  const inHandCable = inHand ? cables[inHand.cableId] : undefined;

  /** Inventory cables (both ends free) that fit this port at either end, one entry per model. */
  const candidates = useMemo(() => {
    if (!port || port.cableId) return [];
    const byModel = new Map<string, { cableId: Id; end: 0 | 1; count: number }>();
    for (const c of Object.values(cables)) {
      if (c.ends[0].portId || c.ends[1].portId) continue;
      const m = getCableModel(c.modelId);
      const end = checkFit(port, m.ends[0]).ok ? 0 : checkFit(port, m.ends[1]).ok ? 1 : -1;
      if (end < 0) continue;
      const cur = byModel.get(m.id);
      if (cur) cur.count++;
      else byModel.set(m.id, { cableId: c.id, end: end as 0 | 1, count: 1 });
    }
    return [...byModel.entries()].map(([modelId, v]) => ({ modelId, ...v }));
  }, [cables, port]);

  if (!port || !eq) return null;

  const isPower = port.role === 'power_in' || port.role === 'power_out';
  const isSwitchPort = eq.kind === 'switch' && port.role !== 'console';

  const unplug = () => {
    if (!cable || port.cableEnd === null) return;
    const end = port.cableEnd;
    const r = act({ type: 'cable/disconnect', cableId: cable.id, end }, `Unplugged ${getCableModel(cable.modelId).shortName} from ${port.label}`);
    if (r.ok) setInHand({ cableId: cable.id, freeEnd: end });
  };

  const plugInHand = () => {
    if (!inHand) return;
    const r = act({ type: 'cable/connect', cableId: inHand.cableId, end: inHand.freeEnd, portId: port.id }, `Plugged into ${port.label}`);
    if (!r.ok) return;
    const c = useSimulationStore.getState().state.cables[inHand.cableId];
    const other = inHand.freeEnd === 0 ? 1 : 0;
    setInHand(c.ends[other].portId ? null : { cableId: c.id, freeEnd: other });
  };

  const takeFromInventory = () => {
    const cand = candidates.find((c) => c.modelId === pick) ?? candidates[0];
    if (!cand) return;
    const r = act({ type: 'cable/connect', cableId: cand.cableId, end: cand.end, portId: port.id }, `Connected ${getCableModel(cand.modelId).shortName} to ${port.label}`);
    if (r.ok) setInHand({ cableId: cand.cableId, freeEnd: cand.end === 0 ? 1 : 0 });
  };

  const xcvr = port.transceiver ? getTransceiverModel(port.transceiver.modelId) : undefined;
  const cableModel = cable ? getCableModel(cable.modelId) : undefined;

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Plug className="size-3.5" /> Port
        </span>
      }
      subtitle={`${eq.hostname} · ${port.side} panel`}
      actions={
        <Button size="icon" variant="ghost" aria-label="Close port details" onClick={onClose}>
          <X />
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{port.label}</span>
          {port.osName && <Mono className="text-muted">{port.osName}</Mono>}
          {!isPower && <Badge tone={portTone(port.state)}>{PORT_STATE_TEXT[port.state]}</Badge>}
          {isPower && <Badge tone={port.cableId ? (port.role === 'power_out' && !port.live ? 'crit' : 'ok') : 'muted'}>{port.cableId ? 'Cord connected' : 'No cord'}</Badge>}
        </div>
        <KV
          rows={[
            ['Receptacle', PORT_TYPE_LABEL[port.type]],
            ['Role', port.role.replace('_', ' ')],
            ...(port.speedsGbps.length ? ([['Supported', port.speedsGbps.map(formatSpeed).join(' / ')]] as [string, string][]) : []),
            ...(!isPower ? ([['Negotiated', formatSpeed(port.speedGbps)]] as [string, string][]) : []),
            ...(port.reason ? ([['Reason', port.reason]] as [string, string][]) : []),
            ...(port.role === 'power_out' ? ([['Outlet', port.live ? 'Energised' : 'Dead']] as [string, string][]) : []),
            ...(xcvr ? ([['Transceiver', `${xcvr.name} (${xcvr.media.toUpperCase()}, ${xcvr.receptacle === 'mpo12' ? 'MPO-12' : 'LC'})`]] as [string, string][]) : []),
            ['Admin state', port.adminUp ? 'Enabled' : 'Disabled'],
          ]}
        />

        {cable && cableModel ? (
          <div className="space-y-2 rounded-[5px] border border-border bg-surface-2 p-2.5">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="size-2.5 rounded-sm" style={{ background: cableModel.color }} />
              <span className="font-medium">{cableModel.name}</span>
            </div>
            <KV
              rows={[
                ['Cable', <Mono key="c">{cable.label}</Mono>],
                ['Serial', <Mono key="s">{cable.serial}</Mono>],
                ['Far end', peer && peerEq ? (
                  <button key="f" type="button" className="text-left text-accent-strong hover:underline" onClick={() => onJump(peer.id)}>
                    {peerEq.hostname} · {peer.label}
                  </button>
                ) : (
                  <span key="f" className="text-warn">Not plugged in</span>
                )],
                ['Cable state', cable.state + (cable.reason ? ` (${cable.reason})` : '')],
              ]}
            />
            <Button variant="outline" onClick={unplug}>
              <Unplug /> Unplug this end
            </Button>
          </div>
        ) : inHand && inHandCable ? (
          <div className="space-y-2">
            <Callout tone="info" title={`Cable in hand: ${getCableModel(inHandCable.modelId).shortName}`}>
              End {inHand.freeEnd === 0 ? 'A' : 'B'} ({getCableModel(inHandCable.modelId).ends[inHand.freeEnd].replace('_', ' ').toUpperCase()} plug) is free. The engine will check connector fit and cable length.
            </Callout>
            <div className="flex gap-2">
              <Button variant="primary" onClick={plugInHand}>
                <PlugZap /> Plug in here
              </Button>
              <Button variant="ghost" onClick={() => setInHand(null)}>
                Put cable down
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-[12px] text-muted">Empty port. Take a cable from the spares cage (only types whose plug fits are listed):</div>
            {candidates.length === 0 ? (
              <div className="text-[12px] text-subtle">No compatible cable in inventory.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Select aria-label="Cable from inventory" value={pick || candidates[0].modelId} onChange={(e) => setPick(e.target.value)} className="min-w-[200px] flex-1">
                  {candidates.map((c) => (
                    <option key={c.modelId} value={c.modelId}>
                      {getCableModel(c.modelId).name} ({c.count} in stock)
                    </option>
                  ))}
                </Select>
                <Button variant="primary" onClick={takeFromInventory}>
                  <Cable /> Connect
                </Button>
              </div>
            )}
          </div>
        )}

        {isSwitchPort && (
          <div className="flex items-center gap-2 border-t border-border pt-2">
            <span className="text-[12px] text-muted">Switch port admin</span>
            <Button size="xs" variant={port.adminUp ? 'outline' : 'primary'} onClick={() => act({ type: 'port/setAdmin', portId: port.id, up: !port.adminUp }, port.adminUp ? 'Port shut down' : 'Port enabled')}>
              <Power /> {port.adminUp ? 'Shut down' : 'No shutdown'}
            </Button>
          </div>
        )}
        {devMode && !isPower && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-2">
            <Button size="xs" variant="danger" onClick={() => act({ type: 'fault/inject', faultType: 'port_faulty', targetId: port.id }, 'Port fault injected')}>
              Inject port fault
            </Button>
            {cable && (
              <Button size="xs" variant="danger" onClick={() => act({ type: 'fault/inject', faultType: 'cable_damaged', targetId: cable.id }, 'Cable damage injected')}>
                Damage cable
              </Button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
