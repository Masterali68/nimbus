import type { IslandState, NimbusDecision, ResourceAction, Severity, Trajectory } from "@/types/nimbus";
import { nimbusThresholds } from "@/lib/constants/thresholds";
import { runNaiveController } from "@/lib/controllers/naiveController";
import { runNimbusController } from "@/lib/controllers/nimbusController";
import { runReactiveController } from "@/lib/controllers/reactiveController";
import { updateResource } from "@/lib/engine/resources";

export function baseSeverityFromBattery(batteryPct: number): Severity {
  if (batteryPct >= nimbusThresholds.watchBatteryPct) return "STABLE";
  if (batteryPct >= nimbusThresholds.warningBatteryPct) return "WATCH";
  if (batteryPct >= nimbusThresholds.criticalBatteryPct) return "WARNING";
  return "CRITICAL";
}

export function baseTrajectoryFromBattery(batteryPct: number): Trajectory {
  return batteryPct <= nimbusThresholds.criticalBatteryPct ? "CRITICAL" : "STABLE";
}

export function protectHospital(
  decision: NimbusDecision,
  state: IslandState,
): NimbusDecision {
  const hospital = state.resources.hospital;
  return {
    ...decision,
    resourceUpdates: updateResource(decision.resourceUpdates, "hospital", {
      state: "PROTECTED",
      operatingPct: 100,
      currentDemandKw: hospital.maxDemandKw,
    }),
  };
}

export function enforceSafety(decision: NimbusDecision): NimbusDecision {
  const hospitalPatch = decision.resourceUpdates.hospital;
  if (hospitalPatch && hospitalPatch.state === "SHED") {
    return {
      ...decision,
      resourceUpdates: updateResource(decision.resourceUpdates, "hospital", {
        state: "PROTECTED",
        operatingPct: 100,
      }),
    };
  }
  return decision;
}

export function runController(state: IslandState): NimbusDecision {
  let decision: NimbusDecision;

  switch (state.controllerMode) {
    case "reactive":
      decision = runReactiveController(state);
      break;
    case "nimbus":
      decision = runNimbusController(state);
      break;
    case "naive":
    default:
      decision = runNaiveController(state);
      break;
  }

  const protectedDecision = protectHospital(decision, state);

  const shedResources = Object.values(protectedDecision.resourceUpdates).filter(
    (resource) => resource.state === "SHED",
  );
  const primaryAction: ResourceAction =
    shedResources.length > 0 ? "SHED" : protectedDecision.action;

  return enforceSafety({ ...protectedDecision, action: primaryAction });
}