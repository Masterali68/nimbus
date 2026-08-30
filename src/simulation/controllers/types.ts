import type {
  ConsumerType,
  ControllerType,
  Decision,
  DemandState,
  EnergyBalanceState,
  ResourceControlState,
  SimulationConfig,
} from "../types";

export interface ControllerContext {
  tick: number;
  /** Demand BEFORE any controller decision this tick: every consumer at operatingPct=100,
   * currentDemandKw=maxDemandKw. The controller decides deltas from this baseline. */
  demand: DemandState;
  /** Previous tick's battery SoC fraction (this tick's battery hasn't resolved yet). */
  batteryPrevSocFraction: number;
  energyBalance: EnergyBalanceState;
  config: SimulationConfig;
}

export interface ResourceDecision {
  consumer: ConsumerType;
  operatingPct: number;
  state: ResourceControlState;
}

export interface ControllerOutput {
  /** Only for consumers being changed from the operatingPct=100/NORMAL default; consumers not
   * listed stay at the default (hospital is never listed — PROTECTED is set upstream). */
  resourceDecisions: ResourceDecision[];
  /** null => defer to the raw default dispatch heuristic in models/battery.ts. */
  batteryRequestedKw: number | null;
  decisions: Decision[];
}

export interface Controller {
  readonly type: ControllerType;
  decide(context: ControllerContext): ControllerOutput;
}
