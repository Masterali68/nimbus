import type { ClimateType, SimulationConfig } from "./types";
import { DEFAULT_CONFIG } from "./config";

export interface ClimatePreset {
  type: ClimateType;
  label: string;
  description: string;
  build: (seed: number) => SimulationConfig;
}

function scalePerTickProbability(
  base: SimulationConfig["events"]["perTickProbability"],
  multipliers: Partial<Record<keyof SimulationConfig["events"]["perTickProbability"], number>>
): SimulationConfig["events"]["perTickProbability"] {
  const result = { ...base };
  for (const key of Object.keys(multipliers) as (keyof typeof result)[]) {
    result[key] = base[key] * (multipliers[key] ?? 1);
  }
  return result;
}

/**
 * Trade-wind tropical island — this IS `DEFAULT_CONFIG`'s profile (see config.ts for the full
 * set of citations): near-equator low seasonal swing, humid baseline cloud cover, steady ~7 m/s
 * trade winds, moderate hurricane-season storm risk.
 */
function tropicalTradeWindIsland(seed: number): SimulationConfig {
  return { ...DEFAULT_CONFIG, seed };
}

/**
 * Arid desert coast. Grounded in: desert PV installations measuring ~19.6% capacity factor
 * (dominated by heat de-rating and dust rather than cloud — the low `baselineCloudMean` below
 * reflects genuinely low cloud cover, not the heat/dust losses the solar model doesn't separately
 * model); EIA data showing "large or high-demand homes" (AC-heavy) running 45-80+ kWh/day versus
 * a ~29 kWh/day national average (~1.4x here); and a documented assumption that this is a
 * moderate-wind coastal desert, not a high trade-wind corridor, so wind resource is set lower
 * than the tropical-island preset. Storms are rarer than the tropical preset but desalination
 * (the island's only fresh water source in an arid climate) fails more often.
 */
function aridDesertCoast(seed: number): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    seed,
    solar: {
      ...DEFAULT_CONFIG.solar,
      seasonalAmplitude: 0.15,
      baselineCloudMean: 0.05,
      baselineCloudTheta: 0.03,
      baselineCloudSigma: 0.02,
    },
    wind: {
      ...DEFAULT_CONFIG.wind,
      ouMeanMps: 5.0,
      ouSigma: 0.12,
    },
    demand: {
      ...DEFAULT_CONFIG.demand,
      residential: {
        ...DEFAULT_CONFIG.demand.residential,
        baselineKw: DEFAULT_CONFIG.demand.residential.baselineKw * 1.4,
        noiseStdKw: DEFAULT_CONFIG.demand.residential.noiseStdKw * 1.2,
      },
      resort: {
        ...DEFAULT_CONFIG.demand.resort,
        baselineKw: DEFAULT_CONFIG.demand.resort.baselineKw * 1.35,
      },
    },
    events: {
      ...DEFAULT_CONFIG.events,
      perTickProbability: scalePerTickProbability(DEFAULT_CONFIG.events.perTickProbability, {
        storm: 0.4,
        cloudCover: 0.3,
        waterEmergency: 2.5,
      }),
    },
  };
}

/**
 * Temperate coastal. Grounded in: higher-latitude seasonal solar swing (much bigger than a
 * near-equator island); a cloudier climate baseline; and well-documented strong, reliable
 * mid-latitude coastal wind resource (~8-9 m/s class, vs ~5-7 m/s trade winds) that makes wind
 * power genuinely competitive with solar here. Frontal-system storms are more frequent than the
 * tropical preset, though individually milder on average (severity roll is unaffected — only
 * frequency is climate-tuned here).
 */
