import { describe, expect, it } from "vitest";
import { stepSolar } from "@/simulation/models/solar";
import { mulberry32 } from "@/simulation/rng";
import { DEFAULT_CONFIG } from "@/simulation/config";
import type { EnvironmentalModifiers, SimTime } from "@/simulation/types";

function makeTime(hourOfDay: number, seasonalFactor = 0.5): SimTime {
  return {
    tick: Math.round(hourOfDay * 60),
    minutesElapsed: Math.round(hourOfDay * 60),
    dayIndex: 0,
    minuteOfDay: Math.round(hourOfDay * 60),
    hourOfDay,
    dayOfWeek: 3,
    isWeekend: false,
    seasonalFactor,
  };
}

const NEUTRAL_MODIFIERS: EnvironmentalModifiers = {
  cloudCoverDelta: 0,
  windMeanShiftMps: 0,
  windVolatilityMultiplier: 1,
  demandSurgeKw: {},
  desalinationOutageFraction: 0,
  waterContaminationFlag: false,
};

describe("stepSolar", () => {
  it("is (near-)zero at night", () => {
    const rng = mulberry32(1);
    const midnight = stepSolar(makeTime(0), NEUTRAL_MODIFIERS, 0.2, rng, DEFAULT_CONFIG.solar);
    const lateNight = stepSolar(makeTime(23), NEUTRAL_MODIFIERS, 0.2, rng, DEFAULT_CONFIG.solar);
    expect(midnight.state.outputKw).toBe(0);
    expect(lateNight.state.outputKw).toBe(0);
  });

  it("forms a bell curve peaking near solar noon", () => {
    const rng = mulberry32(2);
    const morning = stepSolar(makeTime(7), NEUTRAL_MODIFIERS, 0, rng, DEFAULT_CONFIG.solar);
    const noon = stepSolar(makeTime(12), NEUTRAL_MODIFIERS, 0, rng, DEFAULT_CONFIG.solar);
    const evening = stepSolar(makeTime(17), NEUTRAL_MODIFIERS, 0, rng, DEFAULT_CONFIG.solar);

    expect(noon.state.theoreticalClearSkyKw).toBeGreaterThan(morning.state.theoreticalClearSkyKw);
    expect(noon.state.theoreticalClearSkyKw).toBeGreaterThan(evening.state.theoreticalClearSkyKw);
  });

  it("never exceeds installed capacity and is never negative", () => {
    const rng = mulberry32(3);
    let baseline = 0.2;
    for (let h = 0; h < 24; h += 0.5) {
      const result = stepSolar(makeTime(h), NEUTRAL_MODIFIERS, baseline, rng, DEFAULT_CONFIG.solar);
      baseline = result.nextCloudBaselineFactor;
      expect(result.state.outputKw).toBeGreaterThanOrEqual(0);
      expect(result.state.outputKw).toBeLessThanOrEqual(DEFAULT_CONFIG.solar.installedCapacityKw);
    }
  });

  it("an additive cloudCoverDelta modifier reduces output relative to clear sky", () => {
    const rng1 = mulberry32(4);
    const rng2 = mulberry32(4);
    const clear = stepSolar(makeTime(12), NEUTRAL_MODIFIERS, 0, rng1, DEFAULT_CONFIG.solar);
    const cloudy = stepSolar(
      makeTime(12),
      { ...NEUTRAL_MODIFIERS, cloudCoverDelta: 0.5 },
      0,
      rng2,
      DEFAULT_CONFIG.solar
    );
    expect(cloudy.state.outputKw).toBeLessThan(clear.state.outputKw);
  });
});
