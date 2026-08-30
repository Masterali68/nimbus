import type {
  ControlAction,
  ControlActionResult,
  EventType,
  IslandState,
  SimulationConfig,
} from "../types";
import { DEFAULT_CONFIG } from "../config";
import { SimulationEngine, type Subscriber } from "../engine";
import { createAutoTick } from "./autoTick";
import type { InjectEventParams } from "../events/engine";

export type { Subscriber } from "../engine";
export type { InjectEventParams } from "../events/engine";

/**
 * Public facade — the only surface other Nimbus modules (control/optimizer,
 * UI, scoring) should depend on. Internal model files are not a stable
 * contract; this interface and `types.ts` are. See README.md for the full
 * usage contract, including the "no ControlAction queued this tick -> default
 * heuristic dispatch runs" note.
 */
export interface SimulationApi {
  getCurrentState(): IslandState;
  getHistory(window?: number): IslandState[];
  subscribe(callback: Subscriber): () => void;
  tick(n?: number): IslandState;
  /** simulated minutes advanced per real second, for startAutoTick/already-running auto-tick. */
  setSpeed(speedMultiplier: number): void;
  startAutoTick(speedMultiplier?: number): void;
  stopAutoTick(): void;
  isAutoTicking(): boolean;
  injectEvent(type: EventType, params?: InjectEventParams): void;
  applyControlAction(action: ControlAction): ControlActionResult;
  getSeed(): number;
  getTickRate(): number;
}

export function createSimulationApi(config: SimulationConfig = DEFAULT_CONFIG): SimulationApi {
  const engine = new SimulationEngine(config);
  const autoTick = createAutoTick(engine);

  return {
    getCurrentState: () => engine.getCurrentState(),
    getHistory: (window) => engine.getHistory(window),
    subscribe: (callback) => engine.subscribe(callback),
    tick: (n) => engine.tick(n),
    setSpeed: (speedMultiplier) => autoTick.setSpeed(speedMultiplier),
    startAutoTick: (speedMultiplier) => autoTick.start(speedMultiplier),
    stopAutoTick: () => autoTick.stop(),
    isAutoTicking: () => autoTick.isRunning(),
    injectEvent: (type, params) => engine.injectEvent(type, params),
    applyControlAction: (action) => engine.applyControlAction(action),
    getSeed: () => config.seed,
    getTickRate: () => engine.getTickRate(),
  };
}

/** Client-side singleton, ready to import directly by a React Client Component. */
export const simulationApi = createSimulationApi();
