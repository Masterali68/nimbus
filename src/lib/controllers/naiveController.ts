import type {
  IslandResource,
  IslandState,
  NimbusDecision,
  ReasonCode,
  ResourceAction,
  ResourceMap,
} from "@/types/nimbus";
import { naiveThresholds } from "@/lib/constants/thresholds";
import {
  baseSeverityFromBattery,
  baseTrajectoryFromBattery,
} from "@/lib/engine/runController";
import { roundTo1 } from "@/lib/engine/resources";
import { buildExplanation } from "@/lib/explainability/decisionExplanation";

export function runNaiveController(state: IslandState): NimbusDecision {
  const { batteryPct, resources } = state;
  const resort = resources.resort;
  const residential = resources.residential;

  const severity = baseSeverityFromBattery(batteryPct);
  const trajectory = baseTrajectoryFromBattery(batteryPct);

  const resortOff: IslandResource = {
    ...resort,
    state: "SHED",
    operatingPct: 0,
    currentDemandKw: 0,
  };
  const resortOn: IslandResource = {
    ...resort,
    state: "NORMAL",
    operatingPct: 100,
    currentDemandKw: roundTo1(resort.maxDemandKw),
  };
  const residentialCut: IslandResource = {
    ...residential,
    state: "REDUCED",
    operatingPct: 80,
    currentDemandKw: roundTo1(residential.maxDemandKw * 0.8),
  };
  const residentialOn: IslandResource = {
    ...residential,
    state: "NORMAL",
    operatingPct: 100,
    currentDemandKw: roundTo1(residential.maxDemandKw),
  };

  let resourceUpdates: Partial<ResourceMap> = {};
  let action: ResourceAction = "NONE";
  let reasonCode: ReasonCode = "OK_STABLE";

  if (batteryPct < naiveThresholds.residentialReduceBatteryPct) {
    resourceUpdates = { resort: resortOff, residential: residentialCut };
    action = "REDUCE";
    reasonCode = "WARNING_REDUCE_RESIDENTIAL";
  } else if (batteryPct < naiveThresholds.resortShedBatteryPct) {
    resourceUpdates = { resort: resortOff };
    action = "SHED";
    reasonCode = "WARNING_SHED_RESORT";
  } else {
    resourceUpdates = { resort: resortOn, residential: residentialOn };
    action = "NONE";
    reasonCode = "OK_STABLE";
  }

  const { explanation, expectedOutcome } = buildExplanation({
    state,
    controllerMode: "naive",
    severity,
    trajectory,
    action,
    reasonCode,
    filteredNetPowerKw: state.netPowerKw,
    velocityKwS: 0,
    accelerationKwS2: 0,
  });

  return {
    timestampMs: state.timestampMs,
    controllerMode: "naive",
    severity,
    trajectory,
    action,
    reasonCode,
    explanation,
    expectedOutcome,
    resourceUpdates,
  };
}