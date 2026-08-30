// Shared contract types for the Nimbus simulation engine.
// Other Nimbus modules (control/optimizer, UI, scoring) should depend only on
// this file and `api/simulationApi.ts` — not on internal model implementations.

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export interface SimTime {
  tick: number;
  minutesElapsed: number;
  dayIndex: number;
  minuteOfDay: number;
  hourOfDay: number;
  dayOfWeek: number;
  isWeekend: boolean;
  /** Smooth 0..1 sinusoid over `config.yearLengthDays`, used to modulate solar output. */
  seasonalFactor: number;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface SolarState {
  outputKw: number;
  installedCapacityKw: number;
  /** Effective 0..1 cloud cover this tick (base curve + event modifiers). 0 = clear sky. */
  cloudCoverFactor: number;
  /** Diagnostic: what output would be with cloudCoverFactor = 0. */
  theoreticalClearSkyKw: number;
}

export type TurbineRegime = "below-cutin" | "ramping" | "rated" | "cutout";

export interface WindState {
  outputKw: number;
  installedCapacityKw: number;
  windSpeedMps: number;
  turbineRegime: TurbineRegime;
}

export interface BatteryState {
  socKwh: number;
  capacityKwh: number;
  socFraction: number;
  /** Signed, post-clamp actual rate this tick: positive = charging, negative = discharging. */
  chargeRateKw: number;
  /** Signed, pre-clamp requested rate (from a ControlAction or the default dispatch heuristic). */
  requestedRateKw: number;
  maxChargeRateKw: number;
  maxDischargeRateKw: number;
  roundTripEfficiency: number;
  /** Stretch/diagnostic: accumulated charge/discharge cycles, for future degradation modeling. */
  cyclesAccumulated: number;
}

export interface GenerationState {
  solar: SolarState;
  wind: WindState;
  battery: BatteryState;
  /** solar + wind + (battery discharge, if chargeRateKw is negative). */
  totalSupplyKw: number;
}

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------

export type ConsumerType = "hospital" | "desalination" | "residential" | "resort";

/**
 * NORMAL: full operatingPct, no intervention. THROTTLED: continuously
 * PD-controlled partial reduction (desalination). REDUCED: a coarser
 * controller-driven cut (e.g. residential). SHED: fully cut off via a
 * hysteresis state machine. COOLDOWN: recently restored, ineligible to be
 * shed again until a cooldown elapses. PROTECTED: never touched by any
 * controller (hospital only).
 */
export type ResourceControlState = "NORMAL" | "THROTTLED" | "REDUCED" | "SHED" | "COOLDOWN" | "PROTECTED";

export interface ConsumerDemandState {
  /** Actual power drawn this tick: maxDemandKw * operatingPct / 100. */
  currentDemandKw: number;
  /** Unconstrained baseline + noise + event-surge request this tick, at operatingPct = 100. */
  maxDemandKw: number;
  /** Floor below which this resource cannot be reduced further while still operating. */
  minOperatingLevelKw: number;
  /** 0-100. Hospital 100 (never touched), Desalination 90, Residential 70, Resort 20 by default. */
  criticalityScore: number;
  continuouslyThrottleable: boolean;
  shedCapable: boolean;
  /** 0-100, how much of maxDemandKw is actually being drawn this tick. */
  operatingPct: number;
  state: ResourceControlState;
}

export interface DesalinationDemandState extends ConsumerDemandState {
  /** Target water demand at operatingPct = 100. */
  waterDemandM3PerHour: number;
  /** Requested/theoretical output at operatingPct = 100 — constraints/waterBalance.ts scales this
   * by operatingPct and plant capacity to get the authoritative achievable output. */
  waterOutputM3PerHour: number;
}

export interface DemandState {
  hospital: ConsumerDemandState;
  desalination: DesalinationDemandState;
  residential: ConsumerDemandState;
  resort: ConsumerDemandState;
  /** Sum of currentDemandKw — actual demand after controller intervention. */
  totalDemandKw: number;
  /** Sum of maxDemandKw — the unconstrained request, independent of any controller decision. */
  totalMaxDemandKw: number;
  /** Sum of maxDemandKw across shedCapable consumers only (informational headroom, not a decision). */
  totalSheddableKw: number;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

export interface WaterState {
  desalinationOutputM3PerHour: number;
  desalinationCapacityM3PerHour: number;
  reservoirLevelM3: number;
  reservoirCapacityM3: number;
  demandM3PerHour: number;
  /** output - demand. Can be negative. */
  balanceM3PerHour: number;
  /** max(0, demand - output). Never silently absorbed. */
  deficitM3PerHour: number;
}

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

export type ViolationCode =
  | "BATTERY_SOC_CLAMPED"
  | "BATTERY_RATE_CLAMPED"
  | "GEN_CAPACITY_CLAMPED"
  | "WATER_CAPACITY_CLAMPED"
  | "UNMET_DEMAND";

export interface ConstraintViolation {
  code: ViolationCode;
  message: string;
  /** How far the requested value exceeded the bound (same units as the underlying quantity). */
  magnitude: number;
}

export interface PowerBalanceState {
  totalGenerationKw: number;
  totalDemandKw: number;
  /** Positive = battery discharging into grid, negative = charging from surplus. */
  batteryNetKw: number;
  /** Can be negative. */
  surplusKw: number;
  /** max(0, demand - generation - discharge). Never silently fabricated. */
  deficitKw: number;
  /** totalMaxDemandKw - totalDemandKw: a measurement of how much is currently curtailed relative
   * to unconstrained demand, not a decision — resource shedding/throttling is decided upstream by
   * the active controller (see controllers/), not here. */
  sheddedKw: number;
  violations: ConstraintViolation[];
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventType =
  | "storm"
  | "windDrop"
  | "cloudCover"
  | "demandSurge"
  | "waterEmergency"
  | "compoundCrisis";

export type EventPhase = "watch" | "onset" | "peak" | "recovery" | "resolved";

export interface SimEvent {
  id: string;
  type: EventType;
  phase: EventPhase;
  /** Overall magnitude, 0..1, independent of current phase. */
  severity: number;
  startedAtTick: number;
  phaseStartedAtTick: number;
  watchDurationTicks: number;
  onsetDurationTicks: number;
  peakDurationTicks: number;
  recoveryDurationTicks: number;
  /** Set on children spawned by compound-crisis orchestration; null for root events. */
  parentEventId: string | null;
  /** Set on the parent/orchestrator event; empty for leaf events. */
  childEventIds: string[];
  metadata: Record<string, unknown>;
  source: "scheduled" | "manual";
}

export interface EnvironmentalModifiers {
  /** Additive; combines across simultaneous events by summing. */
  cloudCoverDelta: number;
  /** Additive shift to the wind OU process's mean-reversion target. */
  windMeanShiftMps: number;
  /** Multiplicative; combines across simultaneous events by multiplying. */
  windVolatilityMultiplier: number;
  /** Additive per consumer; combines across simultaneous events by summing. */
  demandSurgeKw: Partial<Record<ConsumerType, number>>;
  /** 0..1 fraction of desalination capacity knocked out this tick. */
  desalinationOutageFraction: number;
  waterContaminationFlag: boolean;
}

// ---------------------------------------------------------------------------
// Trajectory (early-detection signal)
// ---------------------------------------------------------------------------

export interface EnergyBalanceState {
  /** Raw generation - demand this tick, using unconstrained (maxDemandKw) demand — reflects the
   * underlying physical trend, not the controller's own corrective actions. */
  netPowerKw: number;
  /** EMA-smoothed netPowerKw. */
  filteredNetPowerKw: number;
  /** d(filteredNetPowerKw)/dt, kW per second. */
  velocityKwPerS: number;
  /** d(velocityKwPerS)/dt, kW per second^2. */
  accelerationKwPerS2: number;
  trajectory: "STABLE" | "IMPROVING" | "DETERIORATING";
}

// ---------------------------------------------------------------------------
// Controllers & explainability
// ---------------------------------------------------------------------------

export type ControllerType = "naive" | "reactive" | "nimbus";

// ---------------------------------------------------------------------------
// Climate presets
// ---------------------------------------------------------------------------

/** Named, real-data-grounded environmental profiles — see climates.ts for the sourced values. */
export type ClimateType =
  | "tropical-trade-wind-island"
  | "arid-desert-coast"
  | "temperate-coastal"
  | "monsoon-tropical";

export interface Decision {
  timestamp: number;
  tick: number;
  controllerType: ControllerType;
  /** e.g. "throttle_desalination", "shed_resort". */
  action: string;
  /** One-line machine-ish summary, e.g. "rapid_generation_loss". */
  reasonSummary: string;
  /** Plain-language bullet lines for a "Why?" panel — no control-theory jargon. */
  reasonDetail: string[];
  affectedResource?: ConsumerType | "battery";
}

// ---------------------------------------------------------------------------
// Top-level snapshot
// ---------------------------------------------------------------------------

export interface IslandState {
  time: SimTime;
  generation: GenerationState;
  demand: DemandState;
  water: WaterState;
  balance: PowerBalanceState;
  energyBalance: EnergyBalanceState;
  activeEvents: SimEvent[];
  /** Decisions the active controller made this tick (empty most ticks — only populated when a
   * resource's state actually changes). */
  latestDecisions: Decision[];
  seed: number;
  version: number;
}

// ---------------------------------------------------------------------------
// Control boundary
// ---------------------------------------------------------------------------

export type ControlActionType =
  | "battery.setChargeRate"
  | "battery.hold"
  | "load.shed"
  | "load.restore"
  | "desalination.curtail";

export interface ControlAction {
  type: ControlActionType;
  /** battery.setChargeRate: positive = charge, negative = discharge. */
  requestedKw?: number;
  /** load.shed / load.restore / desalination.curtail target. Never "hospital" for load.shed. */
  consumer?: ConsumerType;
  /** 0..1, for load.shed / desalination.curtail. */
  fractionToShed?: number;
  /** Caller identifier, e.g. "optimizer-v1". */
  source: string;
  issuedAtTick?: number;
}

export interface ControlActionResult {
  accepted: boolean;
  appliedKw?: number;
  reason?: string;
  violations: ConstraintViolation[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SolarConfig {
  installedCapacityKw: number;
  sunriseHour: number;
  sunsetHour: number;
  /** Amplitude of the seasonal sinusoid's effect on peak output, 0..1. */
  seasonalAmplitude: number;
  /** Long-run mean of the everyday (non-event) cloud-cover OU process, 0..1. Climate-specific —
   * e.g. near-zero for arid deserts, higher for humid tropics/monsoon. */
  baselineCloudMean: number;
  /** Ornstein-Uhlenbeck mean-reversion rate for the baseline cloud process, per tick. */
  baselineCloudTheta: number;
  /** Ornstein-Uhlenbeck volatility for the baseline cloud process, per tick. */
  baselineCloudSigma: number;
}

export interface WindConfig {
  installedCapacityKw: number;
  cutInMps: number;
  ratedMps: number;
  cutOutMps: number;
  /** Ornstein-Uhlenbeck mean-reversion rate, per tick. */
  ouTheta: number;
  /** Ornstein-Uhlenbeck volatility, per tick. */
  ouSigma: number;
  /** Ornstein-Uhlenbeck long-run mean wind speed, m/s. */
  ouMeanMps: number;
}

export interface BatteryConfig {
  capacityKwh: number;
  maxChargeRateKw: number;
  maxDischargeRateKw: number;
  /**
   * Round-trip efficiency, 0..1. Modeling simplification: loss is applied
   * entirely on charge (energyStored = energyIn * roundTripEfficiency);
   * discharge returns stored energy lossless. This means energyStored on a
   * charge tick and energyDischarged later will NOT sum back to energyIn in
   * an obviously-conserved way when eyeballed from the history log — see the
   * matching note in models/battery.ts at the point the loss is applied.
   */
  roundTripEfficiency: number;
  initialSocFraction: number;
  /**
   * Default auto-dispatch heuristic deadband: when no ControlAction is
   * queued for a tick, |netKw| at or below this threshold holds rather than
   * charging/discharging, to prevent tick-to-tick flapping near zero net power.
   */
  dispatchDeadbandKw: number;
}

export interface HospitalDemandConfig {
  baselineKw: number;
  noiseStdKw: number;
}

export interface DesalinationDemandConfig {
  baselineKw: number;
  noiseStdKw: number;
  capacityM3PerHour: number;
  kwhPerM3: number;
}

export interface ResidentialDemandConfig {
  baselineKw: number;
  noiseStdKw: number;
  morningPeakHour: number;
  eveningPeakHour: number;
  weekendMultiplier: number;
}

export interface ResortDemandConfig {
  baselineKw: number;
  noiseStdKw: number;
  daytimePeakHour: number;
  eveningPeakHour: number;
}

export interface WaterConfig {
  reservoirCapacityM3: number;
  initialReservoirLevelM3: number;
}

export interface EventEngineConfig {
  /** Per-tick trigger probability by event type, tuned for a 1-min tick over a multi-day demo. */
  perTickProbability: Record<EventType, number>;
  /** Severity threshold above which a storm spawns correlated child events. */
  compoundSeverityThreshold: number;
  historyLength: number;
}

export interface TrajectoryConfig {
  /** EMA smoothing factor, 0..1 (higher = more responsive/less smooth). */
  emaAlpha: number;
  /** velocityKwPerS below this (negative) threshold classifies trajectory as DETERIORATING. */
  velocityDeterioratingThresholdKwPerS: number;
  /** velocityKwPerS above this (positive) threshold classifies trajectory as IMPROVING. */
  velocityImprovingThresholdKwPerS: number;
}

export interface PdConfig {
  /** Proportional gain. */
  kp: number;
  /** Derivative gain. */
  kd: number;
  targetNetPowerKw: number;
  /** Output floor, 0..100 — the controlled resource is never throttled below this operatingPct. */
  minOperatingPct: number;
}

/** Generic mechanism (min-cooldown-ticks); domain-specific trigger/recovery thresholds live on
 * the calling controller's own config section, not here. */
export interface HysteresisConfig {
  minCooldownTicks: number;
}

export interface NaiveControllerConfig {
  shedResortBelowSocPct: number;
  restoreResortAboveSocPct: number;
  shedResidentialBelowSocPct: number;
  restoreResidentialAboveSocPct: number;
}

export interface NimbusControllerConfig {
  desalinationPd: PdConfig;
  residentialReducedOperatingPct: number;
  residentialReduceBelowSocPct: number;
  residentialRestoreAboveSocPct: number;
  resortHysteresis: HysteresisConfig;
  resortShedBelowSocPct: number;
  resortRestoreAboveSocPct: number;
  /** Minimum ticks between sequential restoration steps, so recovery is orderly (one resource at
   * a time), never simultaneous. */
  restorationCooldownTicks: number;
}

export interface ControllersConfig {
  activeControllerType: ControllerType;
  naive: NaiveControllerConfig;
  nimbus: NimbusControllerConfig;
}

export interface SimulationConfig {
  seed: number;
  tickLengthMinutes: number;
  yearLengthDays: number;
  solar: SolarConfig;
  wind: WindConfig;
  battery: BatteryConfig;
  demand: {
    hospital: HospitalDemandConfig;
    desalination: DesalinationDemandConfig;
    residential: ResidentialDemandConfig;
    resort: ResortDemandConfig;
  };
  water: WaterConfig;
  events: EventEngineConfig;
  trajectory: TrajectoryConfig;
  controllers: ControllersConfig;
}
