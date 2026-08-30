import { describe, expect, it } from "vitest";
import { SimulationEngine } from "@/simulation/engine";

describe("scaffold", () => {
  it("tick() returns an IslandState-shaped object", () => {
    const engine = new SimulationEngine();
    const state = engine.tick();

    expect(state.time).toBeDefined();
    expect(state.generation.solar).toBeDefined();
    expect(state.generation.wind).toBeDefined();
    expect(state.generation.battery).toBeDefined();
    expect(state.demand.hospital).toBeDefined();
    expect(state.demand.desalination).toBeDefined();
    expect(state.demand.residential).toBeDefined();
    expect(state.demand.resort).toBeDefined();
    expect(state.water).toBeDefined();
    expect(state.balance).toBeDefined();
    expect(Array.isArray(state.activeEvents)).toBe(true);
    expect(typeof state.seed).toBe("number");
    expect(typeof state.version).toBe("number");
  });
});
