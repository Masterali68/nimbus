import type {
  IslandResource,
  IslandState,
  NimbusDecision,
  ReasonCode,
  ResourceAction,
  ResourceMap,
  ResourceState,
} from "../engine/types";
import {
  desalinationLimits,
  nimbusThresholds,
  residentialLimits,
  resortCooldown,
} from "@/lib/constants/thresholds";
import { calculateEnergyMetrics } from "@/lib/engine/calculateEnergyMetrics";
import { classifySeverity, detectTrajectory } from "@/lib/engine/detectTrajectory";
import { clamp, roundTo1 } from "@/lib/engine/resources";
import { buildExplanation } from "@/lib/explainability/decisionExplanation";

function patchResource(
  base: IslandResource,
  resourceState: ResourceState,
  operatingPct: number,
): IslandResource {
  return {
    ...base,
    state: resourceState,
    operatingPct,
    currentDemandKw: roundTo1(base.maxDemandKw * (operatingPct / 100)),
  };
}

export function runNimbusController(state: IslandState): NimbusDecision {
  const metrics = calculateEnergyMetrics({
    solarKw: state.solarKw,
    windKw: state.windKw,
    totalDemandKw: state.totalDemandKw,
    tick: state.tick,
    previousFilteredNetPowerKw: state.filteredNetPowerKw,
    previousVelocityKwS: state.velocityKwS,
    previousAccelerationKwS2: state.accelerationKwS2,
  });

  const trajectory = detectTrajectory({
    filteredNetPowerKw: metrics.filteredNetPowerKw,
    velocityKwS: metrics.velocityKwS,
    accelerationKwS2: metrics.accelerationKwS2,
    batteryPct: state.batteryPct,
    warmupComplete: metrics.warmupComplete,
  });

  const severity = classifySeverity({
    trajectory,
    velocityKwS: metrics.velocityKwS,
    batteryPct: state.batteryPct,
    filteredNetPowerKw: metrics.filteredNetPowerKw,
    warmupComplete: metrics.warmupComplete,
  });

  const { resources } = state;
  const resort = resources.resort;
  const residential = resources.residential;
  const desal = resources.desalination;

  const resortTriggered =
    severity === "CRITICAL" ||
    (severity === "WARNING" &&
      state.batteryPct <= nimbusThresholds.warningBatteryPct);

  const recovered =
    state.batteryPct >= resortCooldown.recoveryBatteryPct &&
    (trajectory === "STABLE" || trajectory === "IMPROVING");

  let resortPatch: IslandResource;
  let resortTransition: "shed" | "restore" | "cooldown" | "none" = "none";

  if (resort.state === "SHED" || resort.state === "COOLDOWN") {
    if (resortTriggered) {
      resortPatch = patchResource(resort, "SHED", 0);
      resortTransition = "shed";
    } else if (recovered) {
      if (resort.state === "SHED") {
        resortPatch = patchResource(resort, "COOLDOWN", 0);
        resortTransition = "cooldown";
      } else {
        resortPatch = patchResource(resort, "NORMAL", 100);
        resortTransition = "restore";
      }
    } else {
      resortPatch = patchResource(
        resort,
        resort.state === "SHED" ? "SHED" : "COOLDOWN",
        resort.state === "SHED" ? 0 : resort.operatingPct,
      );
      resortTransition = "none";
    }
  } else if (resortTriggered) {
    resortPatch = patchResource(resort, "SHED", 0);
    resortTransition = "shed";
  } else {
    resortPatch = patchResource(resort, "NORMAL", 100);
    resortTransition = "none";
  }

  const residentialCritical =
    severity === "CRITICAL" &&
    state.batteryPct <= nimbusThresholds.criticalBatteryPct;
  const residentialRecovered =
    state.batteryPct >= nimbusThresholds.watchBatteryPct &&
    (trajectory === "STABLE" || trajectory === "IMPROVING");

  const residentialNextPct = residentialCritical
    ? 100 - residentialLimits.reduceStepPct
    : 100;

  let residentialPatch: IslandResource;
  if (residentialCritical) {
    residentialPatch = patchResource(residential, "REDUCED", residentialNextPct);
  } else if (residentialRecovered) {
    residentialPatch = patchResource(residential, "NORMAL", 100);
  } else {
    residentialPatch = {
      ...residential,
      state: residential.state === "REDUCED" ? "REDUCED" : "NORMAL",
      currentDemandKw: roundTo1(
        residential.maxDemandKw * (residential.operatingPct / 100),
      ),
    };
  }

  const errorKw = Math.max(
    0,
    nimbusThresholds.targetSurplusKw - metrics.filteredNetPowerKw,
  );
  const errorRateKwS = Math.max(0, -metrics.velocityKwS);
  const curtailKw = clamp(
    desalinationLimits.curtailGainP * errorKw +
      desalinationLimits.curtailGainD * errorRateKwS,
    0,
    desalinationLimits.maxCurtailKw,
  );

  const desiredPct = clamp(
    100 * (1 - curtailKw / desal.maxDemandKw),
    desalinationLimits.minOperatingPct,
    desalinationLimits.maxOperatingPct,
  );

  const effectiveFloorPct = Math.max(
    desal.minimumOperatingPct,
    desalinationLimits.minOperatingPct,
  );
  const floorAppliedPct = Math.max(desiredPct, effectiveFloorPct);

  const rampBoundPct = clamp(
    floorAppliedPct,
    desal.operatingPct - desalinationLimits.maxStepPctPerTick,
    desal.operatingPct + desalinationLimits.maxStepPctPerTick,
  );

  const desalNextPct = Math.round(rampBoundPct);
  const desalAtFloor = desalNextPct <= desalinationLimits.minOperatingPct;

  const desalPatch: IslandResource = {
    ...desal,
    state: desalAtFloor ? "THROTTLED" : desalNextPct < 100 ? "THROTTLED" : "NORMAL",
    operatingPct: desalNextPct,
    currentDemandKw: roundTo1(desal.maxDemandKw * (desalNextPct / 100)),
  };

  const desalThrottledThisTick = desalNextPct < desal.operatingPct;
  const desalRestoredThisTick = desalNextPct > desal.operatingPct;
  const residentialReducedThisTick =
    residentialPatch.operatingPct < residential.operatingPct;

  const escalating = severity === "WARNING" || severity === "CRITICAL";
  const criticalReason: ReasonCode =
    trajectory === "CRITICAL" ? "CRITICAL_COLLAPSE" : "CRITICAL_BATTERY";

  let action: ResourceAction = "NONE";
  let reasonCode: ReasonCode = "OK_STABLE";

  if (escalating && resortTransition === "shed") {
    action = "SHED";
    reasonCode =
      severity === "CRITICAL" ? criticalReason : "WARNING_SHED_RESORT";
  } else if (escalating && residentialReducedThisTick) {
    action = "REDUCE";
    reasonCode =
      severity === "CRITICAL" ? criticalReason : "WARNING_REDUCE_RESIDENTIAL";
  } else if (escalating && desalThrottledThisTick) {
    action = "THROTTLE";
    reasonCode =
      severity === "CRITICAL"
        ? criticalReason
        : "WARNING_THROTTLE_DESALINATION";
  } else if (severity === "CRITICAL") {
    action = "NONE";
    reasonCode = criticalReason;
  } else if (resortTransition === "cooldown") {
    action = "COOLDOWN";
    reasonCode = "COOLDOWN_HOLD";
  } else if (resortTransition === "restore") {
    action = "RESTORE";
    reasonCode = "RECOVERY_RESTORE_RESORT";
  } else if (residentialPatch.operatingPct > residential.operatingPct) {
    action = "RESTORE";
    reasonCode = "RECOVERY_RESTORE_RESIDENTIAL";
  } else if (desalRestoredThisTick) {
    action = "RESTORE";
    reasonCode = "RECOVERY_RESTORE_DESALINATION";
  } else if (severity === "WATCH") {
    action = "NONE";
    reasonCode =
      trajectory === "DETERIORATING" ? "WATCH_TRAJECTORY" : "WATCH_BATTERY";
  } else {
    action = "NONE";
    reasonCode = trajectory === "IMPROVING" ? "OK_IMPROVING" : "OK_STABLE";
  }

  const resourceUpdates: Partial<ResourceMap> = {
    resort: resortPatch,
    residential: residentialPatch,
    desalination: desalPatch,
  };

  const { explanation, expectedOutcome } = buildExplanation({
    state,
    controllerMode: "nimbus",
    severity,
    trajectory,
    action,
    reasonCode,
    filteredNetPowerKw: metrics.filteredNetPowerKw,
    velocityKwS: metrics.velocityKwS,
    accelerationKwS2: metrics.accelerationKwS2,
  });

  return {
    timestampMs: state.timestampMs,
    controllerMode: "nimbus",
    severity,
    trajectory,
    action,
    reasonCode,
    explanation,
    expectedOutcome,
    resourceUpdates,
  };
}