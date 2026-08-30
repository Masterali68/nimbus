import type { EnvironmentalModifiers, SimEvent } from "../types";
import type { Rng } from "../rng";
import { createBaseEvent, emptyModifiers, getPhaseRampFactor, type PhaseDurations } from "./shared";
import { createWindDropChild } from "./windDrop";
import { createDemandSurgeChild } from "./demandSurge";

export const STORM_DURATIONS: PhaseDurations = { watch: 30, onset: 20, peak: 60, recovery: 40 };

// Storm's own direct effect, at full ramp and severity 1: heavy cloud cover
// plus gusty wind volatility. A severe storm (severity above the configured
// compound threshold) additionally spawns correlated windDrop/demandSurge
// children (see triggerStorm) and a compoundCrisis bookkeeping event —
// the wind dying down afterward and AC/heating demand are distinct,
// causally-linked phenomena, not storm's own instantaneous effect.
const UNIT_CLOUD_COVER_DELTA = 0.7;
const UNIT_WIND_VOLATILITY_EXTRA = 1.0;

export function createStormEvent(tick: number, rng: Rng, source: SimEvent["source"], id: string): SimEvent {
  const severity = 0.3 + rng() * 0.7;
  return createBaseEvent("storm", tick, source, id, STORM_DURATIONS, severity);
}

export function stormEffect(event: SimEvent, tick: number): EnvironmentalModifiers {
  const ramp = getPhaseRampFactor(event, tick) * event.severity;
  const delta = emptyModifiers();
  delta.cloudCoverDelta = UNIT_CLOUD_COVER_DELTA * ramp;
  delta.windVolatilityMultiplier = UNIT_WIND_VOLATILITY_EXTRA * ramp;
  return delta;
}

export interface CompoundSpawnResult {
  children: SimEvent[];
}

/**
 * Correlated compound spawning: severity is inherited (jittered) from the
 * storm rather than independently rolled, and children's onset lags the
 * storm's own (via a longer watch duration) for causal plausibility.
 */
export function maybeSpawnStormChildren(
  storm: SimEvent,
  compoundSeverityThreshold: number,
  rng: Rng,
  nextId: () => string
): CompoundSpawnResult {
  if (storm.severity < compoundSeverityThreshold) return { children: [] };

  const lagTicks = 5 + Math.floor(rng() * 10);
  const jitter = 0.8 + rng() * 0.3;
  const childSeverity = Math.min(1, storm.severity * jitter);
  // Children start their "watch" at the same tick as the storm, so to make
  // their onset begin strictly AFTER the storm's own onset, their full watch
  // duration must exceed the storm's own watch duration by the lag amount —
  // not just their own (shorter) normal watch duration plus a small lag.
  const childWatchDurationTicks = storm.watchDurationTicks + lagTicks;

  const children: SimEvent[] = [
    createWindDropChild(
      storm.startedAtTick,
      childSeverity,
      storm.source,
      nextId(),
      storm.id,
      childWatchDurationTicks
    ),
  ];

  if (rng() < 0.7) {
    children.push(
      createDemandSurgeChild(
        storm.startedAtTick,
        childSeverity,
        storm.source,
        nextId(),
        storm.id,
        childWatchDurationTicks,
        rng
      )
    );
  }

  return { children };
}
