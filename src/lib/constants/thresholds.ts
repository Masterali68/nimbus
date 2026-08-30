export const TICK_INTERVAL_MS = 1000;
export const TICK_INTERVAL_SECONDS = TICK_INTERVAL_MS / 1000;

export const ema = {
  netPowerAlpha: 0.3,
  velocityAlpha: 0.2,
  accelerationAlpha: 0.15,
  warmupTicks: 5,
};

export const naiveThresholds = {
  resortShedBatteryPct: 30,
  residentialReduceBatteryPct: 20,
};

export const reactiveThresholds = {
  resortShedBatteryPct: 25,
  resortRestoreBatteryPct: 40,
  residentialReduceBatteryPct: 20,
  residentialRestoreBatteryPct: 40,
  shedNetPowerKw: -10,
  restoreNetPowerKw: 5,
};

export const nimbusThresholds = {
  watchBatteryPct: 45,
  warningBatteryPct: 30,
  criticalBatteryPct: 20,
  watchNetPowerKw: -5,
  targetSurplusKw: 15,
  deterioratingVelocityKwS: -2,
  criticalVelocityKwS: -8,
  improvingVelocityKwS: 3,
  criticalAccelerationKwS2: -2,
};

export const desalinationLimits = {
  minOperatingPct: 30,
  maxOperatingPct: 100,
  maxStepPctPerTick: 5,
  curtailGainP: 0.35,
  curtailGainD: 0.9,
  maxCurtailKw: 80,
};

export const residentialLimits = {
  reduceStepPct: 20,
  maxReductionPct: 80,
};

export const resortCooldown = {
  recoveryBatteryPct: 35,
};

export const safety = {
  hospitalCriticality: 100,
  desalinationFloorPct: 30,
};