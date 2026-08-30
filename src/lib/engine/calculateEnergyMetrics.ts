import { TICK_INTERVAL_SECONDS, ema } from "@/lib/constants/thresholds";
import { isFiniteNumber } from "@/lib/engine/resources";

export interface EnergyMetricsInput {
  solarKw: number;
  windKw: number;
  totalDemandKw: number;
  tick: number;
  previousFilteredNetPowerKw?: number;
  previousVelocityKwS?: number;
  previousAccelerationKwS2?: number;
}

export interface EnergyMetrics {
  totalGenerationKw: number;
  netPowerKw: number;
  filteredNetPowerKw: number;
  velocityKwS: number;
  accelerationKwS2: number;
  warmupComplete: boolean;
}

export function calculateEnergyMetrics(
  input: EnergyMetricsInput,
): EnergyMetrics {
  const hasFiniteInputs = [
    input.solarKw,
    input.windKw,
    input.totalDemandKw,
  ].every(Number.isFinite);

  if (!hasFiniteInputs) {
    return {
      totalGenerationKw: 0,
      netPowerKw: 0,
      filteredNetPowerKw: isFiniteNumber(input.previousFilteredNetPowerKw)
        ? (input.previousFilteredNetPowerKw as number)
        : 0,
      velocityKwS: isFiniteNumber(input.previousVelocityKwS)
        ? (input.previousVelocityKwS as number)
        : 0,
      accelerationKwS2: isFiniteNumber(input.previousAccelerationKwS2)
        ? (input.previousAccelerationKwS2 as number)
        : 0,
      warmupComplete: false,
    };
  }

  const totalGenerationKw = input.solarKw + input.windKw;
  const netPowerKw = totalGenerationKw - input.totalDemandKw;

  const previousFiltered = isFiniteNumber(input.previousFilteredNetPowerKw)
    ? (input.previousFilteredNetPowerKw as number)
    : netPowerKw;

  const filteredNetPowerKw =
    ema.netPowerAlpha * netPowerKw +
    (1 - ema.netPowerAlpha) * previousFiltered;

  const rawVelocityKwS =
    (filteredNetPowerKw - previousFiltered) / TICK_INTERVAL_SECONDS;

  const previousVelocity = isFiniteNumber(input.previousVelocityKwS)
    ? (input.previousVelocityKwS as number)
    : rawVelocityKwS;

  const velocityKwS =
    ema.velocityAlpha * rawVelocityKwS +
    (1 - ema.velocityAlpha) * previousVelocity;

  const rawAccelerationKwS2 = (velocityKwS - previousVelocity) / TICK_INTERVAL_SECONDS;

  const previousAcceleration = isFiniteNumber(input.previousAccelerationKwS2)
    ? (input.previousAccelerationKwS2 as number)
    : rawAccelerationKwS2;

  const accelerationKwS2 =
    ema.accelerationAlpha * rawAccelerationKwS2 +
    (1 - ema.accelerationAlpha) * previousAcceleration;

  return {
    totalGenerationKw,
    netPowerKw,
    filteredNetPowerKw,
    velocityKwS,
    accelerationKwS2,
    warmupComplete: input.tick >= ema.warmupTicks,
  };
}