import type { BatteryConfig, BatteryState, ConstraintViolation } from "../types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface BatteryResolveInput {
  prevSocKwh: number;
  prevCyclesAccumulated: number;
  totalSupplyKw: number;
  totalDemandKw: number;
  /**
   * Pre-clamp requested rate from a queued ControlAction this tick
   * ("battery.setChargeRate" -> its requestedKw, "battery.hold" -> 0), or
   * null when no battery-relevant action is queued this tick, in which case
   * the default auto-dispatch heuristic below decides the request.
   * Positive = charge, negative = discharge.
   */
  controlOverrideRequestedKw: number | null;
  tickLengthMinutes: number;
  config: BatteryConfig;
}

export interface BatteryResolveResult {
  state: BatteryState;
  violations: ConstraintViolation[];
}

/**
 * Default auto-dispatch heuristic, used only when no ControlAction is queued
 * for this tick: charge from surplus, discharge to cover deficit, hold inside
 * a deadband to avoid flapping at near-zero net power. This is a per-tick
 * fallback, not a mode switch — if a future optimizer only sends actions
 * intermittently, this heuristic silently runs on every gap tick. See the
 * "no ControlAction queued" contract note in api/simulationApi.ts / README.md.
 */
function defaultDispatchRequestKw(
  totalSupplyKw: number,
  totalDemandKw: number,
  deadbandKw: number
): number {
  const netKw = totalSupplyKw - totalDemandKw;
  if (netKw > deadbandKw) return netKw; // charge from surplus
  if (netKw < -deadbandKw) return netKw; // discharge to cover deficit (negative)
  return 0; // hold
}

export function resolveBattery(input: BatteryResolveInput): BatteryResolveResult {
  const { prevSocKwh, prevCyclesAccumulated, totalSupplyKw, totalDemandKw, tickLengthMinutes, config } =
    input;
  const violations: ConstraintViolation[] = [];

  const requestedRateKw =
    input.controlOverrideRequestedKw ??
    defaultDispatchRequestKw(totalSupplyKw, totalDemandKw, config.dispatchDeadbandKw);

  const rateClampedKw = clamp(requestedRateKw, -config.maxDischargeRateKw, config.maxChargeRateKw);
  if (rateClampedKw !== requestedRateKw) {
    violations.push({
      code: "BATTERY_RATE_CLAMPED",
      message: "Requested battery rate exceeded max charge/discharge rate.",
      magnitude: Math.abs(requestedRateKw - rateClampedKw),
    });
  }

  const dtHours = tickLengthMinutes / 60;
  const headroomKwh = config.capacityKwh - prevSocKwh;
  const availableKwh = prevSocKwh;

  let actualChargeRateKw = 0;
  let newSocKwh = prevSocKwh;

  if (rateClampedKw > 0) {
    // Round-trip efficiency loss is modeled as applied entirely on charge:
    // energyStored = energyIn * roundTripEfficiency. Discharge later returns
    // stored energy lossless. This is a stated simplification — it means
    // energyStored on a charge tick and energyDischarged later will NOT sum
    // back to energyIn in an obviously-conserved way if read off the history
    // log; see the matching doc comment on BatteryConfig.roundTripEfficiency.
    const maxEnergyInKwh = headroomKwh / config.roundTripEfficiency;
    const requestedEnergyInKwh = rateClampedKw * dtHours;
    const energyInKwh = Math.min(requestedEnergyInKwh, Math.max(0, maxEnergyInKwh));
    actualChargeRateKw = energyInKwh / dtHours;
    newSocKwh = prevSocKwh + energyInKwh * config.roundTripEfficiency;

    if (energyInKwh < requestedEnergyInKwh) {
      violations.push({
        code: "BATTERY_SOC_CLAMPED",
        message: "Battery reached capacity; charge rate clamped.",
        magnitude: rateClampedKw - actualChargeRateKw,
      });
    }
  } else if (rateClampedKw < 0) {
    const requestedEnergyOutKwh = -rateClampedKw * dtHours;
    const energyOutKwh = Math.min(requestedEnergyOutKwh, Math.max(0, availableKwh));
    actualChargeRateKw = -(energyOutKwh / dtHours);
    newSocKwh = prevSocKwh - energyOutKwh;

    if (energyOutKwh < requestedEnergyOutKwh) {
      violations.push({
        code: "BATTERY_SOC_CLAMPED",
        message: "Battery depleted; discharge rate clamped.",
        magnitude: rateClampedKw - actualChargeRateKw,
      });
    }
  }

  newSocKwh = clamp(newSocKwh, 0, config.capacityKwh);
  const cyclesAccumulated =
    prevCyclesAccumulated + Math.abs(actualChargeRateKw) * dtHours / (2 * config.capacityKwh);

  return {
    state: {
      socKwh: newSocKwh,
      capacityKwh: config.capacityKwh,
      socFraction: newSocKwh / config.capacityKwh,
      chargeRateKw: actualChargeRateKw,
      requestedRateKw,
      maxChargeRateKw: config.maxChargeRateKw,
      maxDischargeRateKw: config.maxDischargeRateKw,
      roundTripEfficiency: config.roundTripEfficiency,
      cyclesAccumulated,
    },
    violations,
  };
}
