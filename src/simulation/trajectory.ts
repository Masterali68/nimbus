import type { EnergyBalanceState, TrajectoryConfig } from "./types";

export interface TrajectoryStepInput {
  /** Raw generation - demand this tick (unconstrained demand — see EnergyBalanceState.netPowerKw). */
  netPowerKw: number;
  prevFilteredNetPowerKw: number;
  prevVelocityKwPerS: number;
  tickLengthMinutes: number;
  config: TrajectoryConfig;
}

/**
 * EMA-smooths net power, derives velocity/acceleration, and classifies the trend. This is the
 * early-detection signal: velocity/acceleration must be computed from the smoothed series (not
 * raw per-tick noise) so a real deterioration is distinguishable from ordinary demand-model noise.
 */
export function stepTrajectory(input: TrajectoryStepInput): EnergyBalanceState {
  const { netPowerKw, prevFilteredNetPowerKw, prevVelocityKwPerS, tickLengthMinutes, config } = input;
  const dtSeconds = tickLengthMinutes * 60;

  const filteredNetPowerKw = config.emaAlpha * netPowerKw + (1 - config.emaAlpha) * prevFilteredNetPowerKw;
  const velocityKwPerS = (filteredNetPowerKw - prevFilteredNetPowerKw) / dtSeconds;
  const accelerationKwPerS2 = (velocityKwPerS - prevVelocityKwPerS) / dtSeconds;

  let trajectory: EnergyBalanceState["trajectory"] = "STABLE";
  if (velocityKwPerS <= config.velocityDeterioratingThresholdKwPerS) {
    trajectory = "DETERIORATING";
  } else if (velocityKwPerS >= config.velocityImprovingThresholdKwPerS) {
    trajectory = "IMPROVING";
  }

  return { netPowerKw, filteredNetPowerKw, velocityKwPerS, accelerationKwPerS2, trajectory };
}
