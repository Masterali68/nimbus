import type { ConstraintViolation, DesalinationDemandState, WaterConfig, WaterState } from "../types";

export interface WaterBalanceInput {
  /** Desalination demand state AFTER the active controller's operatingPct decision has been applied. */
  desalination: DesalinationDemandState;
  desalinationCapacityM3PerHour: number;
  /** 0..1 fraction of desalination capacity knocked out this tick (from event modifiers). */
  desalinationOutageFraction: number;
  prevReservoirLevelM3: number;
  tickLengthMinutes: number;
  config: WaterConfig;
}

export interface WaterBalanceResult {
  water: WaterState;
  violations: ConstraintViolation[];
}

export function computeWaterBalance(input: WaterBalanceInput): WaterBalanceResult {
  const {
    desalination,
    desalinationCapacityM3PerHour,
    desalinationOutageFraction,
    prevReservoirLevelM3,
    tickLengthMinutes,
    config,
  } = input;

  const effectiveCapacityM3PerHour = desalinationCapacityM3PerHour * (1 - desalinationOutageFraction);

  // Desalination's actually-achievable output is bounded by both the power actually allocated to
  // it this tick (its controller-decided operatingPct) and the (possibly outage-reduced) plant capacity.
  const powerConstrainedOutputM3PerHour = desalination.waterOutputM3PerHour * (desalination.operatingPct / 100);
  const desalinationOutputM3PerHour = Math.max(
    0,
    Math.min(powerConstrainedOutputM3PerHour, effectiveCapacityM3PerHour)
  );

  const demandM3PerHour = desalination.waterDemandM3PerHour;
  const dtHours = tickLengthMinutes / 60;
  const netM3 = (desalinationOutputM3PerHour - demandM3PerHour) * dtHours;

  let reservoirLevelM3 = prevReservoirLevelM3 + netM3;
  const violations: ConstraintViolation[] = [];
  let deficitM3PerHour = 0;

  if (reservoirLevelM3 < 0) {
    deficitM3PerHour = -reservoirLevelM3 / dtHours;
    violations.push({
      code: "WATER_CAPACITY_CLAMPED",
      message: "Reservoir depleted; water demand partially unmet.",
      magnitude: deficitM3PerHour,
    });
    reservoirLevelM3 = 0;
  } else if (reservoirLevelM3 > config.reservoirCapacityM3) {
    const overflowM3PerHour = (reservoirLevelM3 - config.reservoirCapacityM3) / dtHours;
    violations.push({
      code: "WATER_CAPACITY_CLAMPED",
      message: "Reservoir at capacity; excess desalination output wasted.",
      magnitude: overflowM3PerHour,
    });
    reservoirLevelM3 = config.reservoirCapacityM3;
  }

  return {
    water: {
      desalinationOutputM3PerHour,
      desalinationCapacityM3PerHour: effectiveCapacityM3PerHour,
      reservoirLevelM3,
      reservoirCapacityM3: config.reservoirCapacityM3,
      demandM3PerHour,
      balanceM3PerHour: desalinationOutputM3PerHour - demandM3PerHour,
      deficitM3PerHour,
    },
    violations,
  };
}
