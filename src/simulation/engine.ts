import type {
  ConsumerType,
  ControlAction,
  ControlActionResult,
  ConstraintViolation,
  ControllerType,
  Decision,
  EventType,
  GenerationState,
  IslandState,
  PowerBalanceState,
  ResourceControlState,
  SimulationConfig,
} from "./types";
import { SimClock } from "./clock";
import { createRngStreams, type RngStreams } from "./rng";
import { DEFAULT_CONFIG } from "./config";
import { stepSolar } from "./models/solar";
import { stepWind } from "./models/wind";
import { resolveBattery } from "./models/battery";
import { stepDemand } from "./models/demand";
import { computePowerBalance } from "./constraints/powerBalance";
import { computeWaterBalance } from "./constraints/waterBalance";
import { EventsEngine, type InjectEventParams } from "./events/engine";
import { assembleIslandState, createEmptyIslandState } from "./state/islandState";
import { History } from "./state/history";
import { stepTrajectory } from "./trajectory";
import type { Controller, ControllerContext } from "./controllers/types";
import { NaiveController } from "./controllers/naive";
import { NimbusController } from "./controllers/nimbus";

export type Subscriber = (state: IslandState, meta: { ticksAdvanced: number }) => void;

const NON_SHEDDABLE: ReadonlySet<ConsumerType> = new Set(["hospital"]);

interface ResourceOverride {
  operatingPct: number;
  state: ResourceControlState;
}

/**
 * The tick pipeline orchestrator. Pull-based and interval-free by design: no
 * setInterval/requestAnimationFrame anywhere here, so `tick(n)` synchronously
 * runs n ticks and is trivially testable (e.g. `engine.tick(1440)` for a full
 * simulated day, instantly, with zero fake-timer setup). Real-time driving
 * for the browser lives entirely in api/autoTick.ts.
 */
export class SimulationEngine {
  private readonly config: SimulationConfig;
  private readonly clock: SimClock;
  private readonly streams: RngStreams;
  private readonly eventsEngine = new EventsEngine();
  private readonly history: History;
  private readonly subscribers = new Set<Subscriber>();
  private readonly controllers: Partial<Record<ControllerType, Controller>>;

  private currentState: IslandState;

  // Carry-over state not fully captured by the public IslandState snapshot.
  private cloudBaselineFactor: number;
  private windSpeedMps: number;
  private socKwh: number;
  private cyclesAccumulated = 0;
  private reservoirLevelM3: number;
  private prevFilteredNetPowerKw: number | null = null;
  private prevVelocityKwPerS = 0;

  // Control boundary state. Battery/resource overrides are one-shot (consumed the very next
  // tick, on top of whatever the active controller decided that same tick).
  private pendingBatteryOverrideKw: number | null = null;
  private pendingResourceOverrides: Partial<Record<ConsumerType, ResourceOverride>> = {};

  constructor(config: SimulationConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.clock = new SimClock(config.tickLengthMinutes, config.yearLengthDays);
    this.streams = createRngStreams(config.seed);
    this.history = new History(config.events.historyLength);
    this.cloudBaselineFactor = config.solar.baselineCloudMean;
    this.windSpeedMps = config.wind.ouMeanMps;
    this.socKwh = config.battery.capacityKwh * config.battery.initialSocFraction;
    this.reservoirLevelM3 = config.water.initialReservoirLevelM3;
    this.currentState = createEmptyIslandState(config.seed);
    this.controllers = {
      naive: new NaiveController(),
      nimbus: new NimbusController(config.controllers.nimbus),
    };
    if (!this.controllers[config.controllers.activeControllerType]) {
      throw new Error(
        `ControllerType '${config.controllers.activeControllerType}' is not implemented in this build.`
      );
    }
  }

  getCurrentState(): IslandState {
    return this.currentState;
  }

  getHistory(window?: number): IslandState[] {
    return this.history.getHistory(window);
  }

  getTickRate(): number {
    return this.clock.getTickRate();
  }

  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  tick(n = 1): IslandState {
    for (let i = 0; i < n; i++) {
      this.stepOnce();
    }
    return this.currentState;
  }

