/**
 * Port inspector with the physical cable workflow (unplug → cable in hand →
 * plug elsewhere), switch-port VLAN configuration and endpoint IP details.
 * Every change goes through the engine.
 */
import { Cable, Plug, PlugZap, Power, Unplug, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout, Mono } from '@/components/ui/misc';
import { KV, Panel } from '@/components/ui/panel';
import { Input, Select } from '@/components/ui/select';
import { getCableModel, getTransceiverModel } from '@/data/cables/cableCatalog';
import { endFor, useCableActions } from '@/hooks/useCableActions';
import { checkFit, CONNECTOR_LABEL, PORT_TYPE_LABEL } from '@/simulation/networking/Cable';
import { describeVlan, isSwitchingPort, vlanOf } from '@/simulation/networking/Vlan';
import { useAct, useDevMode, usePort } from '@/stores/hardwareStore';
import { getSim, useSim } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import type { Id, VlanConfig } from '@/types/simulation';
import { formatSpeed, PORT_STATE_TEXT, portTone } from '@/utils/format';

function VlanEditor({ portId, current }: { portId: Id; current: VlanConfig }) {
  const act = useAct();
  const [mode, setMode] = useState(current.mode);
  const [access, setAccess] = useState(String(current.access));
  const [allowed, setAllowed] = useState(current.allowed.join(','));
  const [native, setNative] = useState(String(current.native));
  useEffect(() => {
    setMode(current.mode);
    setAccess(String(current.access));
    setAllowed(current.allowed.join(','));
    setNative(String(current.native));
  }, [current]);
  const apply = () => {
    const list = allowed
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    act({ type: 'port/setVlan', portId, vlan: { mode, access: Number(access), allowed: list, native: Number(native) } }, 'Switch port VLAN updated');
  };
  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Switchport (802.1Q)</div>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Select aria-label="Switchport mode" value={mode} onChange={(e) => setMode(e.target.value as VlanConfig['mode'])}>
          <option value="access">access</option>
          <option value="trunk">trunk</option>
        </Select>
        {mode === 'access' ? (
          <label className="flex items-center gap-1 text-muted">
            VLAN
            <Input aria-label="Access VLAN" value={access} onChange={(e) => setAccess(e.target.value)} className="w-16" inputMode="numeric" />
          </label>
        ) : (
          <>
            <label className="flex items-center gap-1 text-muted">
              allowed
              <Input aria-label="Allowed VLANs" value={allowed} onChange={(e) => setAllowed(e.target.value)} className="w-24" />
            </label>
            <label className="flex items-center gap-1 text-muted">
              native
              <Input aria-label="Native VLAN" value={native} onChange={(e) => setNative(e.target.value)} className="w-14" inputMode="numeric" />
            </label>
          </>
        )}
        <Button size="xs" variant="primary" onClick={apply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

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
  const { plug, unplug } = useCableActions();
  const [pick, setPick] = useState('');

  const inHandCable = inHand ? cables[inHand.cableId] : undefined;

  /** Inventory cables (both ends free) that fit this port at either end, one entry per model. */
  const candidates = useMemo(() => {
    if (!port || port.cableId) return [];
    const byModel = new Map<string, { cableId: Id; count: number }>();
    for (const c of Object.values(cables)) {
      if (c.ends[0].portId || c.ends[1].portId) continue;
      const m = getCableModel(c.modelId);
      if (!checkFit(port, m.ends[0]).ok && !checkFit(port, m.ends[1]).ok) continue;
      const cur = byModel.get(m.id);
      if (cur) cur.count++;
      else byModel.set(m.id, { cableId: c.id, count: 1 });
    }
    return [...byModel.entries()].map(([modelId, v]) => ({ modelId, ...v }));
  }, [cables, port]);

  if (!port || !eq) return null;

  const isPower = port.role === 'power_in' || port.role === 'power_out';
  const switching = isSwitchingPort(getSim(), port);
  const isSwitchPort = eq.kind === 'switch' && port.role !== 'console';
  const xcvr = port.transceiver ? getTransceiverModel(port.transceiver.modelId) : undefined;
  const cableModel = cable ? getCableModel(cable.modelId) : undefined;
  const handFit = inHandCable ? endFor(getSim(), inHandCable.id, port.id) : null;
  const handEndLabel = inHandCable ? (inHand?.freeEnd === null || inHand?.freeEnd === undefined ? 'both ends free' : `${CONNECTOR_LABEL[getCableModel(inHandCable.modelId).ends[inHand.freeEnd]]} free`) : '';

  const takeFromInventory = () => {
    const cand = candidates.find((c) => c.modelId === pick) ?? candidates[0];
    if (!cand) return;
    setInHand({ cableId: cand.cableId, freeEnd: null });
    plug(cand.cableId, port.id);
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Plug className="size-3.5" /> Port
        </span>
      }
      subtitle={`${eq.hostname} · ${eq.kind === 'laptop' ? 'laptop' : `${port.side} panel`}`}
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
            ...(port.ip ? ([['IP address', <Mono key="ip">{`${port.ip.address}/${port.ip.prefix}${port.ip.gateway ? ` gw ${port.ip.gateway}` : ''}`}</Mono>]] as [string, React.ReactNode][]) : []),
            ...(switching ? ([['Switchport', describeVlan(vlanOf(port))]] as [string, string][]) : []),
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
                [
                  'Far end',
                  peer && peerEq ? (
                    <button key="f" type="button" className="text-left text-accent-strong hover:underline" onClick={() => onJump(peer.id)}>
                      {peerEq.hostname} · {peer.label}
                    </button>
                  ) : (
                    <span key="f" className="text-warn">
                      Not plugged in
                    </span>
                  ),
                ],
                ['Cable state', cable.state + (cable.reason ? ` (${cable.reason})` : '')],
              ]}
            />
            <Button variant="outline" onClick={() => unplug(port.id)}>
              <Unplug /> Unplug this end
            </Button>
          </div>
        ) : inHand && inHandCable ? (
          <div className="space-y-2">
            <Callout tone={handFit?.end === null ? 'warn' : 'info'} title={`Cable in hand: ${getCableModel(inHandCable.modelId).shortName}`}>
              {handEndLabel}. {handFit?.end === null ? `It will not fit here: ${handFit.reason}.` : 'The engine checks connector fit and cable length when you plug in.'}
            </Callout>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => plug(inHandCable.id, port.id)}>
                <PlugZap /> Plug in here
              </Button>
              <Button variant="ghost" onClick={() => setInHand(null)}>
                Put cable down
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-[12px] text-muted">Empty port. Take a cable from the spares cage (only types whose plug fits are listed), or drag one from the cable tray:</div>
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

        {switching && <VlanEditor portId={port.id} current={vlanOf(port)} />}
        {isSwitchPort && (
          <div className="flex items-center gap-2 border-t border-border pt-2">
            <span className="text-[12px] text-muted">Switch port admin</span>
            <Button size="xs" variant={port.adminUp ? 'outline' : 'primary'} onClick={() => act({ type: 'port/setAdmin', portId: port.id, up: !port.adminUp }, port.adminUp ? 'Port shut down' : 'Port enabled')}>
              <Power /> {port.adminUp ? 'Shut down' : 'No shutdown'}
            </Button>
          </div>
        )}
        {devMode && !isPower && eq.kind !== 'laptop' && (
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
