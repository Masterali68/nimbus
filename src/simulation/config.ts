import type { EventType, SimulationConfig } from "./types";

/**
 * Reference scenario for every constant below: a small, self-sufficient island community —
 * roughly 300 households, a ~150-room resort, a ~30-bed community hospital/clinic, and one small
 * SWRO desalination plant serving ~2,000 residents. Values are grounded in published real-world
 * benchmarks (cited inline per section) and scaled to fit this community's size — not to any
 * single real facility's absolute magnitude. This is the "tropical-trade-wind-island" climate
 * (see climates.ts for the other three profiles and what real-world pattern each approximates).
 */

const PER_TICK_PROBABILITY: Record<EventType, number> = {
  // Roughly one storm per ~2 simulated demo-days at a 1-minute tick (1440 ticks/day).
  storm: 1 / (2 * 1440),
  windDrop: 1 / (1.5 * 1440),
  cloudCover: 1 / (0.5 * 1440),
  demandSurge: 1 / (1 * 1440),
  waterEmergency: 1 / (3 * 1440),
  // compoundCrisis is never rolled directly by the scheduler — it is
  // spawned as bookkeeping when a storm's severity crosses the threshold below.
  compoundCrisis: 0,
};

export const DEFAULT_CONFIG: SimulationConfig = {
  seed: 1,
  tickLengthMinutes: 1,
  yearLengthDays: 365,
  solar: {
    installedCapacityKw: 500,
    sunriseHour: 6,
    sunsetHour: 18,
    // Near-equator trade-wind island: day length barely varies by season, so the seasonal swing
    // in peak output is small.
    seasonalAmplitude: 0.08,
    // Humid tropical baseline cloud cover — partly-cloudy is the norm, not the exception.
    baselineCloudMean: 0.25,
    baselineCloudTheta: 0.05,
    baselineCloudSigma: 0.05,
  },
  wind: {
    installedCapacityKw: 300,
    // Real utility-scale turbine power-curve specs: cut-in ~3 m/s, rated ~11-15 m/s (12 typical),
    // cut-out ~20-25 m/s (25 most common) — this is hardware, not climate, so every climate
    // preset in climates.ts keeps the same curve and only varies the wind *resource* below.
    cutInMps: 3,
    ratedMps: 12,
    cutOutMps: 25,
    ouTheta: 0.02,
    ouSigma: 0.15,
    // Trade winds average ~5-7 m/s annually (up to ~13 m/s in gusts) over tropical islands.
    ouMeanMps: 7,
  },
  battery: {
    // Scaled-down utility BESS, modeled after Tesla Megapack's ~4-hour discharge configuration
    // (rate = capacity / 4, i.e. 0.25C) rather than an arbitrary ratio.
    capacityKwh: 800,
    maxChargeRateKw: 200,
    maxDischargeRateKw: 200,
    // Tesla Megapack 2 XL/3 datasheets report 91-93.7% round-trip efficiency.
    // See the roundTripEfficiency doc comment in types.ts and the matching
    // note in models/battery.ts for the charge-only-loss simplification.
    roundTripEfficiency: 0.92,
    initialSocFraction: 0.5,
    dispatchDeadbandKw: 2,
  },
  demand: {
    hospital: {
      // ~30-bed clinic-hospital: high, steady baseline; low variance is the defining trait of
      // hospital load, not the absolute figure.
      baselineKw: 120,
      noiseStdKw: 3,
    },
    desalination: {
      baselineKw: 150,
      noiseStdKw: 10,
      capacityM3PerHour: 40,
      // SWRO industry benchmark is ~2.0-5.5 kWh/m3 (thermodynamic minimum ~1 kWh/m3, current
      // world-record plants ~1.8 kWh/m3); 3.2 is a realistic mid-range value for a small plant.
      kwhPerM3: 3.2,
    },
    residential: {
      // ~300 households; US EIA benchmark average is ~29 kWh/household/day, with typical family
      // homes in the 25-45 kWh/day band — this baseline plus the double-hump shape factor and
      // noise keeps individual ticks within that realistic range.
      baselineKw: 200,
      noiseStdKw: 15,
      morningPeakHour: 8,
      eveningPeakHour: 20,
      weekendMultiplier: 1.1,
    },
    resort: {
      // ~150 rooms; hotel benchmarks report roughly 15-25 kWh/room/day.
      baselineKw: 100,
      noiseStdKw: 20,
      daytimePeakHour: 13,
      eveningPeakHour: 21,
    },
  },
  water: {
    reservoirCapacityM3: 2000,
    initialReservoirLevelM3: 1200,
  },
  events: {
    perTickProbability: PER_TICK_PROBABILITY,
    compoundSeverityThreshold: 0.6,
    historyLength: 1440 * 3,
  },
  trajectory: {
    emaAlpha: 0.3,
    velocityDeterioratingThresholdKwPerS: -0.5,
    velocityImprovingThresholdKwPerS: 0.5,
  },
  controllers: {
    activeControllerType: "nimbus",
    naive: {
      shedResortBelowSocPct: 30,
      restoreResortAboveSocPct: 40,
      shedResidentialBelowSocPct: 15,
      restoreResidentialAboveSocPct: 25,
    },
    nimbus: {
      desalinationPd: {
        kp: 0.08,
        kd: 0.4,
        targetNetPowerKw: 0,
        minOperatingPct: 20,
      },
      residentialReducedOperatingPct: 70,
      residentialReduceBelowSocPct: 35,
      residentialRestoreAboveSocPct: 45,
      resortHysteresis: { minCooldownTicks: 15 },
      resortShedBelowSocPct: 20,
      resortRestoreAboveSocPct: 35,
      restorationCooldownTicks: 10,
    },
  },
};
