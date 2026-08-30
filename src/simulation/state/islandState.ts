import type {
  BatteryState,
  ConsumerDemandState,
  Decision,
  DemandState,
  EnergyBalanceState,
  GenerationState,
  IslandState,
  PowerBalanceState,
  SimEvent,
  SimTime,
  SolarState,
  WaterState,
  WindState,
} from "../types";

export const ISLAND_STATE_VERSION = 2;

function emptySolarState(): SolarState {
  return { outputKw: 0, installedCapacityKw: 0, cloudCoverFactor: 0, theoreticalClearSkyKw: 0 };
}

function emptyWindState(): WindState {
  return { outputKw: 0, installedCapacityKw: 0, windSpeedMps: 0, turbineRegime: "below-cutin" };
}

function emptyBatteryState(): BatteryState {
  return {
    socKwh: 0,
    capacityKwh: 0,
    socFraction: 0,
    chargeRateKw: 0,
    requestedRateKw: 0,
    maxChargeRateKw: 0,
    maxDischargeRateKw: 0,
    roundTripEfficiency: 1,
    cyclesAccumulated: 0,
  };
}

function emptyConsumer(criticalityScore: number, continuouslyThrottleable: boolean, shedCapable: boolean): ConsumerDemandState {
  return {
    currentDemandKw: 0,
    maxDemandKw: 0,
    minOperatingLevelKw: 0,
    criticalityScore,
    continuouslyThrottleable,
    shedCapable,
    operatingPct: 100,
    state: "NORMAL",
  };
}

function emptyDemandState(): DemandState {
  return {
    hospital: { ...emptyConsumer(100, false, false), state: "PROTECTED" },
    desalination: { ...emptyConsumer(90, true, false), waterDemandM3PerHour: 0, waterOutputM3PerHour: 0 },
    residential: emptyConsumer(70, true, true),
    resort: emptyConsumer(20, true, true),
    totalDemandKw: 0,
    totalMaxDemandKw: 0,
    totalSheddableKw: 0,
  };
}

function emptyWaterState(): WaterState {
  return {
    desalinationOutputM3PerHour: 0,
    desalinationCapacityM3PerHour: 0,
    reservoirLevelM3: 0,
    reservoirCapacityM3: 0,
    demandM3PerHour: 0,
    balanceM3PerHour: 0,
    deficitM3PerHour: 0,
  };
}

function emptyBalanceState(): PowerBalanceState {
  return {
    totalGenerationKw: 0,
    totalDemandKw: 0,
    batteryNetKw: 0,
    surplusKw: 0,
    deficitKw: 0,
    sheddedKw: 0,
    violations: [],
  };
}

function emptyEnergyBalanceState(): EnergyBalanceState {
  return {
    netPowerKw: 0,
    filteredNetPowerKw: 0,
    velocityKwPerS: 0,
    accelerationKwPerS2: 0,
    trajectory: "STABLE",
  };
}

function emptyTime(): SimTime {
  return {
    tick: 0,
    minutesElapsed: 0,
    dayIndex: 0,
    minuteOfDay: 0,
    hourOfDay: 0,
    dayOfWeek: 0,
    isWeekend: false,
    seasonalFactor: 0.5,
  };
}

export function createEmptyIslandState(seed: number): IslandState {
  return {
    time: emptyTime(),
    generation: { solar: emptySolarState(), wind: emptyWindState(), battery: emptyBatteryState(), totalSupplyKw: 0 },
    demand: emptyDemandState(),
    water: emptyWaterState(),
    balance: emptyBalanceState(),
    energyBalance: emptyEnergyBalanceState(),
    activeEvents: [],
    latestDecisions: [],
    seed,
    version: ISLAND_STATE_VERSION,
  };
}

export interface AssembleIslandStateInput {
  time: SimTime;
  generation: GenerationState;
  demand: DemandState;
  water: WaterState;
  balance: PowerBalanceState;
  energyBalance: EnergyBalanceState;
  activeEvents: SimEvent[];
  latestDecisions: Decision[];
  seed: number;
}

export function assembleIslandState(input: AssembleIslandStateInput): IslandState {
  return { ...input, version: ISLAND_STATE_VERSION };
}
