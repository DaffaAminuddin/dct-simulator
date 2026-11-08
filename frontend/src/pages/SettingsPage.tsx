import { FlaskConical, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Page } from '@/components/layout/AppShell';
import { FaultInjectorPanel } from '@/components/diagnostics/FaultInjectorPanel';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Input } from '@/components/ui/select';
import { Segmented } from '@/components/ui/tabs';
import { useProgressStore } from '@/stores/progressStore';
import { useSimulationStore } from '@/stores/simulationStore';
import { type TrainingMode, useUiStore } from '@/stores/uiStore';

const MODES: { id: TrainingMode; label: string; desc: string }[] = [
  { id: 'guided', label: 'Guided Learning', desc: 'Step-by-step help and hints on every ticket. Recommended for beginners.' },
  { id: 'practice', label: 'Practice Lab', desc: 'Problems without instructions. Hints are available on request.' },
  { id: 'incident', label: 'Incident Simulation', desc: 'No hints and hidden root causes, as in production. Detailed evaluation arrives in Phase 6.' },
];

export function SettingsPage() {
  const mode = useUiStore((s) => s.trainingMode);
  const setMode = useUiStore((s) => s.setTrainingMode);
  const devMode = useUiStore((s) => s.devMode);
  const setDevMode = useUiStore((s) => s.setDevMode);
  const reset = useSimulationStore((s) => s.reset);
  const resetProgress = useProgressStore((s) => s.resetProgress);
  const learnerName = useProgressStore((s) => s.learnerName);
  const setLearnerName = useProgressStore((s) => s.setLearnerName);
  const [nameDraft, setNameDraft] = useState(learnerName);
  const notify = useUiStore((s) => s.notify);
  const [confirm, setConfirm] = useState<'sim' | 'progress' | null>(null);

  return (
    <Page className="grid gap-3 lg:grid-cols-2">
      <Panel title="Training mode">
        <div className="space-y-2">
          <Segmented label="Training mode" items={MODES.map((m) => ({ id: m.id, label: m.label }))} value={mode} onChange={setMode} />
          <p className="text-[12px] text-muted">{MODES.find((m) => m.id === mode)?.desc}</p>
        </div>
      </Panel>

      <Panel title="Simulation">
        <div className="space-y-3">
          <p className="text-[12px] text-muted">Resetting rebuilds Data Hall 01 from the seed scenario. All faults, cabling changes and swaps are lost.</p>
          {confirm === 'sim' ? (
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  reset();
                  useProgressStore.getState().abandonRuns();
                  useUiStore.getState().clearSelection();
                  setConfirm(null);
                  notify({ tone: 'ok', title: 'Simulation reset' });
                }}
              >
                Confirm reset
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setConfirm('sim')}>
              <RotateCcw /> Reset simulation
            </Button>
          )}
        </div>
      </Panel>

      <Panel title="Developer mode" className="lg:col-span-2">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={devMode} onChange={(e) => setDevMode(e.target.checked)} className="size-4 accent-[#4cc38a]" />
            <FlaskConical className="size-4 text-warn" /> Enable developer mode (ground truth, fault injection)
          </label>
          {devMode ? (
            <>
              <Callout tone="warn">Developer mode reveals hidden root causes. Turn it off before practising or taking an assessment.</Callout>
              <FaultInjectorPanel />
            </>
          ) : (
            <p className="text-[12px] text-muted">Off: views show only what a technician could observe (LEDs, BMC, OS, driver).</p>
          )}
        </div>
      </Panel>

      <Panel title="Learner profile">
        <div className="space-y-3">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setLearnerName(nameDraft);
              notify({ tone: 'ok', title: 'Name updated' });
            }}
          >
            <Input aria-label="Display name" className="w-56" maxLength={40} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Your name" />
            <Button type="submit" variant="outline" disabled={!nameDraft.trim() || nameDraft.trim() === learnerName}>
              Save name
            </Button>
          </form>
          <p className="text-[12px] text-muted">Progress is stored in this browser. Backend sync arrives in Phase 6.</p>
          {confirm === 'progress' ? (
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  resetProgress();
                  setConfirm(null);
                  notify({ tone: 'ok', title: 'Progress cleared' });
                }}
              >
                Confirm clear
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setConfirm('progress')}>
              Clear progress
            </Button>
          )}
        </div>
      </Panel>

      <Panel title="Content accuracy">
        <ul className="space-y-1 text-[12px] text-muted">
          <li>
            <span className="text-fg">Verified spec:</span> widely published vendor or standards figures (sources cited per item).
          </li>
          <li>
            <span className="text-fg">Industry practice:</span> general behaviour and conventions.
          </li>
          <li>
            <span className="text-fg">Simplified model:</span> teaching approximations (power, thermal, timing).
          </li>
          <li>
            <span className="text-fg">Reference model:</span> generic hardware designs, not OEM layouts.
          </li>
          <li>
            <span className="text-fg">Training scenario:</span> hypothetical incidents.
          </li>
        </ul>
        <p className="mt-2 text-[11.5px] text-subtle">See docs/ASSUMPTIONS.md in the repository for every assumption and limitation.</p>
      </Panel>
    </Page>
  );
}
