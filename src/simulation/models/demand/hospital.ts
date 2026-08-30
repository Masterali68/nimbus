import type { ConsumerDemandState, HospitalDemandConfig, SimTime } from "../../types";
import { sampleStandardNormal, type Rng } from "../../rng";

/**
 * High baseline, low variance, near-zero tolerance for shortfall: criticalityScore 100,
 * not throttleable, not shed-capable, PROTECTED — never touched by any controller.
 */
export function stepHospital(
  time: SimTime,
  rng: Rng,
  config: HospitalDemandConfig
): ConsumerDemandState {
  // Mild time-of-day variation only (elective procedures during the day) — deliberately flat.
  const shapeFactor = 1 + 0.05 * Math.sin((2 * Math.PI * (time.hourOfDay - 12)) / 24);
  const noise = sampleStandardNormal(rng) * config.noiseStdKw;
  const maxDemandKw = Math.max(0, config.baselineKw * shapeFactor + noise);

  return {
    currentDemandKw: maxDemandKw,
    maxDemandKw,
    minOperatingLevelKw: maxDemandKw,
    criticalityScore: 100,
    continuouslyThrottleable: false,
    shedCapable: false,
    operatingPct: 100,
    state: "PROTECTED",
  };
}
