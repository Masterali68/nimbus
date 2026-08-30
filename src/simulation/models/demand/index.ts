import type { ConsumerDemandState, DemandState, EnvironmentalModifiers, SimTime, SimulationConfig } from "../../types";
import type { RngStreams } from "../../rng";
import { stepHospital } from "./hospital";
import { stepDesalination } from "./desalination";
import { stepResidential } from "./residential";
import { stepResort } from "./resort";

function applySurge(consumer: ConsumerDemandState, surgeKw: number | undefined): void {
  if (!surgeKw) return;
  consumer.maxDemandKw += surgeKw;
  // operatingPct is still 100 at this pipeline stage — the active controller (a later pipeline
  // stage in engine.ts) decides operatingPct/state/currentDemandKw from here.
  consumer.currentDemandKw = consumer.maxDemandKw;
}

/**
 * Aggregates the four consumer models and applies event-driven demand surges to maxDemandKw.
 * Does NOT decide any throttling/shedding — that's the active controller's job, applied by
 * engine.ts as a later pipeline stage before constraints run. Every consumer starts each tick at
 * operatingPct = 100 / currentDemandKw = maxDemandKw; the controller mutates specific consumers
 * from there.
 */
export function stepDemand(
  time: SimTime,
  modifiers: EnvironmentalModifiers,
  streams: RngStreams,
  config: SimulationConfig
): DemandState {
  const hospital = stepHospital(time, streams.demandHospital, config.demand.hospital);
  const desalination = stepDesalination(time, streams.demandDesalination, config.demand.desalination);
  const residential = stepResidential(time, streams.demandResidential, config.demand.residential);
  const resort = stepResort(time, streams.demandResort, config.demand.resort);

  // Demand surges are additive and independent of each consumer's smooth baseline curve.
  // demandSurge.ts only ever targets residential/resort; waterEmergency.ts only ever targets
  // desalination — hospital is never a valid surge target by construction of those event files.
  applySurge(hospital, modifiers.demandSurgeKw.hospital);
  applySurge(desalination, modifiers.demandSurgeKw.desalination);
  applySurge(residential, modifiers.demandSurgeKw.residential);
  applySurge(resort, modifiers.demandSurgeKw.resort);

  // Re-derive desalination's water targets since a surge may have changed maxDemandKw.
  desalination.waterDemandM3PerHour = Math.min(
    desalination.maxDemandKw / config.demand.desalination.kwhPerM3,
    config.demand.desalination.capacityM3PerHour
  );
  desalination.waterOutputM3PerHour = desalination.waterDemandM3PerHour;

  const consumers = [hospital, desalination, residential, resort];
  const totalDemandKw = consumers.reduce((sum, c) => sum + c.currentDemandKw, 0);
  const totalMaxDemandKw = consumers.reduce((sum, c) => sum + c.maxDemandKw, 0);
  const totalSheddableKw = consumers
    .filter((c) => c.shedCapable)
    .reduce((sum, c) => sum + c.maxDemandKw, 0);

  return {
    hospital,
    desalination,
    residential,
    resort,
    totalDemandKw,
    totalMaxDemandKw,
    totalSheddableKw,
  };
}
