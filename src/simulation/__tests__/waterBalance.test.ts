import { describe, expect, it } from "vitest";
import { computeWaterBalance } from "@/simulation/constraints/waterBalance";
import type { DesalinationDemandState, WaterConfig } from "@/simulation/types";

const waterConfig: WaterConfig = { reservoirCapacityM3: 2000, initialReservoirLevelM3: 1000 };

function makeDesalination(overrides: Partial<DesalinationDemandState> = {}): DesalinationDemandState {
  return {
    currentDemandKw: 150,
    maxDemandKw: 150,
    minOperatingLevelKw: 30,
    criticalityScore: 90,
    continuouslyThrottleable: true,
    shedCapable: false,
    operatingPct: 100,
    state: "NORMAL",
    waterDemandM3PerHour: 40,
    waterOutputM3PerHour: 40,
    ...overrides,
  };
}

describe("computeWaterBalance", () => {
  it("output is bounded by plant capacity even if power is fully available", () => {
    const { water } = computeWaterBalance({
      desalination: makeDesalination({ waterOutputM3PerHour: 100 }),
      desalinationCapacityM3PerHour: 40,
      desalinationOutageFraction: 0,
      prevReservoirLevelM3: 1000,
      tickLengthMinutes: 1,
      config: waterConfig,
    });
    expect(water.desalinationOutputM3PerHour).toBeLessThanOrEqual(40);
  });

  it("output is reduced proportionally when the controller has throttled operatingPct", () => {
    const { water } = computeWaterBalance({
      desalination: makeDesalination({ operatingPct: 50, waterOutputM3PerHour: 40 }),
      desalinationCapacityM3PerHour: 40,
      desalinationOutageFraction: 0,
      prevReservoirLevelM3: 1000,
      tickLengthMinutes: 1,
      config: waterConfig,
    });
    expect(water.desalinationOutputM3PerHour).toBeCloseTo(20, 5); // 50% operatingPct -> 50% of output
  });

  it("an outage fraction reduces effective capacity", () => {
    const { water } = computeWaterBalance({
      desalination: makeDesalination(),
      desalinationCapacityM3PerHour: 40,
      desalinationOutageFraction: 0.5,
      prevReservoirLevelM3: 1000,
      tickLengthMinutes: 1,
      config: waterConfig,
    });
    expect(water.desalinationCapacityM3PerHour).toBeCloseTo(20, 5);
    expect(water.desalinationOutputM3PerHour).toBeLessThanOrEqual(20);
  });

  it("reservoir never exceeds capacity (overflow reported, not fabricated away silently)", () => {
    const { water, violations } = computeWaterBalance({
      desalination: makeDesalination({ waterDemandM3PerHour: 0, waterOutputM3PerHour: 500 }),
      desalinationCapacityM3PerHour: 500,
      desalinationOutageFraction: 0,
      prevReservoirLevelM3: 1990,
      tickLengthMinutes: 60, // 1 hour tick to make the overflow arithmetic simple
      config: waterConfig,
    });
    expect(water.reservoirLevelM3).toBeLessThanOrEqual(waterConfig.reservoirCapacityM3);
    expect(violations.some((v) => v.code === "WATER_CAPACITY_CLAMPED")).toBe(true);
  });

  it("reservoir never goes below zero; unmet demand is reported as an explicit deficit", () => {
    const { water, violations } = computeWaterBalance({
      desalination: makeDesalination({ waterOutputM3PerHour: 0, waterDemandM3PerHour: 100 }),
      desalinationCapacityM3PerHour: 40,
      desalinationOutageFraction: 1, // full outage
      prevReservoirLevelM3: 10,
      tickLengthMinutes: 60,
      config: waterConfig,
    });
    expect(water.reservoirLevelM3).toBeGreaterThanOrEqual(0);
    expect(water.deficitM3PerHour).toBeGreaterThan(0);
    expect(violations.some((v) => v.code === "WATER_CAPACITY_CLAMPED")).toBe(true);
  });
});
