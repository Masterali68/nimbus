import type { SimTime } from "./types";

const MINUTES_PER_DAY = 1440;

/**
 * Pure tick -> SimTime derivation. No browser globals (no setInterval/rAF) —
 * advancing time is a synchronous, deterministic function call, so tests can
 * simulate an entire day (or many) instantly with `advance(1440)`.
 */
export class SimClock {
  private tickCount = 0;

  constructor(
    private readonly tickLengthMinutes: number,
    private readonly yearLengthDays: number
  ) {}

  advance(ticks = 1): SimTime {
    this.tickCount += ticks;
    return this.deriveTime();
  }

  getTime(): SimTime {
    return this.deriveTime();
  }

  getTickRate(): number {
    return this.tickLengthMinutes;
  }

  getTickCount(): number {
    return this.tickCount;
  }

  private deriveTime(): SimTime {
    const minutesElapsed = this.tickCount * this.tickLengthMinutes;
    const dayIndex = Math.floor(minutesElapsed / MINUTES_PER_DAY);
    const minuteOfDay = minutesElapsed % MINUTES_PER_DAY;
    const hourOfDay = minuteOfDay / 60;
    // 0 = Sunday, matching JS Date's getDay() convention.
    const dayOfWeek = dayIndex % 7;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const seasonalFactor =
      0.5 + 0.5 * Math.sin((2 * Math.PI * dayIndex) / this.yearLengthDays - Math.PI / 2);

    return {
      tick: this.tickCount,
      minutesElapsed,
      dayIndex,
      minuteOfDay,
      hourOfDay,
      dayOfWeek,
      isWeekend,
      seasonalFactor,
    };
  }
}
