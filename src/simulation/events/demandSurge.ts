import type { ConsumerType, EnvironmentalModifiers, SimEvent } from "../types";
import type { Rng } from "../rng";
import { createBaseEvent, emptyModifiers, getPhaseRampFactor, type PhaseDurations } from "./shared";

export const DEMAND_SURGE_DURATIONS: PhaseDurations = { watch: 5, onset: 10, peak: 40, recovery: 20 };

// Full-severity, full-ramp additive surge on the targeted consumer (kW).
const UNIT_SURGE_KW = 60;

const SURGE_TARGETS: readonly ConsumerType[] = ["resort", "residential"];

export function createDemandSurgeEvent(tick: number, rng: Rng, source: SimEvent["source"], id: string): SimEvent {
  const severity = 0.3 + rng() * 0.7;
  const consumer = SURGE_TARGETS[Math.floor(rng() * SURGE_TARGETS.length)];
  const event = createBaseEvent("demandSurge", tick, source, id, DEMAND_SURGE_DURATIONS, severity);
  event.metadata.consumer = consumer;
  return event;
}

/**
 * Correlated child spawned by a severe storm (heatwave/storm AC or heating demand).
 * `watchDurationTicks` is the full watch duration (storm's own watch duration plus a lag,
 * computed by storm.ts), so this child's onset begins strictly after the storm's own onset.
 */
export function createDemandSurgeChild(
  tick: number,
  severity: number,
  source: SimEvent["source"],
  id: string,
  parentEventId: string,
  watchDurationTicks: number,
  rng: Rng
): SimEvent {
  const durations: PhaseDurations = {
    ...DEMAND_SURGE_DURATIONS,
    watch: watchDurationTicks,
  };
  const consumer = SURGE_TARGETS[Math.floor(rng() * SURGE_TARGETS.length)];
  const event = createBaseEvent("demandSurge", tick, source, id, durations, severity);
  event.parentEventId = parentEventId;
  event.metadata.consumer = consumer;
  return event;
}

export function demandSurgeEffect(event: SimEvent, tick: number): EnvironmentalModifiers {
  const ramp = getPhaseRampFactor(event, tick) * event.severity;
  const delta = emptyModifiers();
  const consumer = event.metadata.consumer as ConsumerType | undefined;
  if (consumer) {
    delta.demandSurgeKw[consumer] = UNIT_SURGE_KW * ramp;
  }
  return delta;
}
