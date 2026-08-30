import type { PdConfig } from "../types";

export interface PdStepInput {
  filteredNetPowerKw: number;
  /** The previous tick's error (same error signal the derivative term is computed on — not a
   * separately-sourced velocity). */
  prevError: number;
  tickLengthMinutes: number;
  config: PdConfig;
}

export interface PdStepResult {
  /** 0-100, clamped to config.minOperatingPct..100. */
  operatingPct: number;
  /** This tick's error, to feed back in as prevError next tick. */
  error: number;
}

/**
 * PD controller for continuously-throttleable desalination. error = target - filtered net power
 * (positive error = deficit-leaning, i.e. need to reduce demand). Output ramps smoothly tick to
 * tick because both terms are continuous functions of a slowly-EMA-smoothed signal — never an
 * instant on/off step.
 */
export function stepPd(input: PdStepInput): PdStepResult {
  const { filteredNetPowerKw, prevError, tickLengthMinutes, config } = input;
  const dtSeconds = tickLengthMinutes * 60;

  const error = config.targetNetPowerKw - filteredNetPowerKw;
  const derivative = (error - prevError) / dtSeconds;
  const reductionPct = config.kp * error + config.kd * derivative;
  const operatingPct = Math.min(100, Math.max(config.minOperatingPct, 100 - reductionPct));

  return { operatingPct, error };
}
