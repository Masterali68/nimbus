import { describe, expect, it } from "vitest";
import { CLIMATE_PRESETS, createConfigForClimate } from "@/simulation/climates";
import { SimulationEngine } from "@/simulation/engine";
import type { ClimateType } from "@/simulation/types";

const ALL_CLIMATES = Object.keys(CLIMATE_PRESETS) as ClimateType[];

describe("climate presets", () => {
  it.each(ALL_CLIMATES)("'%s' produces a config that runs a full day without throwing", (climate) => {
    const config = createConfigForClimate(climate, 123);
    const engine = new SimulationEngine(config);
    expect(() => engine.tick(1440)).not.toThrow();
  });

  it.each(ALL_CLIMATES)("'%s' is deterministic for a given seed", (climate) => {
    const configA = createConfigForClimate(climate, 55);
    const configB = createConfigForClimate(climate, 55);
    const engineA = new SimulationEngine(configA);
    const engineB = new SimulationEngine(configB);
    engineA.tick(500);
    engineB.tick(500);
    expect(engineA.getHistory()).toEqual(engineB.getHistory());
  });

  it("arid-desert-coast has less baseline cloud cover than temperate-coastal (higher solar yield)", () => {
    const desertConfig = createConfigForClimate("arid-desert-coast", 1);
    const temperateConfig = createConfigForClimate("temperate-coastal", 1);
    expect(desertConfig.solar.baselineCloudMean).toBeLessThan(temperateConfig.solar.baselineCloudMean);

    const desertEngine = new SimulationEngine(desertConfig);
    const temperateEngine = new SimulationEngine(temperateConfig);
    desertEngine.tick(1440);
    temperateEngine.tick(1440);

    const totalSolar = (history: ReturnType<SimulationEngine["getHistory"]>) =>
      history.reduce((sum, s) => sum + s.generation.solar.outputKw, 0);

    expect(totalSolar(desertEngine.getHistory())).toBeGreaterThan(totalSolar(temperateEngine.getHistory()));
  });

  it("temperate-coastal has a stronger seasonal swing than tropical-trade-wind-island", () => {
    const temperate = createConfigForClimate("temperate-coastal", 1);
    const tropical = createConfigForClimate("tropical-trade-wind-island", 1);
    expect(temperate.solar.seasonalAmplitude).toBeGreaterThan(tropical.solar.seasonalAmplitude);
  });

  it("temperate-coastal has a stronger wind resource than arid-desert-coast", () => {
    const temperate = createConfigForClimate("temperate-coastal", 1);
    const desert = createConfigForClimate("arid-desert-coast", 1);
    expect(temperate.wind.ouMeanMps).toBeGreaterThan(desert.wind.ouMeanMps);
  });

  it("monsoon-tropical storms are far more frequent than arid-desert-coast storms", () => {
    const monsoon = createConfigForClimate("monsoon-tropical", 1);
    const desert = createConfigForClimate("arid-desert-coast", 1);
    expect(monsoon.events.perTickProbability.storm).toBeGreaterThan(desert.events.perTickProbability.storm * 5);
  });

  it("every climate keeps the same turbine hardware curve (climate affects the wind resource, not the turbine)", () => {
    for (const climate of ALL_CLIMATES) {
      const config = createConfigForClimate(climate, 1);
      expect(config.wind.cutInMps).toBe(3);
      expect(config.wind.ratedMps).toBe(12);
      expect(config.wind.cutOutMps).toBe(25);
    }
  });

  it("arid-desert-coast has meaningfully higher desalination-adjacent water-emergency risk than tropical", () => {
    const desert = createConfigForClimate("arid-desert-coast", 1);
    const tropical = createConfigForClimate("tropical-trade-wind-island", 1);
    expect(desert.events.perTickProbability.waterEmergency).toBeGreaterThan(
      tropical.events.perTickProbability.waterEmergency
    );
  });
});