  injectEvent(type: EventType, params?: InjectEventParams): void {
    const tick = this.clock.getTime().tick;
    this.eventsEngine.injectEvent(
      type,
      tick,
      this.streams.eventsScheduler,
      this.streams.eventsCompound,
      this.config.events,
      params
    );
  }

  /**
   * The single validated write boundary for other modules (e.g. a human operator overriding the
   * active controller). Every action is a one-tick override on top of whatever the active
   * controller decides that same tick — if no override is queued for a given tick, the active
   * controller's own decision runs, full stop; see README.md.
   */
  applyControlAction(action: ControlAction): ControlActionResult {
    switch (action.type) {
      case "battery.setChargeRate": {
        if (typeof action.requestedKw !== "number" || !Number.isFinite(action.requestedKw)) {
          return { accepted: false, reason: "requestedKw must be a finite number.", violations: [] };
        }
        this.pendingBatteryOverrideKw = action.requestedKw;
        return { accepted: true, appliedKw: action.requestedKw, violations: [] };
      }
      case "battery.hold": {
        this.pendingBatteryOverrideKw = 0;
        return { accepted: true, appliedKw: 0, violations: [] };
      }
      case "load.shed": {
        if (!action.consumer || NON_SHEDDABLE.has(action.consumer)) {
          return { accepted: false, reason: "hospital load is non-sheddable.", violations: [] };
        }
        const fraction = action.fractionToShed ?? 1;
        if (fraction < 0 || fraction > 1) {
          return { accepted: false, reason: "fractionToShed must be within [0, 1].", violations: [] };
        }
        this.pendingResourceOverrides[action.consumer] = {
          operatingPct: (1 - fraction) * 100,
          state: fraction >= 1 ? "SHED" : fraction > 0 ? "THROTTLED" : "NORMAL",
        };
        return { accepted: true, violations: [] };
      }
      case "load.restore": {
        if (!action.consumer) {
          return { accepted: false, reason: "consumer is required for load.restore.", violations: [] };
        }
        this.pendingResourceOverrides[action.consumer] = { operatingPct: 100, state: "NORMAL" };
        return { accepted: true, violations: [] };
      }
      case "desalination.curtail": {
        const fraction = action.fractionToShed ?? 1;
        if (fraction < 0 || fraction > 1) {
          return { accepted: false, reason: "fractionToShed must be within [0, 1].", violations: [] };
        }
        this.pendingResourceOverrides.desalination = {
          operatingPct: (1 - fraction) * 100,
          state: fraction > 0 ? "THROTTLED" : "NORMAL",
        };
        return { accepted: true, violations: [] };
      }
      default:
        return { accepted: false, reason: `Unknown ControlAction type.`, violations: [] };
    }
  }

