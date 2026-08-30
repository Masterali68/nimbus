import type { ConsumerDemandState, ResortDemandConfig, SimTime } from "../../types";
import { sampleStandardNormal, type Rng } from "../../rng";

const BUMP_WIDTH_HOURS = 2.5;

/** Leisure-driven curve: daytime pool/AC load + evening events. criticalityScore 20 — the most
 * elastic, least critical, fully shed-capable down to zero. */
export function stepResort(time: SimTime, rng: Rng, config: ResortDemandConfig): ConsumerDemandState {
  const daytimeBump = gaussianBump(time.hourOfDay, config.daytimePeakHour, BUMP_WIDTH_HOURS);
  const eveningBump = gaussianBump(time.hourOfDay, config.eveningPeakHour, BUMP_WIDTH_HOURS);
  const shapeFactor = 0.4 + 0.6 * (daytimeBump + eveningBump);

  const noise = sampleStandardNormal(rng) * config.noiseStdKw;
  const maxDemandKw = Math.max(0, config.baselineKw * shapeFactor + noise);

  return {
    currentDemandKw: maxDemandKw,
    maxDemandKw,
    minOperatingLevelKw: 0,
    criticalityScore: 20,
    continuouslyThrottleable: true,
    shedCapable: true,
    operatingPct: 100,
    state: "NORMAL",
  };
}

function gaussianBump(hour: number, peakHour: number, widthHours: number): number {
  return Math.exp(-((hour - peakHour) ** 2) / (2 * widthHours ** 2));
}
