import { DoorClosed, DoorOpen, Power } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { usePageMemory } from '@/hooks/usePageMemory';
import { ChassisView } from '@/components/server/ChassisView';
import { ComponentDetails } from '@/components/server/ComponentDetails';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AccuracyBadge, Callout } from '@/components/ui/misc';
import { EmptyState, Panel } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { getEquipmentModel } from '@/data/hardware/equipmentCatalog';
import { isMainPowerOn, locationLabel } from '@/simulation/core/SimulationState';
import { useAct, useDevMode } from '@/stores/hardwareStore';
import { useSim } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import { POWER_TEXT, powerTone, STATE_TEXT, stateTone } from '@/utils/format';

export function HardwareLabPage() {
  const { equipmentId: param } = useParams();
  const navigate = useNavigate();
  const s = useSim((st) => st);
  const devMode = useDevMode();
  const act = useAct();
  const lastSelected = useUiStore((st) => st.selectedEquipmentId);
  const selectedComponentId = useUiStore((st) => st.selectedComponentId);
  const selectComponent = useUiStore((st) => st.selectComponent);
  const [lastLab, setLastLab] = usePageMemory('hardwareEquipmentId');
  const [slotMem, setSlotMem] = usePageMemory('hardwareSlotId');
  const inspectable = (id: string | null | undefined): id is string => !!id && !!s.equipment[id] && getEquipmentModel(s.equipment[id].modelId).slots.length > 0;
  const eqId = param && s.equipment[param] ? param : inspectable(lastLab) ? lastLab : inspectable(lastSelected) ? lastSelected : 'srv-r01-01';
  const eq = s.equipment[eqId];
  // The remembered slot belongs to one chassis: "<equipmentId>|<slotId>".
  const slotId = slotMem?.startsWith(`${eqId}|`) ? slotMem.slice(eqId.length + 1) : null;
  const setSlotId = (id: string | null) => setSlotMem(id ? `${eqId}|${id}` : null);
  useEffect(() => setLastLab(eqId), [eqId, setLastLab]);

  // Sync slot selection from a component selected elsewhere (e.g. equipment details).
  useEffect(() => {
    if (!selectedComponentId) return;
    const c = s.components[selectedComponentId];
    if (c?.location.kind === 'equipment' && c.location.equipmentId === eqId) setSlotMem(`${eqId}|${c.location.slotId}`);
  }, [selectedComponentId, eqId, s.components, setSlotMem]);

  const options = useMemo(() => {
    const groups = new Map<string, { id: string; label: string }[]>();
    for (const e of Object.values(s.equipment)) {
      const m = getEquipmentModel(e.modelId);
      if (m.slots.length === 0) continue;
      const key = e.location.kind === 'rack' ? e.location.rackId : e.location.kind === 'floor' ? 'Floor' : 'Inventory';
      const list = groups.get(key) ?? [];
      list.push({ id: e.id, label: `${e.hostname} · ${m.shortName}` });
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [s.equipment]);

  if (!eq) return <Page><EmptyState title="No equipment selected" /></Page>;
  const model = getEquipmentModel(eq.modelId);
  const host = eq.kind === 'server' || eq.kind === 'compute_tray' || eq.kind === 'nvlink_switch_tray' || eq.kind === 'switch';
  const hasInternal = model.slots.some((sl) => sl.access === 'internal');

  return (
    <Page>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          aria-label="Equipment to inspect"
          value={eqId}
          onChange={(e) => {
            setSlotId(null);
            selectComponent(null);
            navigate(`/hardware/${e.target.value}`);
          }}
          className="max-w-[340px]"
        >
          {options.map(([g, items]) => (
            <optgroup key={g} label={g}>
              {items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {host && <Badge tone={stateTone(eq.state)}>{STATE_TEXT[eq.state]}</Badge>}
        {eq.powerStatus !== 'not_applicable' && <Badge tone={powerTone(eq.powerStatus)}>Power {POWER_TEXT[eq.powerStatus]}</Badge>}
        <AccuracyBadge accuracy={model.accuracy} note={model.note} />
        <div className="ml-auto flex flex-wrap gap-2">
          {host && eq.location.kind === 'rack' && (
            <Button
              variant={isMainPowerOn(eq) ? 'outline' : 'primary'}
              onClick={() => act({ type: 'equipment/power', equipmentId: eq.id, power: eq.desiredPower === 'on' && eq.state !== 'standby' ? 'off' : 'on' })}
            >
              <Power /> {eq.desiredPower === 'on' && eq.state !== 'standby' && eq.state !== 'powered_off' ? 'Power off' : 'Power on'}
            </Button>
          )}
          {hasInternal && host && (
            <Button variant={eq.chassisOpen ? 'primary' : 'outline'} onClick={() => act({ type: 'equipment/setChassisOpen', equipmentId: eq.id, open: !eq.chassisOpen })}>
              {eq.chassisOpen ? <DoorClosed /> : <DoorOpen />} {eq.chassisOpen ? 'Close lid' : 'Open lid'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)]">
        <Panel title={`${eq.hostname} · ${model.name}`} subtitle={locationLabel(s, eq)}>
          <ChassisView
            s={s}
            eq={eq}
            selectedSlotId={slotId}
            devMode={devMode}
            onSelectSlot={(id) => {
              setSlotId(id);
              selectComponent(eq.slots[id] ?? null);
            }}
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Callout tone="info" title="Inspect before replacing">
              Colours here come from physical indicators only (PSU, fan, drive, DIMM LEDs). Use the BMC and diagnostics to confirm a fault before you pull a part.
            </Callout>
            <Callout tone={isMainPowerOn(eq) ? 'warn' : 'ok'} title="Service rules">
              Hot-swap parts can be replaced live. Everything else needs the host off, and AC disconnected for a fully safe procedure.
            </Callout>
          </div>
        </Panel>
        <ComponentDetails s={s} eq={eq} slotId={slotId} devMode={devMode} />
      </div>
    </Page>
  );
}
