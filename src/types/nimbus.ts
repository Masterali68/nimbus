export type ControllerMode = "naive" | "reactive" | "nimbus";

export type ResourceId = "hospital" | "desalination" | "residential" | "resort";

export type ResourceState =
  | "PROTECTED"
  | "NORMAL"
  | "THROTTLED"
  | "REDUCED"
  | "SHED"
  | "COOLDOWN";

export type Severity = "STABLE" | "WATCH" | "WARNING" | "CRITICAL";

export type Trajectory = "STABLE" | "IMPROVING" | "DETERIORATING" | "CRITICAL";

export type ResourceAction =
  | "NONE"
  | "PROTECT"
  | "THROTTLE"
  | "REDUCE"
  | "SHED"
  | "RESTORE"
  | "COOLDOWN";

export type ReasonCode =
  | "OK_STABLE"
  | "OK_IMPROVING"
  | "WATCH_TRAJECTORY"
  | "WATCH_BATTERY"
  | "WARNING_SHED_RESORT"
  | "WARNING_THROTTLE_DESALINATION"
  | "WARNING_REDUCE_RESIDENTIAL"
  | "CRITICAL_BATTERY"
  | "CRITICAL_COLLAPSE"
  | "RECOVERY_RESTORE_DESALINATION"
  | "RECOVERY_RESTORE_RESIDENTIAL"
  | "RECOVERY_RESTORE_RESORT"
  | "COOLDOWN_HOLD";

export interface IslandResource {
  id: ResourceId;
  name: string;
  criticality: number;
  maxDemandKw: number;
  minimumOperatingPct: number;
  operatingPct: number;
  currentDemandKw: number;
  state: ResourceState;
  throttleable: boolean;
  shedCapable: boolean;
}

export type ResourceMap = Record<ResourceId, IslandResource>;

export interface IslandState {
  timestampMs: number;
  tick: number;
  activeEvent: string;
  controllerMode: ControllerMode;
  solarKw: number;
  windKw: number;
  totalGenerationKw: number;
  batteryKwh: number;
  batteryCapacityKwh: number;
  batteryPct: number;
  batteryChargeRateKw: number;
  batteryDischargeRateKw: number;
  totalDemandKw: number;
  netPowerKw: number;
  filteredNetPowerKw: number;
  velocityKwS: number;
  accelerationKwS2: number;
  resources: ResourceMap;
}

export interface NimbusDecision {
  timestampMs: number;
  controllerMode: ControllerMode;
  severity: Severity;
  trajectory: Trajectory;
  action: ResourceAction;
  reasonCode: ReasonCode;
  explanation: string;
  expectedOutcome: string;
  resourceUpdates: Partial<ResourceMap>;
}

export interface TelemetryPoint {
  timestampMs: number;
  solarKw: number;
  windKw: number;
  totalDemandKw: number;
  netPowerKw: number;
  batteryPct: number;
}