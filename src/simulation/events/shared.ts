import type { EnvironmentalModifiers, EventType, SimEvent } from "../types";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function smoothstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

export interface PhaseDurations {
  watch: number;
  onset: number;
  peak: number;
  recovery: number;
}

export function createBaseEvent(
  type: EventType,
  tick: number,
  source: SimEvent["source"],
  id: string,
  durations: PhaseDurations,
  severity: number
): SimEvent {
  return {
    id,
    type,
    phase: "watch",
    severity,
    startedAtTick: tick,
    phaseStartedAtTick: tick,
    watchDurationTicks: durations.watch,
    onsetDurationTicks: durations.onset,
    peakDurationTicks: durations.peak,
    recoveryDurationTicks: durations.recovery,
    parentEventId: null,
    childEventIds: [],
    metadata: {},
    source,
  };
}

/**
 * 0 during watch/resolved, smoothstep ramp 0->1 during onset, 1 during peak,
 * smoothstep ramp 1->0 during recovery. Implements "story arc, not boolean flip."
 */
export function getPhaseRampFactor(event: SimEvent, tick: number): number {
  const ticksIntoPhase = tick - event.phaseStartedAtTick;
  switch (event.phase) {
    case "watch":
      return 0;
    case "onset":
      return smoothstep(ticksIntoPhase / Math.max(1, event.onsetDurationTicks));
    case "peak":
      return 1;
    case "recovery":
      return smoothstep(1 - ticksIntoPhase / Math.max(1, event.recoveryDurationTicks));
    case "resolved":
      return 0;
  }
}

export function emptyModifiers(): EnvironmentalModifiers {
  return {
    cloudCoverDelta: 0,
    windMeanShiftMps: 0,
    windVolatilityMultiplier: 0,
    demandSurgeKw: {},
    desalinationOutageFraction: 0,
    waterContaminationFlag: false,
  };
}
