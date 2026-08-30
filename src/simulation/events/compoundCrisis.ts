import type { EnvironmentalModifiers, SimEvent } from "../types";
import { emptyModifiers } from "./shared";

/**
 * Pure bookkeeping event: groups a storm and its correlated children
 * (windDrop/demandSurge, spawned via storm.ts's maybeSpawnStormChildren) so a
 * UI/history consumer can identify "this was one storm system" via
 * childEventIds. It mirrors the storm's own phase timings so it advances in
 * lockstep, but contributes no physics of its own — every physical effect
 * lives on the concrete child event types.
 */
export function createCompoundCrisisEvent(storm: SimEvent, children: SimEvent[], id: string): SimEvent {
  return {
    id,
    type: "compoundCrisis",
    phase: storm.phase,
    severity: storm.severity,
    startedAtTick: storm.startedAtTick,
    phaseStartedAtTick: storm.phaseStartedAtTick,
    watchDurationTicks: storm.watchDurationTicks,
    onsetDurationTicks: storm.onsetDurationTicks,
    peakDurationTicks: storm.peakDurationTicks,
    recoveryDurationTicks: storm.recoveryDurationTicks,
    parentEventId: null,
    childEventIds: [storm.id, ...children.map((c) => c.id)],
    metadata: {},
    source: storm.source,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature must match computeEffectForEvent's dispatch table
export function compoundCrisisEffect(event: SimEvent, tick: number): EnvironmentalModifiers {
  return emptyModifiers();
}
