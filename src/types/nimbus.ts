/**
 * Nimbus shared contract — Phase 1.
 *
 * Frontend (feat/ui-dashboard) uses these types to drive the mock telemetry
 * source. They are the strawman for the real IslandState / NimbusDecision that
 * Ali (decision engine) and Vishruth (backend) will produce. Reconcile with Ali
 * before backend integration — do not change field names here unilaterally once
 * the engine branch adopts them.
 */

export type ControllerMode = "naive" | "reactive" | "nimbus";

export type SystemStatus = "stable" | "watch" | "warning" | "critical";

export type IslandEvent =
  | "storm"
  | "cloud_cover"
  | "wind_drop"
  | "tourist_surge"
  | "water_emergency"
  | "compound_crisis";

export type ResourceId = "hospital" | "desalination" | "residential" | "resort";

/** Importance ladder, independent of the current alarm colour. */
export type ResourceCriticality = "vital" | "high" | "standard" | "deferrable";

export type ResourceState =
  | "protected"
  | "normal"
  | "throttled"
  | "reduced"
  | "shed"
  | "cooldown";

export type TrajectoryLabel = "stable" | "improving" | "deteriorating" | "critical";

export interface EnergyMetrics {
  solarKw: number;
  windKw: number;
  totalGenerationKw: number;
  totalDemandKw: number;
  /** Signed: generation minus demand. Negative = battery discharging. */
  netKw: number;
  batteryPct: number;
  batteryEnergyKwh: number;
  batteryCapacityKwh: number;
}

export interface StabilityMetrics {
  /** Filtered (smoothed) net power. */
  energyBalanceKw: number;
  /** Change in energy balance per sim-minute. */
  velocity: number;
  /** Change in velocity per sim-minute. */
  acceleration: number;
  trajectory: TrajectoryLabel;
  interpretation: string;
}

export interface ResourceStatus {
  id: ResourceId;
  name: string;
  criticality: ResourceCriticality;
  /** 0–100, share of desired draw the controller is currently allowing. */
  operatingPct: number;
  demandKw: number;
  /** 100%-draw reference for this resource. */
  nominalKw: number;
  state: ResourceState;
}

export interface TelemetrySample {
  t: number;
  solarKw: number;
  windKw: number;
  totalDemandKw: number;
  netKw: number;
  batteryPct: number;
}

export interface IslandState {
  timestamp: number;
  controller: ControllerMode;
  activeEvent: IslandEvent | null;
  status: SystemStatus;
  energy: EnergyMetrics;
  stability: StabilityMetrics;
  resources: ResourceStatus[];
  history: TelemetrySample[];
}

export interface DecisionAction {
  resource: ResourceId;
  action: string;
}

export interface NimbusDecision {
  id: string;
  timestamp: number;
  title: string;
  explanation: string;
  actions: DecisionAction[];
  protectedResources: ResourceId[];
  throttledResources: ResourceId[];
  reducedResources: ResourceId[];
  shedResources: ResourceId[];
  expectedOutcome: string;
}
