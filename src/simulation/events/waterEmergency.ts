import type { EnvironmentalModifiers, SimEvent } from "../types";
import type { Rng } from "../rng";
import { createBaseEvent, emptyModifiers, getPhaseRampFactor, type PhaseDurations } from "./shared";

export const WATER_EMERGENCY_DURATIONS: PhaseDurations = { watch: 15, onset: 15, peak: 90, recovery: 45 };

const UNIT_OUTAGE_FRACTION = 0.8;
const UNIT_CONTAMINATION_SURGE_KW = 30;

export function createWaterEmergencyEvent(
  tick: number,
  rng: Rng,
  source: SimEvent["source"],
  id: string
): SimEvent {
  const severity = 0.3 + rng() * 0.7;
  const mode = rng() < 0.5 ? "outage" : "contamination";
  const event = createBaseEvent("waterEmergency", tick, source, id, WATER_EMERGENCY_DURATIONS, severity);
  event.metadata.mode = mode;
  return event;
}

export function waterEmergencyEffect(event: SimEvent, tick: number): EnvironmentalModifiers {
  const ramp = getPhaseRampFactor(event, tick) * event.severity;
  const delta = emptyModifiers();
  const mode = event.metadata.mode as "outage" | "contamination" | undefined;

  if (mode === "outage") {
    delta.desalinationOutageFraction = UNIT_OUTAGE_FRACTION * ramp;
  } else if (mode === "contamination") {
    delta.waterContaminationFlag = ramp > 0.1;
    delta.demandSurgeKw.desalination = UNIT_CONTAMINATION_SURGE_KW * ramp;
  }

  return delta;
}
