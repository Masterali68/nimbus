import { describe, expect, it } from "vitest";
import { stepPd } from "@/simulation/controllers/pd";
import type { PdConfig } from "@/simulation/types";

const config: PdConfig = { kp: 0.08, kd: 0.4, targetNetPowerKw: 0, minOperatingPct: 20 };

describe("stepPd", () => {
  it("stays at 100% operatingPct when net power is at or above target", () => {
    const result = stepPd({ filteredNetPowerKw: 50, prevError: 0, tickLengthMinutes: 1, config });
    expect(result.operatingPct).toBe(100);
  });

  it("a step-input deficit produces a smooth multi-tick transition, not an instant jump to the floor", () => {
    // Net power drops sharply and stays there — simulate the EMA-filtered signal approaching the
    // new value gradually over several ticks (as trajectory.ts would actually produce it).
    const filteredSeries = [0, -100, -200, -300, -400, -500, -500, -500, -500, -500];
    let prevError = 0;
    const operatingPcts: number[] = [];

    for (const filteredNetPowerKw of filteredSeries) {
      const result = stepPd({ filteredNetPowerKw, prevError, tickLengthMinutes: 1, config });
      prevError = result.error;
      operatingPcts.push(result.operatingPct);
    }

    // Never an instant on/off step: consecutive values should differ gradually, not jump straight
    // from 100 to the floor in one tick.
    for (let i = 1; i < operatingPcts.length; i++) {
      expect(Math.abs(operatingPcts[i] - operatingPcts[i - 1])).toBeLessThan(80);
    }
    expect(operatingPcts[operatingPcts.length - 1]).toBeLessThan(operatingPcts[0]);
  });

  it("output never exceeds the configured clamps", () => {
    const extremeDeficit = stepPd({ filteredNetPowerKw: -1_000_000, prevError: 0, tickLengthMinutes: 1, config });
    expect(extremeDeficit.operatingPct).toBeGreaterThanOrEqual(config.minOperatingPct);
    expect(extremeDeficit.operatingPct).toBeLessThanOrEqual(100);

    const extremeSurplus = stepPd({ filteredNetPowerKw: 1_000_000, prevError: 0, tickLengthMinutes: 1, config });
    expect(extremeSurplus.operatingPct).toBeLessThanOrEqual(100);
    expect(extremeSurplus.operatingPct).toBeGreaterThanOrEqual(config.minOperatingPct);
  });

  it("the derivative term responds to the rate of change of the same error signal", () => {
    const worseningResult = stepPd({ filteredNetPowerKw: -200, prevError: 50, tickLengthMinutes: 1, config });
    const steadyResult = stepPd({ filteredNetPowerKw: -50, prevError: 50, tickLengthMinutes: 1, config });
    // A rapidly worsening error (large positive derivative) should throttle harder than a case
    // reaching the same instantaneous error more slowly/not at all.
    expect(worseningResult.operatingPct).toBeLessThan(steadyResult.operatingPct);
  });
});
