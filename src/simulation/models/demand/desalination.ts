import type { DesalinationDemandConfig, DesalinationDemandState, SimTime } from "../../types";
import { sampleStandardNormal, type Rng } from "../../rng";

// Minimum idle/pump-priming load the plant needs even when throttled way down.
const MIN_OPERATING_FRACTION = 0.2;

/**
 * Large, continuously-throttleable load (criticalityScore 90), not shed-capable — desalination
 * is reduced smoothly via PD control, never fully cut off, tied to the water system.
 * `waterOutputM3PerHour` here is the plant's requested/theoretical output at operatingPct = 100 —
 * the authoritative, power-and-capacity-constrained figure is resolved later in
 * constraints/waterBalance.ts and surfaced on IslandState.water, not here.
 */
export function stepDesalination(
  _time: SimTime,
  rng: Rng,
  config: DesalinationDemandConfig
): DesalinationDemandState {
  const noise = sampleStandardNormal(rng) * config.noiseStdKw;
  const maxDemandKw = Math.max(0, config.baselineKw + noise);

  const waterDemandM3PerHour = Math.min(maxDemandKw / config.kwhPerM3, config.capacityM3PerHour);

  return {
    currentDemandKw: maxDemandKw,
    maxDemandKw,
    minOperatingLevelKw: maxDemandKw * MIN_OPERATING_FRACTION,
    criticalityScore: 90,
    continuouslyThrottleable: true,
    shedCapable: false,
    operatingPct: 100,
    state: "NORMAL",
    waterDemandM3PerHour,
    waterOutputM3PerHour: waterDemandM3PerHour,
  };
}
