import { Award, Lock } from 'lucide-react';
import { Page } from '@/components/layout/AppShell';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Meter, Panel, Stat } from '@/components/ui/panel';
import { MODULES } from '@/data/learning/modules';
import { WORK_ORDERS } from '@/data/workorders/workOrders';
import { skillLevel, useProgressStore } from '@/stores/progressStore';
import { formatElapsed } from '@/utils/format';

const MISTAKE_TEXT: Record<string, string> = {
  CHASSIS_CLOSED: 'Tried to service internal parts with the lid closed',
  HOST_RUNNING: 'Tried to swap a cold-swap part on a running host',
  CONNECTOR_MISMATCH: 'Plugged a connector into the wrong port type',
  CABLE_TOO_SHORT: 'Picked a cable too short for the run',
  CABLES_ATTACHED: 'Tried to remove hardware with cables still attached',
  POWERED_ON: 'Tried to un-rack powered equipment',
  INCOMPATIBLE: 'Tried to install an incompatible part',
  PSU_MISMATCH: 'Mixed PSU models in one chassis',
  NOT_FRU: 'Tried to replace a non-field-replaceable part',
  OVERLAP: 'Chose an occupied rack position',
  OUT_OF_RANGE: 'Chose a rack position outside the rack',
  RACK_TYPE: 'Mounted equipment in the wrong rack type',
  NO_POWER: 'Pressed power-on with no input power',
  PORT_OCCUPIED: 'Tried to plug into an occupied port',
};

export function ProgressPage() {
  const p = useProgressStore();
  // The learner's record survives simulation resets; ticket status does not.
  const resolvedRuns = WORK_ORDERS.filter((w) => p.completed[w.id]).map((w) => ({ w, rec: p.completed[w.id] }));
  const skill = skillLevel(p.modulesCompleted.length, resolvedRuns.length);
  const validations = Object.values(p.workOrders).reduce((n, r) => n + (r.validations ?? 0), 0);
  const completions = resolvedRuns.reduce((n, { rec }) => n + rec.count, 0);
  const accuracy = validations ? Math.min(100, Math.round((completions / validations) * 100)) : null;
  const times = resolvedRuns.map(({ rec }) => rec.bestMs).filter((x): x is number => typeof x === 'number');
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  const mistakes = Object.entries(p.mistakes).sort((a, b) => b[1] - a[1]);

  const achievements = [
    { id: 'first', title: 'First ticket', desc: 'Resolve any work order', got: resolvedRuns.length >= 1 },
    { id: 'power', title: 'A+B or bust', desc: 'Restore power redundancy (DCT-0002)', got: resolvedRuns.some(({ w }) => w.id === 'DCT-0002') },
    { id: 'gpu', title: 'Off the bus', desc: 'Recover a GB200 tray GPU failure (DCT-0001)', got: resolvedRuns.some(({ w }) => w.id === 'DCT-0001') },
    { id: 'deploy', title: 'Rack and stack', desc: 'Deploy a new server end to end (DCT-0006)', got: resolvedRuns.some(({ w }) => w.id === 'DCT-0006') },
    { id: 'clean', title: 'Clean hands', desc: 'Resolve 3 tickets with no refused actions', got: resolvedRuns.length >= 3 && mistakes.length === 0 },
    { id: 'scholar', title: 'Scholar', desc: 'Complete 6 learning modules', got: p.modulesCompleted.length >= 6 },
  ];

  return (
    <Page className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Skill level" value={skill.title} sub={`${skill.points} points`} />
        <Stat label="Modules" value={`${p.modulesCompleted.length}/${MODULES.length}`} sub="completed" />
        <Stat label="Work orders" value={`${resolvedRuns.length}/${WORK_ORDERS.length}`} sub="resolved" />
        <Stat label="Diagnostic accuracy" value={accuracy === null ? '—' : `${accuracy}%`} sub="resolved / validation attempts" />
        <Stat label="Avg best time" value={avg === null ? '—' : formatElapsed(avg)} sub="simulated time per ticket" />
        <Stat label="Actions taken" value={p.actions} sub={`${mistakes.reduce((n, [, c]) => n + c, 0)} refused by the engine`} />
      </div>
      <Panel title="Level progress">
        <Meter value={skill.points} max={skill.next || 1} tone="ok" label="Points to next level" />
        <div className="mt-1 text-[11.5px] text-muted">Modules are worth 50 points, resolved work orders 150. Phase 6 adds scored assessments.</div>
      </Panel>
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Achievements">
          <ul className="space-y-2">
            {achievements.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                {a.got ? <Award className="size-4 text-accent" /> : <Lock className="size-4 text-subtle" />}
                <div className="min-w-0">
                  <div className={`text-[12.5px] ${a.got ? '' : 'text-muted'}`}>{a.title}</div>
                  <div className="text-[11px] text-subtle">{a.desc}</div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Common mistakes" subtitle="Actions the simulation refused">
          {mistakes.length === 0 ? (
            <EmptyState title="None recorded" />
          ) : (
            <ul className="space-y-1.5">
              {mistakes.map(([code, n]) => (
                <li key={code} className="flex items-start gap-2 text-[12px]">
                  <Badge tone="warn">×{n}</Badge>
                  <span>{MISTAKE_TEXT[code] ?? code}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Activity">
          {p.activity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="space-y-1 text-[12px]">
              {p.activity.slice(0, 15).map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 font-mono text-[11px] text-subtle">{new Date(a.at).toLocaleTimeString()}</span>
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Page>
  );
}
