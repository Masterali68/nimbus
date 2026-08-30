import { describe, expect, it } from "vitest";
import { SimClock } from "@/simulation/clock";

describe("SimClock", () => {
  it("advances tick count and derives minutesElapsed from tickLengthMinutes", () => {
    const clock = new SimClock(1, 365);
    const t1 = clock.advance(1);
    expect(t1.tick).toBe(1);
    expect(t1.minutesElapsed).toBe(1);

    const t2 = clock.advance(59);
    expect(t2.tick).toBe(60);
    expect(t2.minutesElapsed).toBe(60);
    expect(t2.hourOfDay).toBeCloseTo(1, 5);
  });

  it("respects a configurable tick rate", () => {
    const clock = new SimClock(5, 365);
    const t = clock.advance(1);
    expect(t.minutesElapsed).toBe(5);
  });

  it("wraps minuteOfDay and increments dayIndex after 1440 minutes", () => {
    const clock = new SimClock(1, 365);
    clock.advance(1440);
    const t = clock.advance(1);
    expect(t.dayIndex).toBe(1);
    expect(t.minuteOfDay).toBe(1);
  });

  it("getTime() reflects the current tick without advancing", () => {
    const clock = new SimClock(1, 365);
    clock.advance(10);
    const a = clock.getTime();
    const b = clock.getTime();
    expect(a).toEqual(b);
    expect(a.tick).toBe(10);
  });

  it("getTickRate() returns the configured tick length in minutes", () => {
    const clock = new SimClock(1, 365);
    expect(clock.getTickRate()).toBe(1);
  });

  it("seasonalFactor stays within [0, 1] across a full year", () => {
    const clock = new SimClock(1440, 365); // 1 tick = 1 day for this test
    for (let i = 0; i < 400; i++) {
      const t = clock.advance(1);
      expect(t.seasonalFactor).toBeGreaterThanOrEqual(0);
      expect(t.seasonalFactor).toBeLessThanOrEqual(1);
    }
  });
});
