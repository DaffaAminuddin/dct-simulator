import type { EquipmentState, Health, PortState, PowerStatus, Severity } from '@/types/simulation';

export function formatW(w: number): string {
  if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(w >= 100000 ? 0 : 1)} kW`;
  return `${Math.round(w)} W`;
}

export function formatSpeed(gbps: number): string {
  if (gbps <= 0) return '—';
  return gbps >= 1 ? `${gbps}G` : `${gbps * 1000}M`;
}

export function formatTemp(c: number): string {
  return `${c.toFixed(1)} °C`;
}

export function formatSimTime(startedAt: string, timeMs: number): string {
  const d = new Date(new Date(startedAt).getTime() + timeMs);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function formatClock(startedAt: string, timeMs: number): string {
  return formatSimTime(startedAt, timeMs).slice(11);
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(sec).padStart(2, '0')}s`;
}

export const STATE_TEXT: Record<EquipmentState, string> = {
  powered_off: 'Powered off',
  standby: 'Standby',
  powered_on: 'POST',
  booting: 'Booting',
  boot_failed: 'Boot failed',
  os_running: 'OS running',
  degraded: 'Degraded',
  passive: 'Passive',
};

export const PORT_STATE_TEXT: Record<PortState, string> = {
  disconnected: 'Disconnected',
  connected: 'Cable in, no peer',
  link_up: 'Link up',
  link_down: 'Link down',
  disabled: 'Admin down',
  faulty: 'Faulty',
};

export const POWER_TEXT: Record<PowerStatus, string> = {
  redundant: 'Redundant',
  available: 'Available',
  degraded: 'Degraded',
  failed: 'Failed',
  disconnected: 'No input',
  not_applicable: 'n/a',
};

export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'muted' | 'accent';

export function healthTone(h: Health): Tone {
  return h === 'ok' ? 'ok' : h === 'warning' ? 'warn' : h === 'critical' ? 'crit' : 'muted';
}

export function severityTone(s: Severity): Tone {
  return s === 'critical' ? 'crit' : s === 'warning' ? 'warn' : 'info';
}

export function stateTone(s: EquipmentState): Tone {
  switch (s) {
    case 'os_running':
      return 'ok';
    case 'degraded':
      return 'warn';
    case 'boot_failed':
      return 'crit';
    case 'powered_on':
    case 'booting':
      return 'info';
    default:
      return 'muted';
  }
}

export function powerTone(p: PowerStatus): Tone {
  switch (p) {
    case 'redundant':
    case 'available':
      return 'ok';
    case 'degraded':
      return 'warn';
    case 'failed':
    case 'disconnected':
      return 'crit';
    default:
      return 'muted';
  }
}

export function portTone(p: PortState): Tone {
  switch (p) {
    case 'link_up':
      return 'ok';
    case 'link_down':
      return 'warn';
    case 'faulty':
      return 'crit';
    case 'connected':
      return 'info';
    default:
      return 'muted';
  }
}

export const HEALTH_TEXT: Record<Health, string> = { ok: 'OK', warning: 'Warning', critical: 'Critical', unknown: 'Unknown' };
