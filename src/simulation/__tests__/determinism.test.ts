import { describe, expect, it } from "vitest";
import { SimulationEngine } from "@/simulation/engine";
import { DEFAULT_CONFIG } from "@/simulation/config";

describe("determinism", () => {
  it("same seed produces identical tick sequences twice in a row", () => {
    const engineA = new SimulationEngine({ ...DEFAULT_CONFIG, seed: 12345 });
    const engineB = new SimulationEngine({ ...DEFAULT_CONFIG, seed: 12345 });

    engineA.tick(500);
    engineB.tick(500);

    expect(engineA.getHistory()).toEqual(engineB.getHistory());
  });

  it("same seed remains identical across a full simulated day", () => {
    const engineA = new SimulationEngine({ ...DEFAULT_CONFIG, seed: 777 });
    const engineB = new SimulationEngine({ ...DEFAULT_CONFIG, seed: 777 });

    engineA.tick(1440);
    engineB.tick(1440);

    expect(engineA.getHistory()).toEqual(engineB.getHistory());
  });

  it("different seeds diverge", () => {
    const engineA = new SimulationEngine({ ...DEFAULT_CONFIG, seed: 1 });
    const engineB = new SimulationEngine({ ...DEFAULT_CONFIG, seed: 2 });

    engineA.tick(200);
    engineB.tick(200);

    expect(engineA.getCurrentState()).not.toEqual(engineB.getCurrentState());
  });

  it("determinism holds across injected events", () => {
    const engineA = new SimulationEngine({ ...DEFAULT_CONFIG, seed: 55 });
    const engineB = new SimulationEngine({ ...DEFAULT_CONFIG, seed: 55 });

    engineA.tick(100);
    engineA.injectEvent("storm", { forceCompound: true });
    engineA.tick(200);

    engineB.tick(100);
    engineB.injectEvent("storm", { forceCompound: true });
    engineB.tick(200);

    expect(engineA.getHistory()).toEqual(engineB.getHistory());
  });
});
