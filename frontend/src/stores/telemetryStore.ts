/**
 * Telemetry history for dashboard charts: samples the engine snapshot every
 * 5 simulated seconds (monitoring view), keeps one hour. Read-only mirror.
 */
import { create } from 'zustand';
import { isHost } from '@/simulation/core/SimulationState';
import { monitoringAlerts } from '@/simulation/diagnostics/DiagnosticEngine';
import type { SimulationState } from '@/types/simulation';
import { engine } from './simulationStore';

export const SAMPLE_MS = 5000;
export const MAX_SAMPLES = 720;

export interface RackSample {
  powerW: number;
  alerts: number;
  healthy: number;
  hosts: number;
}

export interface Sample {
  t: number;
  itW: number;
  feedA: number;
  feedB: number;
  alerts: number;
  crit: number;
  healthy: number;
  hosts: number;
  racks: Record<string, RackSample>;
}

export function sampleOf(s: SimulationState): Sample {
  const alerts = monitoringAlerts(s, false);
  const racks: Record<string, RackSample> = {};
  for (const r of Object.values(s.racks)) racks[r.id] = { powerW: r.powerW, alerts: 0, healthy: 0, hosts: 0 };
  let healthy = 0;
  let hosts = 0;
  for (const e of Object.values(s.equipment)) {
    if (!isHost(e) || e.location.kind !== 'rack') continue;
    hosts++;
    const ok = e.state === 'os_running';
    if (ok) healthy++;
    const rs = racks[e.location.rackId];
    rs.hosts++;
    if (ok) rs.healthy++;
  }
  for (const a of alerts) if (a.rackId && racks[a.rackId]) racks[a.rackId].alerts++;
  return {
    t: s.timeMs,
    itW: s.facility.feeds.A.loadW + s.facility.feeds.B.loadW,
    feedA: s.facility.feeds.A.loadW,
    feedB: s.facility.feeds.B.loadW,
    alerts: alerts.length,
    crit: alerts.filter((a) => a.severity === 'critical').length,
    healthy,
    hosts,
    racks,
  };
}

interface TelemetryStore {
  samples: Sample[];
}

export const useTelemetryStore = create<TelemetryStore>(() => ({ samples: [sampleOf(engine.getState())] }));

engine.subscribe((s) => {
  const { samples } = useTelemetryStore.getState();
  const last = samples.at(-1);
  if (last && s.timeMs < last.t) {
    useTelemetryStore.setState({ samples: [sampleOf(s)] }); // scenario reset
    return;
  }
  if (last && s.timeMs - last.t < SAMPLE_MS) return;
  const next = [...samples, sampleOf(s)];
  useTelemetryStore.setState({ samples: next.length > MAX_SAMPLES ? next.slice(-MAX_SAMPLES) : next });
});

/** Samples within the last `windowMs` of simulated time. */
export function windowed(samples: Sample[], windowMs: number): Sample[] {
  const end = samples.at(-1)?.t ?? 0;
  return samples.filter((x) => x.t >= end - windowMs);
}
