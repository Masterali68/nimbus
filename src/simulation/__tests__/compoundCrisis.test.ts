import { describe, expect, it } from "vitest";
import { EventsEngine } from "@/simulation/events/engine";
import { createRngStreams } from "@/simulation/rng";
import { DEFAULT_CONFIG } from "@/simulation/config";

function disabledSchedulerConfig(overrides: Partial<typeof DEFAULT_CONFIG.events> = {}) {
  return {
    ...DEFAULT_CONFIG.events,
    perTickProbability: {
      storm: 0,
      windDrop: 0,
      cloudCover: 0,
      demandSurge: 0,
      waterEmergency: 0,
      compoundCrisis: 0,
    },
    ...overrides,
  };
}

describe("compound crisis orchestration", () => {
  it("a below-threshold storm (not forced) does not spawn compound children", () => {
    const engine = new EventsEngine();
    const streams = createRngStreams(10);
    const config = disabledSchedulerConfig({ compoundSeverityThreshold: 2 }); // impossible to exceed (severity max is 1)

    engine.injectEvent("storm", 0, streams.eventsScheduler, streams.eventsCompound, config);
    const events = engine.getActiveEvents();
    expect(events.filter((e) => e.type !== "storm")).toHaveLength(0);
  });

  it("child severities are jittered from the parent storm's severity, not independently rolled", () => {
    const engine = new EventsEngine();
    const streams = createRngStreams(11);
    const config = disabledSchedulerConfig();

    engine.injectEvent("storm", 0, streams.eventsScheduler, streams.eventsCompound, config, {
      forceCompound: true,
    });
    const events = engine.getActiveEvents();
    const storm = events.find((e) => e.type === "storm")!;
    const children = events.filter((e) => e.parentEventId === storm.id);

    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      // Jitter range in storm.ts is 0.8x-1.1x the parent's severity, clamped to 1.
      expect(child.severity).toBeGreaterThanOrEqual(Math.min(1, storm.severity * 0.8) - 1e-9);
      expect(child.severity).toBeLessThanOrEqual(1);
    }
  });

  it("children's onset lags the storm's own (longer watch duration for causal plausibility)", () => {
    const engine = new EventsEngine();
    const streams = createRngStreams(12);
    const config = disabledSchedulerConfig();

    engine.injectEvent("storm", 0, streams.eventsScheduler, streams.eventsCompound, config, {
      forceCompound: true,
    });
    const events = engine.getActiveEvents();
    const storm = events.find((e) => e.type === "storm")!;
    const children = events.filter((e) => e.parentEventId === storm.id);

    for (const child of children) {
      expect(child.watchDurationTicks).toBeGreaterThan(storm.watchDurationTicks);
    }
  });

  it("the compoundCrisis bookkeeping event groups the storm and all its children, and contributes no physics", () => {
    const engine = new EventsEngine();
    const streams = createRngStreams(13);
    const config = disabledSchedulerConfig();

    engine.injectEvent("storm", 0, streams.eventsScheduler, streams.eventsCompound, config, {
      forceCompound: true,
    });

    const modifiersFromStepBeforeCompoundContribution = engine.step(1, streams, config);
    const events = engine.getActiveEvents();
    const storm = events.find((e) => e.type === "storm")!;
    const children = events.filter((e) => e.parentEventId === storm.id);
    const compound = events.find((e) => e.type === "compoundCrisis")!;

    expect(new Set(compound.childEventIds)).toEqual(new Set([storm.id, ...children.map((c) => c.id)]));
    // Removing compoundCrisis's own direct contribution should not change anything,
    // since it's designed to be physics-free — sanity check it doesn't blow up / contribute NaN.
    expect(Number.isFinite(modifiersFromStepBeforeCompoundContribution.cloudCoverDelta)).toBe(true);
  });

  it("manually injecting type 'compoundCrisis' directly forces a storm with a guaranteed compound spawn", () => {
    const engine = new EventsEngine();
    const streams = createRngStreams(14);
    const config = disabledSchedulerConfig({ compoundSeverityThreshold: 2 }); // would otherwise never trigger

    engine.injectEvent("compoundCrisis", 0, streams.eventsScheduler, streams.eventsCompound, config);
    const events = engine.getActiveEvents();
    expect(events.some((e) => e.type === "storm")).toBe(true);
    expect(events.some((e) => e.type === "compoundCrisis")).toBe(true);
    expect(events.some((e) => e.parentEventId !== null)).toBe(true);
  });
});
