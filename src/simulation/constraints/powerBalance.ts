import type { ConstraintViolation, DemandState, PowerBalanceState } from "../types";

export interface PowerBalanceInput {
  solarOutputKw: number;
  windOutputKw: number;
  /** Post-clamp battery rate: positive = charging (draws power), negative = discharging (supplies power). */
  batteryChargeRateKw: number;
  /** Demand AFTER the active controller has already decided each consumer's operatingPct/state
   * this tick — this layer only measures/validates, it does not decide any shedding itself. */
  demand: DemandState;
}

/**
 * Pure measurement/validation layer: computes generation/demand totals and reports an explicit
 * deficit if the controller's decisions still leave demand unmet — never fabricates a balance
 * by silently shedding load itself (that decision now belongs to the active controller, see
 * controllers/).
 */
export function computePowerBalance(input: PowerBalanceInput): PowerBalanceState {
  const totalGenerationKw = input.solarOutputKw + input.windOutputKw;
  const batteryNetKw = -input.batteryChargeRateKw;
  const totalDemandKw = input.demand.totalDemandKw;

  const surplusKw = totalGenerationKw + batteryNetKw - totalDemandKw;
  const deficitKw = Math.max(0, -surplusKw);
  const sheddedKw = Math.max(0, input.demand.totalMaxDemandKw - input.demand.totalDemandKw);

  const violations: ConstraintViolation[] = [];
  if (deficitKw > 0) {
    violations.push({
      code: "UNMET_DEMAND",
      message: "Generation and battery discharge insufficient to meet demand even after the active controller's throttling/shedding decisions.",
      magnitude: deficitKw,
    });
  }

  return {
    totalGenerationKw,
    totalDemandKw,
    batteryNetKw,
    surplusKw,
    deficitKw,
    sheddedKw,
    violations,
  };
}
