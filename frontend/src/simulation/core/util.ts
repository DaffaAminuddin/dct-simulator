/** Small deterministic helpers shared by the simulation modules. */
import type { Condition, Health, Severity } from '@/types/simulation';

/** FNV-1a 32-bit hash: deterministic, fast, good enough for serial numbers. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic locally administered MAC address derived from a seed (serial / port id). */
export function macFor(seed: string): string {
  const h = hash32(seed);
  const h2 = hash32(`${seed}#mac`);
  return ['02', (h & 255).toString(16), ((h >>> 8) & 255).toString(16), ((h >>> 16) & 255).toString(16), (h2 & 255).toString(16), ((h2 >>> 8) & 255).toString(16)]
    .map((x) => x.padStart(2, '0'))
    .join(':');
}

const SERIAL_ALPHABET = '0123456789ABCDEFGHJKLMNPRSTUVWXY';

/** Deterministic simulated serial number, e.g. `RS1-2F8K3J7Q`. */
export function serialFor(id: string, prefix: string): string {
  let h = hash32(id);
  let h2 = hash32(`${id}#`);
  let out = '';
  for (let i = 0; i < 8; i++) {
    const src = i < 4 ? h : h2;
    out += SERIAL_ALPHABET[src & 31];
    if (i < 4) h >>>= 5;
    else h2 >>>= 5;
  }
  return `${prefix.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase()}-${out}`;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

export function worstSeverity(conditions: Condition[]): Severity | null {
  let worst: Severity | null = null;
  for (const c of conditions) {
    if (worst === null || SEVERITY_RANK[c.severity] > SEVERITY_RANK[worst]) worst = c.severity;
  }
  return worst;
}

export function healthFromConditions(conditions: Condition[]): Health {
  const w = worstSeverity(conditions);
  if (w === 'critical') return 'critical';
  if (w === 'warning') return 'warning';
  return 'ok';
}

const HEALTH_RANK: Record<Health, number> = { ok: 0, unknown: 1, warning: 2, critical: 3 };

export function worstHealth(values: Iterable<Health>): Health {
  let worst: Health = 'ok';
  for (const v of values) if (HEALTH_RANK[v] > HEALTH_RANK[worst]) worst = v;
  return worst;
}

export function sameConditions(a: Condition[], b: Condition[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.code !== y.code || x.severity !== y.severity || x.message !== y.message) return false;
  }
  return true;
}

export function sameArray<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Assign `obj[key] = value` only if the value changed. Keeps derived arrays
 * (conditions, xids) stable when their content is unchanged.
 */
export function set<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  const cur = obj[key];
  if (cur === value) return;
  if (Array.isArray(cur) && Array.isArray(value)) {
    if (cur.length === 0 && value.length === 0) return;
    if (isConditionArray(cur) && isConditionArray(value) && sameConditions(cur, value)) return;
    if (!isConditionArray(cur) && sameArray(cur, value)) return;
  }
  obj[key] = value;
}

function isConditionArray(a: unknown[]): a is Condition[] {
  return a.length > 0 && typeof a[0] === 'object' && a[0] !== null && 'code' in (a[0] as object);
}

export class SimError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'SimError';
  }
}

export function fail(code: string, message: string): never {
  throw new SimError(code, message);
}

export function formatU(uStart: number, heightU: number): string {
  return heightU <= 1 ? `U${uStart}` : `U${uStart}–U${uStart + heightU - 1}`;
}
