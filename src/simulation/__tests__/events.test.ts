import { describe, expect, it } from "vitest";
import { EventsEngine } from "@/simulation/events/engine";
import { createRngStreams } from "@/simulation/rng";
import { DEFAULT_CONFIG } from "@/simulation/config";
import type { EventType } from "@/simulation/types";

function disabledSchedulerConfig() {
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
  };
}

const EVENT_TYPES: EventType[] = ["storm", "windDrop", "cloudCover", "demandSurge", "waterEmergency"];

describe("EventsEngine", () => {
  it.each(EVENT_TYPES)("injectEvent(%s) creates an active event that progresses through phases and resolves", (type) => {
    const engine = new EventsEngine();
    const streams = createRngStreams(1);
    const config = disabledSchedulerConfig();
    let tick = 0;

    engine.injectEvent(type, tick, streams.eventsScheduler, streams.eventsCompound, config);
    expect(engine.getActiveEvents().some((e) => e.type === type)).toBe(true);
    const event = engine.getActiveEvents().find((e) => e.type === type)!;
    expect(event.phase).toBe("watch");

    const totalTicks =
      event.watchDurationTicks + event.onsetDurationTicks + event.peakDurationTicks + event.recoveryDurationTicks + 5;

    const phasesSeen = new Set<string>();
    for (let i = 0; i < totalTicks; i++) {
      tick += 1;
      engine.step(tick, streams, config);
      const current = engine.getActiveEvents().find((e) => e.type === type);
      if (current) phasesSeen.add(current.phase);
    }

    expect(engine.getActiveEvents().some((e) => e.type === type)).toBe(false); // resolved and removed
    expect(phasesSeen.has("onset")).toBe(true);
    expect(phasesSeen.has("peak")).toBe(true);
    expect(phasesSeen.has("recovery")).toBe(true);
  });

  it("ramps effect magnitude gradually during onset rather than jumping instantly", () => {
    const engine = new EventsEngine();
    const streams = createRngStreams(2);
    const config = disabledSchedulerConfig();
    let tick = 0;

    engine.injectEvent("storm", tick, streams.eventsScheduler, streams.eventsCompound, config);
    const storm = engine.getActiveEvents().find((e) => e.type === "storm")!;

    // Fast-forward to just past the watch phase, into onset.
    const modifiersDuringWatch = engine.step(++tick, streams, config);
    for (let i = 1; i < storm.watchDurationTicks; i++) {
      tick += 1;
      engine.step(tick, streams, config);
    }
    expect(modifiersDuringWatch.cloudCoverDelta).toBe(0); // no physics change during watch

    const onsetSamples: number[] = [];
    for (let i = 0; i < storm.onsetDurationTicks; i++) {
      tick += 1;
      const modifiers = engine.step(tick, streams, config);
      onsetSamples.push(modifiers.cloudCoverDelta);
    }

    // Monotonically non-decreasing ramp, not a single jump to full value.
    for (let i = 1; i < onsetSamples.length; i++) {
      expect(onsetSamples[i]).toBeGreaterThanOrEqual(onsetSamples[i - 1] - 1e-9);
    }
    expect(onsetSamples[0]).toBeLessThan(onsetSamples[onsetSamples.length - 1]);
  });

  it("a forced-compound storm spawns correlated children with a shared parentEventId", () => {
    const engine = new EventsEngine();
    const streams = createRngStreams(3);
    const config = disabledSchedulerConfig();

    engine.injectEvent("storm", 0, streams.eventsScheduler, streams.eventsCompound, config, {
      forceCompound: true,
    });

    const events = engine.getActiveEvents();
    const storm = events.find((e) => e.type === "storm")!;
    const children = events.filter((e) => e.parentEventId === storm.id);
    const compound = events.find((e) => e.type === "compoundCrisis")!;

    expect(children.length).toBeGreaterThan(0);
    expect(compound).toBeDefined();
    expect(compound.childEventIds).toContain(storm.id);
    for (const child of children) {
      expect(compound.childEventIds).toContain(child.id);
      expect(child.severity).toBeGreaterThan(0);
    }
  });
});
