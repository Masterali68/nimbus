import type { ConsumerDemandState, ResidentialDemandConfig, SimTime } from "../../types";
import { sampleStandardNormal, type Rng } from "../../rng";

const BUMP_WIDTH_HOURS = 2;
// Floor when REDUCED by a controller — never cut below this fraction of natural demand.
const MIN_OPERATING_FRACTION = 0.4;

function gaussianBump(hour: number, peakHour: number, widthHours: number): number {
  return Math.exp(-((hour - peakHour) ** 2) / (2 * widthHours ** 2));
}

/** Classic double-hump curve: morning + evening peaks, with weekend variation. criticalityScore
 * 70, throttleable and shed-capable. */
export function stepResidential(
  time: SimTime,
  rng: Rng,
  config: ResidentialDemandConfig
): ConsumerDemandState {
  const morningBump = gaussianBump(time.hourOfDay, config.morningPeakHour, BUMP_WIDTH_HOURS);
  const eveningBump = gaussianBump(time.hourOfDay, config.eveningPeakHour, BUMP_WIDTH_HOURS);
  const shapeFactor = 0.5 + 0.5 * (morningBump + eveningBump);
  const dayMultiplier = time.isWeekend ? config.weekendMultiplier : 1;

  const noise = sampleStandardNormal(rng) * config.noiseStdKw;
  const maxDemandKw = Math.max(0, config.baselineKw * shapeFactor * dayMultiplier + noise);

  return {
    currentDemandKw: maxDemandKw,
    maxDemandKw,
    minOperatingLevelKw: maxDemandKw * MIN_OPERATING_FRACTION,
    criticalityScore: 70,
    continuouslyThrottleable: true,
    shedCapable: true,
    operatingPct: 100,
    state: "NORMAL",
  };
}
