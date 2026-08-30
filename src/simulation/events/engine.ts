import type { ConsumerType, EnvironmentalModifiers, EventEngineConfig, EventType, SimEvent } from "../types";
import type { Rng, RngStreams } from "../rng";
import { clamp, emptyModifiers } from "./shared";
import { createStormEvent, maybeSpawnStormChildren, stormEffect } from "./storm";
import { createWindDropEvent, windDropEffect } from "./windDrop";
import { createCloudCoverEvent, cloudCoverEffect } from "./cloudCover";
import { createDemandSurgeEvent, demandSurgeEffect } from "./demandSurge";
import { createWaterEmergencyEvent, waterEmergencyEffect } from "./waterEmergency";
import { createCompoundCrisisEvent, compoundCrisisEffect } from "./compoundCrisis";

const SCHEDULABLE_TYPES: readonly EventType[] = [
  "storm",
  "windDrop",
  "cloudCover",
  "demandSurge",
  "waterEmergency",
];

export interface InjectEventParams {
  /** For "storm"/"compoundCrisis": bypass the severity-threshold check and always spawn correlated children. */
  forceCompound?: boolean;
}

function computeEffectForEvent(event: SimEvent, tick: number): EnvironmentalModifiers {
  switch (event.type) {
    case "storm":
      return stormEffect(event, tick);
    case "windDrop":
      return windDropEffect(event, tick);
    case "cloudCover":
      return cloudCoverEffect(event, tick);
    case "demandSurge":
      return demandSurgeEffect(event, tick);
    case "waterEmergency":
      return waterEmergencyEffect(event, tick);
    case "compoundCrisis":
      return compoundCrisisEffect(event, tick);
  }
}

/**
 * Scheduler + phase-advancement + modifier-aggregation orchestrator.
 * Rolls per-tick trigger probabilities for scheduled events, advances every
 * active event's watch->onset->peak->recovery->resolved phase, and combines
 * all currently-active events' effects into one EnvironmentalModifiers per
 * tick (additive fields sum, windVolatilityMultiplier's "extra" sums into
 * 1+sum, desalinationOutageFraction takes the max, contamination flags OR).
 */
export class EventsEngine {
  private activeEvents: SimEvent[] = [];
  private seq = 0;

  private nextId(): string {
    return `evt-${this.seq++}`;
  }

  getActiveEvents(): SimEvent[] {
    return this.activeEvents;
  }

  injectEvent(
    type: EventType,
    tick: number,
    rng: Rng,
    compoundRng: Rng,
    config: EventEngineConfig,
    params?: InjectEventParams
  ): void {
    this.spawn(type, tick, rng, compoundRng, config, "manual", params);
  }

  step(tick: number, streams: RngStreams, config: EventEngineConfig): EnvironmentalModifiers {
    for (const event of this.activeEvents) {
      this.advancePhase(event, tick);
    }
    this.activeEvents = this.activeEvents.filter((e) => e.phase !== "resolved");

    for (const type of SCHEDULABLE_TYPES) {
      const alreadyActive = this.activeEvents.some((e) => e.type === type);
      if (alreadyActive) continue;
      if (streams.eventsScheduler() < config.perTickProbability[type]) {
        this.spawn(type, tick, streams.eventsScheduler, streams.eventsCompound, config, "scheduled");
      }
    }

    return this.aggregateModifiers(tick);
  }

  private spawn(
    type: EventType,
    tick: number,
    rng: Rng,
    compoundRng: Rng,
    config: EventEngineConfig,
    source: SimEvent["source"],
    params?: InjectEventParams
  ): void {
    switch (type) {
      case "storm": {
        const storm = createStormEvent(tick, rng, source, this.nextId());
        this.activeEvents.push(storm);
        // forceCompound (from a manual injectEvent) bypasses the severity
        // threshold entirely; otherwise use the configured threshold so
        // compound crises stay rare-but-real for scheduled/probabilistic storms.
        const effectiveThreshold = params?.forceCompound ? -1 : config.compoundSeverityThreshold;
        this.trySpawnCompound(storm, effectiveThreshold, compoundRng);
        break;
      }
      case "windDrop":
        this.activeEvents.push(createWindDropEvent(tick, rng, source, this.nextId()));
        break;
      case "cloudCover":
        this.activeEvents.push(createCloudCoverEvent(tick, rng, source, this.nextId()));
        break;
      case "demandSurge":
        this.activeEvents.push(createDemandSurgeEvent(tick, rng, source, this.nextId()));
        break;
      case "waterEmergency":
        this.activeEvents.push(createWaterEmergencyEvent(tick, rng, source, this.nextId()));
        break;
      case "compoundCrisis":
        // A direct "compoundCrisis" injection means: force a storm with a guaranteed compound spawn.
        this.spawn("storm", tick, rng, compoundRng, config, source, { forceCompound: true });
        break;
    }
  }

  private trySpawnCompound(storm: SimEvent, threshold: number, compoundRng: Rng): void {
    const { children } = maybeSpawnStormChildren(storm, threshold, compoundRng, () => this.nextId());
    if (children.length === 0) return;
    this.activeEvents.push(...children);
    this.activeEvents.push(createCompoundCrisisEvent(storm, children, this.nextId()));
  }

  private advancePhase(event: SimEvent, tick: number): void {
    const ticksIntoPhase = tick - event.phaseStartedAtTick;
    switch (event.phase) {
      case "watch":
        if (ticksIntoPhase >= event.watchDurationTicks) {
          event.phase = "onset";
          event.phaseStartedAtTick = tick;
        }
        break;
      case "onset":
        if (ticksIntoPhase >= event.onsetDurationTicks) {
          event.phase = "peak";
          event.phaseStartedAtTick = tick;
        }
        break;
      case "peak":
        if (ticksIntoPhase >= event.peakDurationTicks) {
          event.phase = "recovery";
          event.phaseStartedAtTick = tick;
        }
        break;
      case "recovery":
        if (ticksIntoPhase >= event.recoveryDurationTicks) {
          event.phase = "resolved";
          event.phaseStartedAtTick = tick;
        }
        break;
      case "resolved":
        break;
    }
  }

  private aggregateModifiers(tick: number): EnvironmentalModifiers {
    const agg = emptyModifiers();
    let windVolExtraSum = 0;
    let outageMax = 0;
    let contaminationAny = false;

    for (const event of this.activeEvents) {
      const delta = computeEffectForEvent(event, tick);
      agg.cloudCoverDelta += delta.cloudCoverDelta;
      agg.windMeanShiftMps += delta.windMeanShiftMps;
      windVolExtraSum += delta.windVolatilityMultiplier;

      for (const key of Object.keys(delta.demandSurgeKw) as ConsumerType[]) {
        agg.demandSurgeKw[key] = (agg.demandSurgeKw[key] ?? 0) + (delta.demandSurgeKw[key] ?? 0);
      }

      outageMax = Math.max(outageMax, delta.desalinationOutageFraction);
      contaminationAny = contaminationAny || delta.waterContaminationFlag;
    }

    agg.windVolatilityMultiplier = 1 + windVolExtraSum;
    agg.desalinationOutageFraction = outageMax;
    agg.waterContaminationFlag = contaminationAny;
    agg.cloudCoverDelta = clamp(agg.cloudCoverDelta, 0, 1);

    return agg;
  }
}
