/**
 * Wire types for the FastAPI telemetry contract.
 *
 * These describe the *raw* payloads as they come off the backend. They are
 * intentionally loose (most fields optional) because the backend is still being
 * built — `normalize.ts` is the single place that turns any of these into the
 * strict `IslandState` / `NimbusDecision` shapes the UI renders.
 *
 * Field names follow the agreed Nimbus telemetry vocabulary:
 *   filteredNetPowerKw, velocityKwS, accelerationKwS2, severity, trajectory
 */

import type {
  ControllerMode,
  IslandEvent,
  IslandState,
  NimbusDecision,
  ResourceId,
  ResourceState,
  SystemStatus,
  TrajectoryLabel,
} from "@/types/nimbus";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

/** One resource row as sent by the backend. */
export interface RawResource {
  id?: string;
  name?: string;
  criticality?: string;
  operatingPct?: number;
  operating_pct?: number;
  demandKw?: number;
  demand_kw?: number;
  nominalKw?: number;
  nominal_kw?: number;
  state?: string;
}

/** One chart history point as sent by the backend. */
export interface RawSample {
  t?: number;
  timestamp?: number;
  solarKw?: number;
  solar_kw?: number;
  windKw?: number;
  wind_kw?: number;
  totalDemandKw?: number;
  total_demand_kw?: number;
  netKw?: number;
  net_kw?: number;
  batteryPct?: number;
  battery_pct?: number;
}

/** The main telemetry frame. Accepts camelCase or snake_case for every field. */
export interface RawIslandState {
  timestamp?: number | string;
  controller?: string;
  activeEvent?: string | null;
  active_event?: string | null;
  status?: string;
  severity?: number | string;

  // energy — flat or nested under `energy`
  energy?: Record<string, number>;
  solarKw?: number;
  windKw?: number;
  totalGenerationKw?: number;
  totalDemandKw?: number;
  netKw?: number;
  batteryPct?: number;
  batteryEnergyKwh?: number;
  batteryCapacityKwh?: number;

  // stability — flat or nested under `stability`
  stability?: Record<string, number | string>;
  filteredNetPowerKw?: number;
  velocityKwS?: number;
  accelerationKwS2?: number;
  trajectory?: string;
  interpretation?: string;

  resources?: RawResource[];
  history?: RawSample[];

  /** Some backends embed the latest decision in the frame. */
  decision?: RawDecision;
}

export interface RawDecisionAction {
  resource?: string;
  action?: string;
}

export interface RawDecision {
  id?: string | number;
  timestamp?: number | string;
  title?: string;
  action?: string;
  explanation?: string;
  reason?: string;
  actions?: RawDecisionAction[];
  protectedResources?: string[];
  throttledResources?: string[];
  reducedResources?: string[];
  shedResources?: string[];
  expectedOutcome?: string;
  expected_outcome?: string;
}

/** WebSocket envelope. Backend may send a bare frame or a typed message. */
export interface WsMessage {
  type?:
    | "telemetry"
    | "state"
    | "decision"
    | "event_ack"
    | "controller_ack"
    | "reset_ack"
    | "error";
  payload?: RawIslandState | RawDecision | Record<string, unknown>;
  // …or the frame fields sit directly on the object (no envelope)
  [key: string]: unknown;
}

/** Everything the dashboard hook exposes to the UI. */
export interface NimbusView {
  state: IslandState;
  decision: NimbusDecision;
  /** Plain-English severity, derived from status/trajectory. */
  severityLabel: string;
  connection: ConnectionState;
  /** Which data source is currently feeding the dashboard. */
  source: "live" | "mock";
  loading: boolean;
  error: string | null;
  /** Event whose request is in flight (buttons disabled). */
  pendingEvent: IslandEvent | "reset" | null;
  /** Controller whose switch is in flight. */
  switchingController: ControllerMode | null;
  /** Transient error from the last command (event / controller / reset). */
  actionError: string | null;
  triggerEvent: (event: IslandEvent) => void;
  setController: (mode: ControllerMode) => void;
  reset: () => void;
  /** Force a reconnect attempt after going offline. */
  retry: () => void;
}

// Re-export the enums the client layer works with.
export type {
  ControllerMode,
  IslandEvent,
  ResourceId,
  ResourceState,
  SystemStatus,
  TrajectoryLabel,
};