  private stepOnce(): void {
    const time = this.clock.advance(1);
    const modifiers = this.eventsEngine.step(time.tick, this.streams, this.config.events);

    const solarResult = stepSolar(
      time,
      modifiers,
      this.cloudBaselineFactor,
      this.streams.solarCloud,
      this.config.solar
    );
    this.cloudBaselineFactor = solarResult.nextCloudBaselineFactor;

    const windResult = stepWind(this.windSpeedMps, modifiers, this.streams.windSpeed, this.config.wind);
    this.windSpeedMps = windResult.nextWindSpeedMps;

    const demand = stepDemand(time, modifiers, this.streams, this.config);
    const renewablesKw = solarResult.state.outputKw + windResult.state.outputKw;

    // Trajectory signal: the raw physical trend (unconstrained demand), computed BEFORE any
    // controller intervention, so it reflects the underlying disturbance rather than the
    // controller's own corrective actions.
    const netPowerKw = renewablesKw - demand.totalMaxDemandKw;
    if (this.prevFilteredNetPowerKw === null) {
      this.prevFilteredNetPowerKw = netPowerKw;
    }
    const energyBalance = stepTrajectory({
      netPowerKw,
      prevFilteredNetPowerKw: this.prevFilteredNetPowerKw,
      prevVelocityKwPerS: this.prevVelocityKwPerS,
      tickLengthMinutes: this.config.tickLengthMinutes,
      config: this.config.trajectory,
    });
    this.prevFilteredNetPowerKw = energyBalance.filteredNetPowerKw;
    this.prevVelocityKwPerS = energyBalance.velocityKwPerS;

    const controller = this.controllers[this.config.controllers.activeControllerType];
    if (!controller) {
      throw new Error(`ControllerType '${this.config.controllers.activeControllerType}' is not implemented.`);
    }
    const context: ControllerContext = {
      tick: time.tick,
      demand,
      batteryPrevSocFraction: this.socKwh / this.config.battery.capacityKwh,
      energyBalance,
      config: this.config,
    };
    const controllerOutput = controller.decide(context);

    for (const resourceDecision of controllerOutput.resourceDecisions) {
      applyOperatingPct(demand, resourceDecision.consumer, resourceDecision.operatingPct, resourceDecision.state);
    }
    for (const [consumer, override] of Object.entries(this.pendingResourceOverrides) as [
      ConsumerType,
      ResourceOverride,
    ][]) {
      applyOperatingPct(demand, consumer, override.operatingPct, override.state);
    }
    const latestDecisions: Decision[] = controllerOutput.decisions;
    this.pendingResourceOverrides = {};

    const batteryOverride = this.pendingBatteryOverrideKw ?? controllerOutput.batteryRequestedKw;
    this.pendingBatteryOverrideKw = null;

    const batteryResult = resolveBattery({
      prevSocKwh: this.socKwh,
      prevCyclesAccumulated: this.cyclesAccumulated,
      totalSupplyKw: renewablesKw,
      totalDemandKw: demand.totalDemandKw,
      controlOverrideRequestedKw: batteryOverride,
      tickLengthMinutes: this.config.tickLengthMinutes,
      config: this.config.battery,
    });
    this.socKwh = batteryResult.state.socKwh;
    this.cyclesAccumulated = batteryResult.state.cyclesAccumulated;

    const generation: GenerationState = {
      solar: solarResult.state,
      wind: windResult.state,
      battery: batteryResult.state,
      totalSupplyKw: renewablesKw + Math.max(0, -batteryResult.state.chargeRateKw),
    };

    const balanceResult = computePowerBalance({
      solarOutputKw: solarResult.state.outputKw,
      windOutputKw: windResult.state.outputKw,
      batteryChargeRateKw: batteryResult.state.chargeRateKw,
      demand,
    });

    const waterResult = computeWaterBalance({
      desalination: demand.desalination,
      desalinationCapacityM3PerHour: this.config.demand.desalination.capacityM3PerHour,
      desalinationOutageFraction: modifiers.desalinationOutageFraction,
      prevReservoirLevelM3: this.reservoirLevelM3,
      tickLengthMinutes: this.config.tickLengthMinutes,
      config: this.config.water,
    });
    this.reservoirLevelM3 = waterResult.water.reservoirLevelM3;

    const violations: ConstraintViolation[] = [
      ...batteryResult.violations,
      ...balanceResult.violations,
      ...waterResult.violations,
    ];
    const balance: PowerBalanceState = { ...balanceResult, violations };

    const state = assembleIslandState({
      time,
      generation,
      demand,
      water: waterResult.water,
      balance,
      energyBalance,
      activeEvents: this.eventsEngine.getActiveEvents().map((event) => ({ ...event })),
      latestDecisions,
      seed: this.config.seed,
    });

    this.currentState = state;
    this.history.push(state);

    for (const callback of this.subscribers) {
      try {
        callback(state, { ticksAdvanced: 1 });
      } catch (err) {
        console.error("Nimbus simulation subscriber threw:", err);
      }
    }
  }
}

function applyOperatingPct(
  demand: ControllerContext["demand"],
  consumer: ConsumerType,
  operatingPct: number,
  state: ResourceControlState
): void {
  if (consumer === "hospital") return; // hospital is PROTECTED and never touched, even by an override.
  const target = demand[consumer];
  target.operatingPct = operatingPct;
  target.state = state;
  target.currentDemandKw = target.maxDemandKw * (operatingPct / 100);
}
