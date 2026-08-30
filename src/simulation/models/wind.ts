import type { EnvironmentalModifiers, TurbineRegime, WindConfig, WindState } from "../types";
import { stepOrnsteinUhlenbeck, type Rng } from "../rng";

export interface WindStepResult {
  state: WindState;
  nextWindSpeedMps: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Non-linear turbine power curve: zero below cut-in, cubic ramp to rated, flat to cut-out, zero above. */
function turbinePower(windSpeedMps: number, config: WindConfig): { outputKw: number; regime: TurbineRegime } {
  const { cutInMps, ratedMps, cutOutMps, installedCapacityKw } = config;

  if (windSpeedMps < cutInMps || windSpeedMps >= cutOutMps) {
    return { outputKw: 0, regime: windSpeedMps >= cutOutMps ? "cutout" : "below-cutin" };
  }
  if (windSpeedMps < ratedMps) {
    const fraction = (windSpeedMps - cutInMps) / (ratedMps - cutInMps);
    return { outputKw: installedCapacityKw * fraction ** 3, regime: "ramping" };
  }
  return { outputKw: installedCapacityKw, regime: "rated" };
}

export function stepWind(
  prevWindSpeedMps: number,
  modifiers: EnvironmentalModifiers,
  rng: Rng,
  config: WindConfig
): WindStepResult {
  const effectiveMean = config.ouMeanMps + modifiers.windMeanShiftMps;
  const effectiveSigma = config.ouSigma * modifiers.windVolatilityMultiplier;

  const nextWindSpeedMps = Math.max(
    0,
    stepOrnsteinUhlenbeck(prevWindSpeedMps, effectiveMean, config.ouTheta, effectiveSigma, rng)
  );

  const { outputKw, regime } = turbinePower(nextWindSpeedMps, config);

  return {
    state: {
      outputKw: clamp(outputKw, 0, config.installedCapacityKw),
      installedCapacityKw: config.installedCapacityKw,
      windSpeedMps: nextWindSpeedMps,
      turbineRegime: regime,
    },
    nextWindSpeedMps,
  };
}
