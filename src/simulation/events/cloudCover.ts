import type { EnvironmentalModifiers, SimEvent } from "../types";
import type { Rng } from "../rng";
import { createBaseEvent, emptyModifiers, getPhaseRampFactor, type PhaseDurations } from "./shared";

export const CLOUD_COVER_DURATIONS: PhaseDurations = { watch: 5, onset: 15, peak: 45, recovery: 25 };

// Softer than a storm's cloud-cover contribution (0.7) — frequent, mild modifier.
const UNIT_CLOUD_COVER_DELTA = 0.35;

export function createCloudCoverEvent(tick: number, rng: Rng, source: SimEvent["source"], id: string): SimEvent {
  const severity = 0.2 + rng() * 0.5;
  return createBaseEvent("cloudCover", tick, source, id, CLOUD_COVER_DURATIONS, severity);
}

export function cloudCoverEffect(event: SimEvent, tick: number): EnvironmentalModifiers {
  const ramp = getPhaseRampFactor(event, tick) * event.severity;
  const delta = emptyModifiers();
  delta.cloudCoverDelta = UNIT_CLOUD_COVER_DELTA * ramp;
  return delta;
}
