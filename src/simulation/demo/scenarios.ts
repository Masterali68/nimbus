import type { EventType, SimulationConfig } from "../types";
import { DEFAULT_CONFIG } from "../config";
import { stringToSeed } from "../rng";
import { createSimulationApi, type SimulationApi } from "../api/simulationApi";
import type { InjectEventParams } from "../events/engine";

export interface ScenarioStep {
  atTick: number;
  type: EventType;
  params?: InjectEventParams;
}

export interface DemoScenario {
  name: string;
  description: string;
  seed: number;
  totalTicks: number;
  script: ScenarioStep[];
}

function disableScheduledEvents(config: SimulationConfig): SimulationConfig {
  return {
    ...config,
    events: {
      ...config.events,
      perTickProbability: {
        storm: 0,
        windDrop: 0,
        cloudCover: 0,
        demandSurge: 0,
        waterEmergency: 0,
        compoundCrisis: 0,
      },
    },
  };
}

const ONE_DAY_TICKS = 1440;

/**
 * Named, reproducible demo scenarios: scheduled/probabilistic events are
 * disabled (perTickProbability all zero) so the ONLY events that occur are
 * the scripted `injectEvent` calls below — the story plays out identically
 * every run for a given seed, exactly so the live demo isn't left to RNG
 * chance on which events fire or when.
 */
export const DEMO_SCENARIOS: Record<string, DemoScenario> = {
  "calm-day": {
    name: "Calm day",
    description: "A full day of smooth solar/wind/demand curves with no environmental events.",
    seed: stringToSeed("calm-day"),
    totalTicks: ONE_DAY_TICKS,
    script: [],
  },
  "storm-at-dusk": {
    name: "Storm at dusk",
    description: "A storm rolls in right at sunset, cutting solar just as demand ramps for the evening.",
    seed: stringToSeed("storm-at-dusk"),
    totalTicks: ONE_DAY_TICKS,
    script: [{ atTick: 18 * 60, type: "storm" }],
  },
  "compound-crisis": {
    name: "Compound crisis",
    description:
      "A severe afternoon storm forces correlated wind-drop and demand-surge children, tuned via forceCompound so the full cascade always plays out.",
    seed: stringToSeed("compound-crisis"),
    totalTicks: ONE_DAY_TICKS,
    script: [{ atTick: 14 * 60, type: "storm", params: { forceCompound: true } }],
  },
};

/** Runs a scenario to completion against a fresh SimulationApi and returns it. */
export function runScenario(scenario: DemoScenario): SimulationApi {
  const config = disableScheduledEvents({ ...DEFAULT_CONFIG, seed: scenario.seed });
  const api = createSimulationApi(config);

  for (let t = 1; t <= scenario.totalTicks; t++) {
    api.tick(1);
    const currentTick = api.getCurrentState().time.tick;
    for (const step of scenario.script) {
      if (step.atTick === currentTick) {
        api.injectEvent(step.type, step.params);
      }
    }
  }

  return api;
}
