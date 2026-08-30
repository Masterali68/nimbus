import { describe, expect, it } from "vitest";
import { stepWind } from "@/simulation/models/wind";
import { mulberry32 } from "@/simulation/rng";
import { DEFAULT_CONFIG } from "@/simulation/config";
import type { EnvironmentalModifiers } from "@/simulation/types";

const NEUTRAL_MODIFIERS: EnvironmentalModifiers = {
  cloudCoverDelta: 0,
  windMeanShiftMps: 0,
  windVolatilityMultiplier: 1,
  demandSurgeKw: {},
  desalinationOutageFraction: 0,
  waterContaminationFlag: false,
};

describe("stepWind", () => {
  it("produces zero output below cut-in speed", () => {
    const rng = mulberry32(1);
    const result = stepWind(1, { ...NEUTRAL_MODIFIERS, windMeanShiftMps: -100 }, rng, {
      ...DEFAULT_CONFIG.wind,
      ouSigma: 0, // isolate the below-cutin regime deterministically
    });
    expect(result.state.windSpeedMps).toBeLessThan(DEFAULT_CONFIG.wind.cutInMps);
    expect(result.state.outputKw).toBe(0);
    expect(result.state.turbineRegime).toBe("below-cutin");
  });

  it("produces zero output at/above cut-out speed", () => {
    const rng = mulberry32(2);
    // Force wind speed above cut-out by starting there with zero volatility/mean-shift pull.
    const result = stepWind(30, { ...NEUTRAL_MODIFIERS, windMeanShiftMps: 100 }, rng, {
      ...DEFAULT_CONFIG.wind,
      ouSigma: 0,
      ouTheta: 0,
    });
    expect(result.state.windSpeedMps).toBeGreaterThanOrEqual(DEFAULT_CONFIG.wind.cutOutMps);
    expect(result.state.outputKw).toBe(0);
    expect(result.state.turbineRegime).toBe("cutout");
  });

  it("ramps non-linearly (cubic) between cut-in and rated speed", () => {
    const rng = mulberry32(3);
    const config = { ...DEFAULT_CONFIG.wind, ouSigma: 0, ouTheta: 0 };

    const low = stepWind(config.cutInMps + 1, NEUTRAL_MODIFIERS, rng, config);
    const mid = stepWind(config.cutInMps + (config.ratedMps - config.cutInMps) / 2, NEUTRAL_MODIFIERS, rng, config);
    const high = stepWind(config.ratedMps - 0.5, NEUTRAL_MODIFIERS, rng, config);

    expect(low.state.outputKw).toBeGreaterThan(0);
    expect(mid.state.outputKw).toBeGreaterThan(low.state.outputKw);
    expect(high.state.outputKw).toBeGreaterThan(mid.state.outputKw);
    expect(high.state.outputKw).toBeLessThan(config.installedCapacityKw);
    expect(low.state.turbineRegime).toBe("ramping");

    // Non-linearity check: doubling the fractional distance from cut-in should
    // more than double output (cubic, not linear) for a fraction below 0.5.
    const quarterFraction = config.cutInMps + (config.ratedMps - config.cutInMps) * 0.25;
    const halfFraction = config.cutInMps + (config.ratedMps - config.cutInMps) * 0.5;
    const quarter = stepWind(quarterFraction, NEUTRAL_MODIFIERS, rng, config);
    const half = stepWind(halfFraction, NEUTRAL_MODIFIERS, rng, config);
    expect(half.state.outputKw).toBeGreaterThan(quarter.state.outputKw * 2);
  });

  it("produces rated (full capacity) output between rated and cut-out speed", () => {
    const rng = mulberry32(4);
    const config = { ...DEFAULT_CONFIG.wind, ouSigma: 0, ouTheta: 0 };
    const result = stepWind(config.ratedMps + 2, NEUTRAL_MODIFIERS, rng, config);
    expect(result.state.outputKw).toBe(config.installedCapacityKw);
    expect(result.state.turbineRegime).toBe("rated");
  });

  it("never goes negative and never exceeds installed capacity", () => {
    const rng = mulberry32(5);
    let speed = DEFAULT_CONFIG.wind.ouMeanMps;
    for (let i = 0; i < 2000; i++) {
      const result = stepWind(speed, NEUTRAL_MODIFIERS, rng, DEFAULT_CONFIG.wind);
      speed = result.nextWindSpeedMps;
      expect(result.state.windSpeedMps).toBeGreaterThanOrEqual(0);
      expect(result.state.outputKw).toBeGreaterThanOrEqual(0);
      expect(result.state.outputKw).toBeLessThanOrEqual(DEFAULT_CONFIG.wind.installedCapacityKw);
    }
  });
});
