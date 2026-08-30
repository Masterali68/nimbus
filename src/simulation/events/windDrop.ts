import type { EnvironmentalModifiers, SimEvent } from "../types";
import type { Rng } from "../rng";
import { createBaseEvent, emptyModifiers, getPhaseRampFactor, type PhaseDurations } from "./shared";

export const WIND_DROP_DURATIONS: PhaseDurations = { watch: 10, onset: 10, peak: 60, recovery: 30 };

// Full-severity, full-ramp shift applied to the wind OU process's mean-reversion target.
const UNIT_WIND_MEAN_SHIFT_MPS = -6;

export function createWindDropEvent(tick: number, rng: Rng, source: SimEvent["source"], id: string): SimEvent {
  const severity = 0.4 + rng() * 0.6;
  return createBaseEvent("windDrop", tick, source, id, WIND_DROP_DURATIONS, severity);
}

/**
 * Correlated child spawned by a severe storm — severity is inherited (jittered), not
 * independently rolled. `watchDurationTicks` is the full watch duration (already computed
 * by storm.ts as the storm's own watch duration plus a lag), not this event's own normal
 * watch length, so the child's onset begins strictly after the storm's own onset.
 */
export function createWindDropChild(
  tick: number,
  severity: number,
  source: SimEvent["source"],
  id: string,
  parentEventId: string,
  watchDurationTicks: number
): SimEvent {
  const durations: PhaseDurations = { ...WIND_DROP_DURATIONS, watch: watchDurationTicks };
  const event = createBaseEvent("windDrop", tick, source, id, durations, severity);
  event.parentEventId = parentEventId;
  return event;
}

export function windDropEffect(event: SimEvent, tick: number): EnvironmentalModifiers {
  const ramp = getPhaseRampFactor(event, tick) * event.severity;
  const delta = emptyModifiers();
  delta.windMeanShiftMps = UNIT_WIND_MEAN_SHIFT_MPS * ramp;
  return delta;
}
