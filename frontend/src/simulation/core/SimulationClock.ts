/**
 * Real-time driver for the engine. Calls `engine.advance()` on a fixed real
 * interval scaled by the speed multiplier. Tests drive the engine directly.
 */
import type { SimulationEngine } from './SimulationEngine';

export const CLOCK_INTERVAL_MS = 500;
export const SPEEDS = [1, 2, 5, 10] as const;
export type ClockSpeed = (typeof SPEEDS)[number];

export class SimulationClock {
  private timer: ReturnType<typeof setInterval> | null = null;
  private speed: ClockSpeed = 1;

  constructor(private readonly engine: SimulationEngine) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.engine.advance(CLOCK_INTERVAL_MS * this.speed), CLOCK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  setSpeed(speed: ClockSpeed): void {
    this.speed = speed;
  }

  getSpeed(): ClockSpeed {
    return this.speed;
  }

  /** Advance immediately by `ms` simulated milliseconds (e.g. "skip 30 s"). */
  skip(ms: number): void {
    this.engine.advance(ms);
  }
}
