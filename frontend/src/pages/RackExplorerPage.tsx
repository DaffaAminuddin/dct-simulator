import { LayoutGrid } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { PortDetails } from '@/components/networking/PortDetails';
import { Led } from '@/components/rack/Led';
import { RackWorkbench } from '@/components/rack/RackWorkbench';
import { CableTray } from '@/components/networking/CableTray';
import { RackSummary } from '@/components/rack/RackSummary';
import { EquipmentDetails } from '@/components/server/EquipmentDetails';
import { StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Segmented, Tabs } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/panel';
import { useDevMode } from '@/stores/hardwareStore';
import { useSim, getSim } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import { healthTone } from '@/utils/format';

export function RackExplorerPage() {
  const { rackId: param } = useParams();
  const navigate = useNavigate();
  const racks = useSim((s) => s.racks);
  const selectedRackId = useUiStore((s) => s.selectedRackId);
  const rackId = param && racks[param] ? param : selectedRackId;
  const side = useUiStore((s) => s.rackSide);
  const setSide = useUiStore((s) => s.setRackSide);
  const selectRack = useUiStore((s) => s.selectRack);
  const selectedEquipmentId = useUiStore((s) => s.selectedEquipmentId);
  const selectedPortId = useUiStore((s) => s.selectedPortId);
  const selectEquipment = useUiStore((s) => s.selectEquipment);
  const selectPort = useUiStore((s) => s.selectPort);
  const devMode = useDevMode();
  const [freeU, setFreeU] = useState<number | null>(null);
  const showCables = useUiStore((s) => s.showCables);
  const setShowCables = useUiStore((s) => s.setShowCables);
  const selectedEq = useSim((s) => (selectedEquipmentId ? s.equipment[selectedEquipmentId] : undefined));

  useEffect(() => {
    if (rackId !== selectedRackId) selectRack(rackId);
  }, [rackId, selectedRackId, selectRack]);

  if (param && !racks[param]) {
    return (
      <Page>
        <EmptyState title={`Rack ${param} does not exist`}>
          <Button onClick={() => navigate('/racks')}>Open Rack Explorer</Button>
        </EmptyState>
      </Page>
    );
  }

  const eqInThisRack = selectedEq && selectedEq.location.kind === 'rack' && selectedEq.location.rackId === rackId;

  const jumpToPort = (portId: string) => {
    const s = getSim();
    const p = s.ports[portId];
    const eq = s.equipment[p.equipmentId];
    const r = eq.location.kind === 'rack' || eq.location.kind === 'cart' ? eq.location.rackId : rackId;
    selectEquipment(eq.id, r);
    selectPort(portId);
    if (eq.location.kind === 'cart') setSide(eq.location.side);
    else setSide(p.side);
    if (r !== rackId) navigate(`/racks/${r}`);
  };

  return (
    <Page>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs
          label="Racks"
          items={Object.values(racks).map((r) => ({
            id: r.id,
            label: (
              <>
                <StatusDot tone={healthTone(r.health)} /> {r.id}
              </>
            ),
          }))}
          value={rackId}
          onChange={(id) => navigate(`/racks/${id}`)}
        />
        <div className="ml-auto flex items-center gap-2">
          <Segmented
            label="Rack side"
            items={[
              { id: 'front', label: 'Front (cold aisle)' },
              { id: 'rear', label: 'Rear (hot aisle)' },
            ]}
            value={side}
            onChange={setSide}
          />
          {(selectedEquipmentId || selectedPortId) && (
            <Button variant="ghost" onClick={() => useUiStore.getState().clearSelection()}>
              <LayoutGrid /> Rack summary
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[auto_minmax(380px,1fr)]">
        <div className="min-w-0 overflow-x-auto rounded-md border border-border bg-surface p-3">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
            <span className="font-medium text-fg">{racks[rackId].name}</span>
            <span className="flex items-center gap-1">
              <Led color="green" /> power/link
            </span>
            <span className="flex items-center gap-1">
              <Led color="blink-amber" /> standby / warning
            </span>
            <span className="flex items-center gap-1">
              <Led color="amber" /> fault
            </span>
            <span className="flex items-center gap-1">
              <Led color="blue" /> UID
            </span>
            {devMode && <span className="text-warn">Developer colours: ports show exact link state</span>}
            <label className="ml-auto flex items-center gap-1.5">
              <input type="checkbox" checked={showCables} onChange={(e) => setShowCables(e.target.checked)} className="accent-[#7cc33f]" /> Show cables
            </label>
          </div>
          <div className="max-h-[calc(100vh-190px)] overflow-y-auto pr-1">
            <RackWorkbench
              rackId={rackId}
              side={side}
              selectedEquipmentId={selectedEquipmentId}
              selectedPortId={selectedPortId}
              devMode={devMode}
              selectedFreeU={freeU}
              onSelectEquipment={(id) => {
                selectEquipment(id, rackId);
                setFreeU(null);
              }}
              onSelectPort={(pid, eid) => {
                if (useUiStore.getState().selectedEquipmentId !== eid) selectEquipment(eid, rackId);
                selectPort(pid);
              }}
              onSelectFreeU={(u) => {
                useUiStore.getState().clearSelection();
                setFreeU(u);
              }}
            />
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          {selectedPortId && <PortDetails portId={selectedPortId} onClose={() => selectPort(null)} onJump={jumpToPort} />}
          {eqInThisRack && selectedEquipmentId ? (
            <EquipmentDetails equipmentId={selectedEquipmentId} onClose={() => selectEquipment(null)} onSelectPort={(pid) => jumpToPort(pid)} />
          ) : (
            !selectedPortId && <RackSummary rackId={rackId} preselectU={freeU} />
          )}
          <CableTray />
        </div>
      </div>
    </Page>
  );
}