function temperateCoastal(seed: number): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    seed,
    solar: {
      ...DEFAULT_CONFIG.solar,
      seasonalAmplitude: 0.45,
      baselineCloudMean: 0.35,
      baselineCloudTheta: 0.05,
      baselineCloudSigma: 0.06,
    },
    wind: {
      ...DEFAULT_CONFIG.wind,
      ouMeanMps: 8.5,
      ouSigma: 0.18,
    },
    demand: {
      ...DEFAULT_CONFIG.demand,
      residential: {
        ...DEFAULT_CONFIG.demand.residential,
        weekendMultiplier: 1.15,
        noiseStdKw: DEFAULT_CONFIG.demand.residential.noiseStdKw * 1.15,
      },
    },
    events: {
      ...DEFAULT_CONFIG.events,
      perTickProbability: scalePerTickProbability(DEFAULT_CONFIG.events.perTickProbability, {
        storm: 1.6,
        cloudCover: 1.5,
      }),
    },
  };
}

/**
 * Monsoon tropical. Grounded in: rain-dominated tropical monsoon climates showing markedly
 * reduced/more-variable PV output in the literature (high `baselineCloudMean` and
 * `baselineCloudSigma` here); gustier, squall-driven wind (higher `ouSigma`, same mean as the
 * trade-wind preset); and a monsoon/cyclone season that makes severe, correlated storms both
 * more frequent and more likely to cross the compound-crisis severity threshold.
 */
function monsoonTropical(seed: number): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    seed,
    solar: {
      ...DEFAULT_CONFIG.solar,
      seasonalAmplitude: 0.3,
      baselineCloudMean: 0.45,
      baselineCloudTheta: 0.06,
      baselineCloudSigma: 0.08,
    },
    wind: {
      ...DEFAULT_CONFIG.wind,
      ouMeanMps: 6,
      ouSigma: 0.3,
    },
    demand: {
      ...DEFAULT_CONFIG.demand,
      residential: {
        ...DEFAULT_CONFIG.demand.residential,
        noiseStdKw: DEFAULT_CONFIG.demand.residential.noiseStdKw * 1.2,
      },
      resort: {
        ...DEFAULT_CONFIG.demand.resort,
        noiseStdKw: DEFAULT_CONFIG.demand.resort.noiseStdKw * 1.2,
      },
    },
    events: {
      ...DEFAULT_CONFIG.events,
      compoundSeverityThreshold: 0.5,
      perTickProbability: scalePerTickProbability(DEFAULT_CONFIG.events.perTickProbability, {
        storm: 2.5,
        demandSurge: 1.3,
        waterEmergency: 1.5,
      }),
    },
  };
}

export const CLIMATE_PRESETS: Record<ClimateType, ClimatePreset> = {
  "tropical-trade-wind-island": {
    type: "tropical-trade-wind-island",
    label: "Tropical Trade-Wind Island",
    description:
      "Near-equator, low seasonal swing, humid baseline cloud cover, steady ~7 m/s trade winds, moderate hurricane-season storm risk.",
    build: tropicalTradeWindIsland,
  },
  "arid-desert-coast": {
    type: "arid-desert-coast",
    label: "Arid Desert Coast",
    description:
      "Very low cloud cover and high solar yield, moderate wind, extreme AC-driven demand, rare storms but frequent desalination-side water emergencies.",
    build: aridDesertCoast,
  },
  "temperate-coastal": {
    type: "temperate-coastal",
    label: "Temperate Coastal",
    description:
      "Strong seasonal solar swing, cloudier baseline, strong reliable coastal wind resource, frequent frontal-system storms.",
    build: temperateCoastal,
  },
  "monsoon-tropical": {
    type: "monsoon-tropical",
    label: "Monsoon Tropical",
    description:
      "Heavy wet-season cloud cover, gusty squall-driven wind, frequent and severe cyclone-season storms with a lower compound-crisis threshold.",
    build: monsoonTropical,
  },
};

/** Builds a full SimulationConfig for a named climate preset with the given seed. */
export function createConfigForClimate(climate: ClimateType, seed: number): SimulationConfig {
  return CLIMATE_PRESETS[climate].build(seed);
}
