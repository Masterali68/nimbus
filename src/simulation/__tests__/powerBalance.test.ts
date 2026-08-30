import { describe, expect, it } from "vitest";
import { computePowerBalance } from "@/simulation/constraints/powerBalance";
import type { DemandState } from "@/simulation/types";

function makeDemand(overrides: Partial<DemandState> = {}): DemandState {
  return {
    hospital: {
      currentDemandKw: 120,
      maxDemandKw: 120,
      minOperatingLevelKw: 120,
      criticalityScore: 100,
      continuouslyThrottleable: false,
      shedCapable: false,
      operatingPct: 100,
      state: "PROTECTED",
    },
    desalination: {
      currentDemandKw: 100,
      maxDemandKw: 100,
      minOperatingLevelKw: 20,
      criticalityScore: 90,
      continuouslyThrottleable: true,
      shedCapable: false,
      operatingPct: 100,
      state: "NORMAL",
      waterDemandM3PerHour: 30,
      waterOutputM3PerHour: 30,
    },
    residential: {
      currentDemandKw: 150,
      maxDemandKw: 150,
      minOperatingLevelKw: 60,
      criticalityScore: 70,
      continuouslyThrottleable: true,
      shedCapable: true,
      operatingPct: 100,
      state: "NORMAL",
    },
    resort: {
      currentDemandKw: 80,
      maxDemandKw: 80,
      minOperatingLevelKw: 0,
      criticalityScore: 20,
      continuouslyThrottleable: true,
      shedCapable: true,
      operatingPct: 100,
      state: "NORMAL",
    },
    totalDemandKw: 450,
    totalMaxDemandKw: 450,
    totalSheddableKw: 330,
    ...overrides,
  };
}

describe("computePowerBalance", () => {
  it("reports surplus and no deficit/violations when generation exceeds demand", () => {
    const balance = computePowerBalance({
      solarOutputKw: 500,
      windOutputKw: 100,
      batteryChargeRateKw: 100, // charging (draws power)
      demand: makeDemand(),
    });
    expect(balance.surplusKw).toBeGreaterThan(0);
    expect(balance.deficitKw).toBe(0);
    expect(balance.sheddedKw).toBe(0);
  });

  it("measures sheddedKw as the gap between totalMaxDemandKw and totalDemandKw, without deciding any shedding itself", () => {
    const demand = makeDemand({
      residential: {
        currentDemandKw: 105, // already reduced to 70% by a controller upstream
        maxDemandKw: 150,
        minOperatingLevelKw: 60,
        criticalityScore: 70,
        continuouslyThrottleable: true,
        shedCapable: true,
        operatingPct: 70,
        state: "REDUCED",
      },
      totalDemandKw: 405, // 120 + 100 + 105 + 80
      totalMaxDemandKw: 450,
    });
    const balance = computePowerBalance({
      solarOutputKw: 500,
      windOutputKw: 100,
      batteryChargeRateKw: 0,
      demand,
    });
    expect(balance.sheddedKw).toBeCloseTo(45, 5);
    expect(balance.totalDemandKw).toBeCloseTo(405, 5);
  });

  it("reports an explicit, non-fabricated deficit when generation and battery discharge are insufficient", () => {
    const balance = computePowerBalance({
      solarOutputKw: 0,
      windOutputKw: 0,
      batteryChargeRateKw: 0,
      demand: makeDemand(),
    });
    expect(balance.deficitKw).toBeCloseTo(450, 5);
    expect(balance.violations.some((v) => v.code === "UNMET_DEMAND")).toBe(true);
  });

  it("never silently clips a deficit to zero", () => {
    const balance = computePowerBalance({
      solarOutputKw: 50,
      windOutputKw: 0,
      batteryChargeRateKw: 0,
      demand: makeDemand(),
    });
    expect(balance.deficitKw).toBeCloseTo(400, 5);
  });
});
