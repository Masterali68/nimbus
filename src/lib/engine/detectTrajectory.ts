import type { Severity, Trajectory } from "@/types/nimbus";
import { nimbusThresholds } from "@/lib/constants/thresholds";

export interface TrajectoryInput {
  filteredNetPowerKw: number;
  velocityKwS: number;
  accelerationKwS2: number;
  batteryPct: number;
  warmupComplete: boolean;
}

export function detectTrajectory(input: TrajectoryInput): Trajectory {
  if (!input.warmupComplete) {
    return "STABLE";
  }

  if (
    input.batteryPct <= nimbusThresholds.criticalBatteryPct ||
    input.velocityKwS <= nimbusThresholds.criticalVelocityKwS ||
    input.accelerationKwS2 <= nimbusThresholds.criticalAccelerationKwS2
  ) {
    return "CRITICAL";
  }

  if (input.velocityKwS >= nimbusThresholds.improvingVelocityKwS) {
    return "IMPROVING";
  }

  if (input.velocityKwS <= nimbusThresholds.deterioratingVelocityKwS) {
    return "DETERIORATING";
  }

  return "STABLE";
}

export interface SeverityInput {
  trajectory: Trajectory;
  velocityKwS: number;
  batteryPct: number;
  filteredNetPowerKw: number;
  warmupComplete: boolean;
}

export function classifySeverity(input: SeverityInput): Severity {
  if (input.trajectory === "CRITICAL" || !input.warmupComplete) {
    return input.trajectory === "CRITICAL" ? "CRITICAL" : "WATCH";
  }

  if (
    input.trajectory === "DETERIORATING" ||
    input.batteryPct <= nimbusThresholds.warningBatteryPct ||
    input.filteredNetPowerKw <= nimbusThresholds.watchNetPowerKw
  ) {
    return input.batteryPct <= nimbusThresholds.criticalBatteryPct
      ? "CRITICAL"
      : "WARNING";
  }

  if (
    input.batteryPct <= nimbusThresholds.watchBatteryPct ||
    input.filteredNetPowerKw < 0
  ) {
    return "WATCH";
  }

  return "STABLE";
}