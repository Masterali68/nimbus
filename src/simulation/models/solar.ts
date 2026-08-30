import type { EnvironmentalModifiers, SimTime, SolarConfig, SolarState } from "../types";
import { stepOrnsteinUhlenbeck, type Rng } from "../rng";

export interface SolarStepResult {
  state: SolarState;
  nextCloudBaselineFactor: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function stepSolar(
  time: SimTime,
  modifiers: EnvironmentalModifiers,
  prevCloudBaselineFactor: number,
  rng: Rng,
  config: SolarConfig
): SolarStepResult {
  const { sunriseHour, sunsetHour, installedCapacityKw, seasonalAmplitude } = config;

  let daylightBell = 0;
  if (time.hourOfDay > sunriseHour && time.hourOfDay < sunsetHour) {
    const t = (time.hourOfDay - sunriseHour) / (sunsetHour - sunriseHour);
    daylightBell = Math.sin(Math.PI * t);
  }

  // seasonalFactor is a 0..1 sinusoid; map it to a multiplier centered on 1.
  const seasonalMultiplier = 1 + seasonalAmplitude * (time.seasonalFactor - 0.5) * 2;

  const theoreticalClearSkyKw = clamp(
    installedCapacityKw * daylightBell * seasonalMultiplier,
    0,
    installedCapacityKw
  );

  // Everyday cloud-cover variability (independent of storm/cloudCover events, which apply an
  // additive `cloudCoverDelta` on top of this baseline) — climate-specific, see climates.ts.
  const nextCloudBaselineFactor = clamp(
    stepOrnsteinUhlenbeck(
      prevCloudBaselineFactor,
      config.baselineCloudMean,
      config.baselineCloudTheta,
      config.baselineCloudSigma,
      rng
    ),
    0,
    1
  );

  const cloudCoverFactor = clamp(nextCloudBaselineFactor + modifiers.cloudCoverDelta, 0, 1);
  const outputKw = clamp(theoreticalClearSkyKw * (1 - cloudCoverFactor), 0, installedCapacityKw);

  return {
    state: {
      outputKw,
      installedCapacityKw,
      cloudCoverFactor,
      theoreticalClearSkyKw,
    },
    nextCloudBaselineFactor,
  };
}
