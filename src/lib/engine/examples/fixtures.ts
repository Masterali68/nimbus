import type { ControllerMode, IslandResource, IslandState, ResourceMap } from "../types";

const hospital: IslandResource = {
  id: "hospital",
  name: "Hospital",
  criticality: 100,
  maxDemandKw: 40,
  minimumOperatingPct: 100,
  operatingPct: 100,
  currentDemandKw: 40,
  state: "PROTECTED",
  throttleable: false,
  shedCapable: false,
};

const desalination: IslandResource = {
  id: "desalination",
  name: "Desalination",
  criticality: 90,
  maxDemandKw: 120,
  minimumOperatingPct: 30,
  operatingPct: 100,
  currentDemandKw: 120,
  state: "NORMAL",
  throttleable: true,
  shedCapable: false,
};

const residential: IslandResource = {
  id: "residential",
  name: "Residential",
  criticality: 70,
  maxDemandKw: 400,
  minimumOperatingPct: 20,
  operatingPct: 100,
  currentDemandKw: 400,
  state: "NORMAL",
  throttleable: false,
  shedCapable: true,
};

const resort: IslandResource = {
  id: "resort",
  name: "Resort",
  criticality: 20,
  maxDemandKw: 250,
  minimumOperatingPct: 0,
  operatingPct: 100,
  currentDemandKw: 250,
  state: "NORMAL",
  throttleable: false,
  shedCapable: true,
};

export function makeResources(overrides?: Partial<ResourceMap>): ResourceMap {
  return { hospital, desalination, residential, resort, ...overrides };
}

export function withControllerMode(
  state: IslandState,
  controllerMode: ControllerMode,
): IslandState {
  return { ...state, controllerMode };
}

export const stableIsland: IslandState = {
  timestampMs: 1700000000000,
  tick: 60,
  activeEvent: "clear-sky-noon",
  controllerMode: "nimbus",
  solarKw: 320,
  windKw: 90,
  totalGenerationKw: 410,
  batteryKwh: 740,
  batteryCapacityKwh: 1000,
  batteryPct: 74,
  batteryChargeRateKw: 20,
  batteryDischargeRateKw: 0,
  totalDemandKw: 390,
  netPowerKw: 20,
  filteredNetPowerKw: 22,
  velocityKwS: 0.5,
  accelerationKwS2: 0,
  resources: makeResources(),
};

export const stormFallingGeneration: IslandState = {
  timestampMs: 1700000100000,
  tick: 60,
  activeEvent: "storm-cloud-cover",
  controllerMode: "nimbus",
  solarKw: 120,
  windKw: 150,
  totalGenerationKw: 270,
  batteryKwh: 560,
  batteryCapacityKwh: 1000,
  batteryPct: 56,
  batteryChargeRateKw: 0,
  batteryDischargeRateKw: 70,
  totalDemandKw: 400,
  netPowerKw: -130,
  filteredNetPowerKw: -64,
  velocityKwS: -6.4,
  accelerationKwS2: -1.8,
  resources: makeResources(),
};

export const severeBatteryShortage: IslandState = {
  timestampMs: 1700000400000,
  tick: 90,
  activeEvent: "prolonged-storm",
  controllerMode: "nimbus",
  solarKw: 60,
  windKw: 120,
  totalGenerationKw: 180,
  batteryKwh: 130,
  batteryCapacityKwh: 1000,
  batteryPct: 13,
  batteryChargeRateKw: 0,
  batteryDischargeRateKw: 120,
  totalDemandKw: 410,
  netPowerKw: -230,
  filteredNetPowerKw: -150,
  velocityKwS: -9,
  accelerationKwS2: -2.4,
  resources: makeResources({
    resort: { ...resort, state: "SHED", operatingPct: 0, currentDemandKw: 0 },
  }),
};

export const recovery: IslandState = {
  timestampMs: 1700000600000,
  tick: 90,
  activeEvent: "clearing-after-storm",
  controllerMode: "nimbus",
  solarKw: 300,
  windKw: 160,
  totalGenerationKw: 460,
  batteryKwh: 380,
  batteryCapacityKwh: 1000,
  batteryPct: 38,
  batteryChargeRateKw: 40,
  batteryDischargeRateKw: 0,
  totalDemandKw: 400,
  netPowerKw: 60,
  filteredNetPowerKw: 42,
  velocityKwS: 4.2,
  accelerationKwS2: 0.6,
  resources: makeResources({
    resort: { ...resort, state: "SHED", operatingPct: 0, currentDemandKw: 0 },
    desalination: {
      ...desalination,
      state: "THROTTLED",
      operatingPct: 55,
      currentDemandKw: 66,
    },
  }),
};