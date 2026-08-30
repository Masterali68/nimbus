import { describe, expect, it } from "vitest";
import { SimulationEngine } from "@/simulation/engine";
import { DEFAULT_CONFIG } from "@/simulation/config";
import type { ControllerType, IslandState, SimulationConfig } from "@/simulation/types";

function runWithController(controllerType: ControllerType, ticks: number): SimulationEngine {
  const config: SimulationConfig = {
    ...DEFAULT_CONFIG,
    seed: 4242,
    controllers: { ...DEFAULT_CONFIG.controllers, activeControllerType: controllerType },
  };
  const engine = new SimulationEngine(config);
  engine.injectEvent("storm", { forceCompound: true });
  engine.tick(ticks);
  return engine;
}

function firstTickWhere(history: IslandState[], predicate: (s: IslandState) => boolean): number {
  const index = history.findIndex(predicate);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

describe("NaiveController", () => {
  it("never touches hospital", () => {
    const engine = runWithController("naive", 500);
    const everTouched = engine.getHistory().some((s) => s.demand.hospital.operatingPct !== 100);
    expect(everTouched).toBe(false);
  });

  it("is binary: resort/residential operatingPct is only ever 0 or 100, never an intermediate value", () => {
    const engine = runWithController("naive", 1440);
    for (const state of engine.getHistory()) {
      expect([0, 100]).toContain(state.demand.resort.operatingPct);
      expect([0, 100]).toContain(state.demand.residential.operatingPct);
    }
  });
});

describe("NimbusController", () => {
  it("never touches hospital", () => {
    const engine = runWithController("nimbus", 500);
    const everTouched = engine.getHistory().some((s) => s.demand.hospital.operatingPct !== 100);
    expect(everTouched).toBe(false);
  });

  it("throttles desalination smoothly (intermediate operatingPct values), unlike naive's binary approach", () => {
    const engine = runWithController("nimbus", 1440);
    const hasIntermediateValue = engine
      .getHistory()
      .some((s) => s.demand.desalination.operatingPct > 0 && s.demand.desalination.operatingPct < 100);
    expect(hasIntermediateValue).toBe(true);
  });

  it("residential reduction is a partial cut (a fixed reduced pct), never a full 0% shed", () => {
    const engine = runWithController("nimbus", 1440);
    for (const state of engine.getHistory()) {
      if (state.demand.residential.state === "REDUCED") {
        expect(state.demand.residential.operatingPct).toBeGreaterThan(0);
        expect(state.demand.residential.operatingPct).toBeLessThan(100);
      }
    }
  });

  it("respects the priority hierarchy: desalination throttling begins no later than residential reduction, which begins no later than resort shedding", () => {
    const engine = runWithController("nimbus", 1440);
    const history = engine.getHistory();
    const desalThrottleTick = firstTickWhere(history, (s) => s.demand.desalination.state === "THROTTLED");
    const residentialReduceTick = firstTickWhere(history, (s) => s.demand.residential.state === "REDUCED");
    const resortShedTick = firstTickWhere(history, (s) => s.demand.resort.state === "SHED");

    if (residentialReduceTick !== Number.POSITIVE_INFINITY) {
      expect(desalThrottleTick).toBeLessThanOrEqual(residentialReduceTick);
    }
    if (resortShedTick !== Number.POSITIVE_INFINITY) {
      expect(residentialReduceTick).toBeLessThanOrEqual(resortShedTick);
    }
  });

  it("produces latestDecisions with non-empty, plain-language reasonDetail whenever it intervenes", () => {
    const engine = runWithController("nimbus", 1440);
    const decisionTicks = engine.getHistory().filter((s) => s.latestDecisions.length > 0);
    expect(decisionTicks.length).toBeGreaterThan(0);
    for (const state of decisionTicks) {
      for (const decision of state.latestDecisions) {
        expect(decision.reasonDetail.length).toBeGreaterThan(0);
        expect(decision.reasonDetail.every((line) => line.length > 5)).toBe(true);
        expect(decision.reasonSummary.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("controller comparison (directional sanity check)", () => {
  it("naive's control policy is strictly binary while nimbus's is graduated, given an identical seed and storm", () => {
    const ticks = 1440;
    const naive = runWithController("naive", ticks);
    const nimbus = runWithController("nimbus", ticks);

    const naiveDesalValues = new Set(naive.getHistory().map((s) => s.demand.desalination.operatingPct));
    const nimbusDesalValues = new Set(nimbus.getHistory().map((s) => s.demand.desalination.operatingPct));

    // Naive never touches desalination at all (no proactive throttling stage) -> always 100%.
    expect(naiveDesalValues.size).toBe(1);
    expect(naiveDesalValues.has(100)).toBe(true);
    // Nimbus actually exercises its PD stage under the same conditions.
    expect(nimbusDesalValues.size).toBeGreaterThan(1);
  });

  it("nimbus's resort-shed threshold is stricter (lower SoC) than naive's, so nimbus tolerates more depletion before cutting the least-critical load", () => {
    expect(DEFAULT_CONFIG.controllers.nimbus.resortShedBelowSocPct).toBeLessThan(
      DEFAULT_CONFIG.controllers.naive.shedResortBelowSocPct
    );
  });
});
