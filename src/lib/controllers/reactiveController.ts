import type {
  IslandResource,
  IslandState,
  NimbusDecision,
  ReasonCode,
  ResourceAction,
} from "@/types/nimbus";
import { reactiveThresholds } from "@/lib/constants/thresholds";
import {
  baseSeverityFromBattery,
  baseTrajectoryFromBattery,
} from "@/lib/engine/runController";
import { roundTo1 } from "@/lib/engine/resources";
import { buildExplanation } from "@/lib/explainability/decisionExplanation";

export function runReactiveController(state: IslandState): NimbusDecision {
  const { batteryPct, netPowerKw, resources } = state;
  const resort = resources.resort;
  const residential = resources.residential;
  const desal = resources.desalination;

  const batteryDeclining = state.batteryDischargeRateKw > 0;
  const deficit = netPowerKw < 0;
  const severeDeficit = netPowerKw <= reactiveThresholds.shedNetPowerKw;

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

  const resortOffline = resort.state === "SHED" || resort.state === "COOLDOWN";

  let resortPatch: IslandResource;
  if (
    batteryPct <= reactiveThresholds.resortShedBatteryPct &&
    (severeDeficit || batteryDeclining)
  ) {
    resortPatch = resortOff;
  } else if (
    batteryPct >= reactiveThresholds.resortRestoreBatteryPct &&
    netPowerKw >= reactiveThresholds.restoreNetPowerKw
  ) {
    resortPatch = resortOn;
  } else {
    resortPatch = resortOffline ? resortOff : resortOn;
  }

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

  const residentialReduced =
    residential.state === "REDUCED";
  let residentialPatch: IslandResource;
  if (
    batteryPct <= reactiveThresholds.residentialReduceBatteryPct &&
    (deficit || batteryDeclining)
  ) {
    residentialPatch = residentialCut;
  } else if (batteryPct >= reactiveThresholds.residentialRestoreBatteryPct) {
    residentialPatch = residentialOn;
  } else {
    residentialPatch = residentialReduced ? residentialCut : residentialOn;
  }

  const resortShed = resortPatch.state === "SHED";
  const residentialReducing = residentialPatch.state === "REDUCED";
  const restoredSomething =
    (!resortShed && resortOffline) ||
    (!residentialReducing && residentialReduced);

  let action: ResourceAction = "NONE";
  let reasonCode: ReasonCode = "OK_STABLE";

  if (resortShed) {
    action = "SHED";
    reasonCode = "WARNING_SHED_RESORT";
  } else if (residentialReducing) {
    action = "REDUCE";
    reasonCode = "WARNING_REDUCE_RESIDENTIAL";
  } else if (restoredSomething) {
    action = "RESTORE";
    reasonCode = "RECOVERY_RESTORE_RESORT";
  }

  const { explanation, expectedOutcome } = buildExplanation({
    state,
    controllerMode: "reactive",
    severity,
    trajectory,
    action,
    reasonCode,
    filteredNetPowerKw: netPowerKw,
    velocityKwS: 0,
    accelerationKwS2: 0,
  });

  return {
    timestampMs: state.timestampMs,
    controllerMode: "reactive",
    severity,
    trajectory,
    action,
    reasonCode,
    explanation,
    expectedOutcome,
    resourceUpdates: {
      resort: resortPatch,
      residential: residentialPatch,
      desalination: desal,
    },
  };
}