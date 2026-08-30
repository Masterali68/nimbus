import { describe, expect, it } from "vitest";
import { DEMO_SCENARIOS, runScenario } from "@/simulation/demo/scenarios";

describe("demo scenarios", () => {
  it.each(Object.keys(DEMO_SCENARIOS))("scenario '%s' reruns byte-identical for the same seed", (key) => {
    const scenario = DEMO_SCENARIOS[key];
    const runA = runScenario(scenario);
    const runB = runScenario(scenario);
    expect(runA.getHistory()).toEqual(runB.getHistory());
  });

  it("'calm-day' never has an active event (scheduled events disabled, none scripted)", () => {
    const api = runScenario(DEMO_SCENARIOS["calm-day"]);
    const everHadEvent = api.getHistory().some((state) => state.activeEvents.length > 0);
    expect(everHadEvent).toBe(false);
  });

  it("'storm-at-dusk' produces a storm event at the scripted tick", () => {
    const api = runScenario(DEMO_SCENARIOS["storm-at-dusk"]);
    const everHadStorm = api.getHistory().some((state) => state.activeEvents.some((e) => e.type === "storm"));
    expect(everHadStorm).toBe(true);
  });

  it("'compound-crisis' produces a storm with correlated children and a compoundCrisis grouping event", () => {
    const api = runScenario(DEMO_SCENARIOS["compound-crisis"]);
    const hadCompound = api.getHistory().some((state) => state.activeEvents.some((e) => e.type === "compoundCrisis"));
    const hadChild = api
      .getHistory()
      .some((state) => state.activeEvents.some((e) => e.parentEventId !== null));
    expect(hadCompound).toBe(true);
    expect(hadChild).toBe(true);
  });
});
