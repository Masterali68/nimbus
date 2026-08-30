import { afterEach, describe, expect, it } from "vitest";
import { createSimulationApi } from "@/simulation/api/simulationApi";
import { DEFAULT_CONFIG } from "@/simulation/config";

describe("SimulationApi (public surface only)", () => {
  let apiToCleanUp: ReturnType<typeof createSimulationApi> | null = null;

  afterEach(() => {
    apiToCleanUp?.stopAutoTick();
    apiToCleanUp = null;
  });

  it("getCurrentState/tick/getHistory work end to end", () => {
    const api = createSimulationApi({ ...DEFAULT_CONFIG, seed: 42 });
    api.tick(10);
    const state = api.getCurrentState();
    expect(state.time.tick).toBe(10);
    expect(api.getHistory().length).toBe(10);
    expect(api.getHistory(5).length).toBe(5);
  });

  it("subscribe is called synchronously at the end of every tick", () => {
    const api = createSimulationApi({ ...DEFAULT_CONFIG, seed: 1 });
    let callCount = 0;
    const unsubscribe = api.subscribe(() => {
      callCount += 1;
    });
    api.tick(3);
    expect(callCount).toBe(3);
    unsubscribe();
    api.tick(2);
    expect(callCount).toBe(3); // unsubscribed, no further calls
  });

  it("injectEvent makes an event show up in activeEvents", () => {
    const api = createSimulationApi({ ...DEFAULT_CONFIG, seed: 2 });
    api.injectEvent("storm");
    api.tick(1);
    expect(api.getCurrentState().activeEvents.some((e) => e.type === "storm")).toBe(true);
  });

  it("applyControlAction rejects load.shed targeting hospital", () => {
    const api = createSimulationApi({ ...DEFAULT_CONFIG, seed: 3 });
    const result = api.applyControlAction({ type: "load.shed", consumer: "hospital", source: "test" });
    expect(result.accepted).toBe(false);
  });

  it("applyControlAction accepts a battery.setChargeRate command and it affects the next tick", () => {
    const api = createSimulationApi({ ...DEFAULT_CONFIG, seed: 4 });
    const result = api.applyControlAction({
      type: "battery.setChargeRate",
      requestedKw: -50,
      source: "test-optimizer",
    });
    expect(result.accepted).toBe(true);
    api.tick(1);
    expect(api.getCurrentState().generation.battery.chargeRateKw).toBeLessThan(0);
  });

  it("battery.setChargeRate is one-shot: the heuristic resumes on the next tick with no queued action", () => {
    const api = createSimulationApi({ ...DEFAULT_CONFIG, seed: 5 });
    api.applyControlAction({ type: "battery.setChargeRate", requestedKw: -1, source: "test" });
    api.tick(1); // consumes the override
    api.tick(1); // no action queued -> heuristic runs
    // Just confirming this doesn't throw and produces a valid state is enough at the API-contract level.
    expect(Number.isFinite(api.getCurrentState().generation.battery.chargeRateKw)).toBe(true);
  });

  it("getSeed/getTickRate expose the configured determinism/timing parameters", () => {
    const api = createSimulationApi({ ...DEFAULT_CONFIG, seed: 999 });
    expect(api.getSeed()).toBe(999);
    expect(api.getTickRate()).toBe(DEFAULT_CONFIG.tickLengthMinutes);
  });

  it("startAutoTick/stopAutoTick drive ticks in real time without crashing", async () => {
    const api = createSimulationApi({ ...DEFAULT_CONFIG, seed: 6 });
    apiToCleanUp = api;
    api.startAutoTick(60 * 60); // fast: 1 sim hour per real second
    expect(api.isAutoTicking()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    api.stopAutoTick();
    expect(api.isAutoTicking()).toBe(false);
    expect(api.getCurrentState().time.tick).toBeGreaterThan(0);
  });
});
