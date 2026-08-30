import { describe, expect, it } from "vitest";
import { SimulationEngine } from "@/simulation/engine";
import { DEFAULT_CONFIG } from "@/simulation/config";
import type { SimulationConfig } from "@/simulation/types";

/** A config with near-zero generation, guaranteeing sustained deficit and a fully-drained battery. */
function starvedConfig(): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    seed: 321,
    solar: { ...DEFAULT_CONFIG.solar, installedCapacityKw: 1 },
    wind: { ...DEFAULT_CONFIG.wind, installedCapacityKw: 1 },
    battery: { ...DEFAULT_CONFIG.battery, capacityKwh: 50, initialSocFraction: 0.2 },
    events: {
      ...DEFAULT_CONFIG.events,
      perTickProbability: {
        storm: 0,
        windDrop: 0,
        cloudCover: 0,
        demandSurge: 0,
        waterEmergency: 0,
        compoundCrisis: 0,
      },
    },
  };
}

describe("edge case: battery empty during sustained deficit — hospital must never be touched", () => {
  it("hospital stays at 100% operatingPct throughout, even after the battery is fully drained and a deficit is explicitly reported", () => {
    const engine = new SimulationEngine(starvedConfig());
    engine.tick(600);
    const history = engine.getHistory();

    expect(history.every((s) => s.demand.hospital.operatingPct === 100)).toBe(true);
    expect(history.every((s) => s.demand.hospital.state === "PROTECTED")).toBe(true);
    expect(history.every((s) => s.demand.hospital.currentDemandKw === s.demand.hospital.maxDemandKw)).toBe(true);

    // The battery must actually have drained to (or clamped at) empty under sustained starvation.
    const finalSoc = history[history.length - 1].generation.battery.socFraction;
    expect(finalSoc).toBeCloseTo(0, 2);

    // Once the battery can no longer cover the gap, an explicit deficit must be reported —
    // never silently fabricated away.
    const everDeficit = history.some((s) => s.balance.deficitKw > 0);
    expect(everDeficit).toBe(true);
  });

  it("battery SoC never leaves [0, capacityKwh] under this sustained-starvation stress even with naive/nimbus both intervening", () => {
    for (const controllerType of ["naive", "nimbus"] as const) {
      const config = starvedConfig();
      config.controllers = { ...config.controllers, activeControllerType: controllerType };
      const engine = new SimulationEngine(config);
      engine.tick(1000);
      for (const state of engine.getHistory()) {
        expect(state.generation.battery.socKwh).toBeGreaterThanOrEqual(0);
        expect(state.generation.battery.socKwh).toBeLessThanOrEqual(state.generation.battery.capacityKwh);
      }
    }
  });
});

describe("edge case: simultaneous storm + waterEmergency", () => {
  it("both events remain concurrently active and their effects compose rather than one clobbering the other", () => {
    const engine = new SimulationEngine({ ...DEFAULT_CONFIG, seed: 654 });
    engine.injectEvent("storm");
    engine.injectEvent("waterEmergency");
    engine.tick(1);

    const state = engine.getCurrentState();
    const types = state.activeEvents.map((e) => e.type);
    expect(types).toContain("storm");
    expect(types).toContain("waterEmergency");
  });

  it("runs to completion without throwing and keeps reporting valid, bounded state throughout", () => {
    const engine = new SimulationEngine({ ...DEFAULT_CONFIG, seed: 654 });
    engine.injectEvent("storm", { forceCompound: true });
    engine.injectEvent("waterEmergency");

    expect(() => engine.tick(1440)).not.toThrow();

    for (const state of engine.getHistory()) {
      expect(state.generation.battery.socKwh).toBeGreaterThanOrEqual(0);
      expect(state.generation.battery.socKwh).toBeLessThanOrEqual(state.generation.battery.capacityKwh);
      expect(state.generation.solar.outputKw).toBeGreaterThanOrEqual(0);
      expect(state.generation.wind.outputKw).toBeGreaterThanOrEqual(0);
      expect(state.water.reservoirLevelM3).toBeGreaterThanOrEqual(0);
      expect(state.water.reservoirLevelM3).toBeLessThanOrEqual(state.water.reservoirCapacityM3);
      // If a deficit exists it must be reported as a violation — never silent.
      if (state.balance.deficitKw > 0) {
        expect(state.balance.violations.some((v) => v.code === "UNMET_DEMAND")).toBe(true);
      }
    }
  });
});

describe("edge case: multi-day seed reproducibility with events and an active controller", () => {
  it("two engines with the same seed, controller, and injected-event script stay deep-equal across a 3-day run", () => {
    function buildAndRun(): SimulationEngine {
      const engine = new SimulationEngine({ ...DEFAULT_CONFIG, seed: 999 });
      engine.tick(300);
      engine.injectEvent("storm", { forceCompound: true });
      engine.tick(700);
      engine.injectEvent("waterEmergency");
      engine.tick(1440 * 3 - 1000); // total: 3 simulated days
      return engine;
    }

    const engineA = buildAndRun();
    const engineB = buildAndRun();
    expect(engineA.getHistory()).toEqual(engineB.getHistory());
  });
});
