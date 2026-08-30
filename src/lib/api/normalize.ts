/**
 * The one place that knows the raw backend shape.
 *
 * `normalizeIslandState` / `normalizeDecision` accept anything loosely matching
 * the Nimbus telemetry contract (camelCase or snake_case, flat or nested,
 * missing fields) and return the strict `IslandState` / `NimbusDecision` the UI
 * renders. If Vishruth's field names change, this file is the only edit.
 */

import type {
  ControllerMode,
  IslandEvent,
  IslandState,
  NimbusDecision,
  ResourceId,
  ResourceState,
  ResourceStatus,
  SystemStatus,
  TelemetrySample,
  TrajectoryLabel,
} from "@/types/nimbus";
import {
  RESOURCE_CRITICALITY,
  RESOURCE_LABEL,
  RESOURCE_NOMINAL_KW,
  TRAJECTORY_INTERPRETATION,
} from "./catalog";
import { HISTORY_LIMIT } from "./config";
import type { RawDecision, RawIslandState, RawResource, RawSample } from "./types";

const RESOURCE_ORDER: ResourceId[] = [
  "hospital",
  "desalination",
  "residential",
  "resort",
];

const CONTROLLERS: ControllerMode[] = ["naive", "reactive", "nimbus"];
const EVENTS: IslandEvent[] = [
  "storm",
  "cloud_cover",
  "wind_drop",
  "tourist_surge",
  "water_emergency",
  "compound_crisis",
];
const STATUSES: SystemStatus[] = ["stable", "watch", "warning", "critical"];
const RESOURCE_STATES: ResourceState[] = [
  "protected",
  "normal",
  "throttled",
  "reduced",
  "shed",
  "cooldown",
];
const TRAJECTORIES: TrajectoryLabel[] = [
  "stable",
  "improving",
  "deteriorating",
  "critical",
];

/** First finite number among the candidates, else `fallback`. */
function num(fallback: number, ...candidates: Array<number | undefined | null>): number {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  return fallback;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function toMs(v: number | string | undefined): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    // seconds → ms if it looks like a UNIX seconds value
    return v > 0 && v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  }
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return typeof v === "string" && (list as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

function normalizeResource(id: ResourceId, raw: RawResource | undefined): ResourceStatus {
  const nominalKw = num(
    RESOURCE_NOMINAL_KW[id],
    raw?.nominalKw,
    raw?.nominal_kw,
  );
  const operatingPct = Math.round(
    Math.max(0, Math.min(100, num(100, raw?.operatingPct, raw?.operating_pct))),
  );
  const state = oneOf(RESOURCE_STATES, raw?.state, "normal");
  const demandKw = round1(
    num((nominalKw * operatingPct) / 100, raw?.demandKw, raw?.demand_kw),
  );
  return {
    id,
    name: raw?.name || RESOURCE_LABEL[id],
    criticality: oneOf(
      ["vital", "high", "standard", "deferrable"] as const,
      raw?.criticality,
      RESOURCE_CRITICALITY[id],
    ),
    operatingPct,
    demandKw,
    nominalKw: round1(nominalKw),
    state,
  };
}

function normalizeResources(raw: RawResource[] | undefined): ResourceStatus[] {
  const byId = new Map<string, RawResource>();
  for (const r of raw ?? []) {
    if (r && typeof r.id === "string") byId.set(r.id, r);
  }
  return RESOURCE_ORDER.map((id) => normalizeResource(id, byId.get(id)));
}

function normalizeSample(raw: RawSample, index: number): TelemetrySample {
  return {
    t: num(index, raw.t, raw.timestamp),
    solarKw: round1(num(0, raw.solarKw, raw.solar_kw)),
    windKw: round1(num(0, raw.windKw, raw.wind_kw)),
    totalDemandKw: round1(num(0, raw.totalDemandKw, raw.total_demand_kw)),
    netKw: round1(num(0, raw.netKw, raw.net_kw)),
    batteryPct: round1(num(0, raw.batteryPct, raw.battery_pct)),
  };
}

export function normalizeHistory(raw: RawSample[] | undefined): TelemetrySample[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeSample).slice(-HISTORY_LIMIT);
}

function deriveStatus(netKw: number, batteryPct: number, event: IslandEvent | null): SystemStatus {
  if (batteryPct < 18 || netKw < -40) return "critical";
  if (batteryPct < 32 || netKw < -12) return "warning";
  if (event || netKw < -2) return "watch";
  return "stable";
}

function deriveTrajectory(balance: number, velocity: number): TrajectoryLabel {
  if (balance < -38) return "critical";
  if (velocity > 1.2) return "improving";
  if (balance < -8 || velocity < -1.5) return "deteriorating";
  return "stable";
}

export function normalizeIslandState(raw: RawIslandState): IslandState {
  const energy = raw.energy ?? {};
  const stability = raw.stability ?? {};

  const solarKw = round1(num(0, raw.solarKw, energy.solarKw, energy.solar_kw));
  const windKw = round1(num(0, raw.windKw, energy.windKw, energy.wind_kw));
  const totalGenerationKw = round1(
    num(solarKw + windKw, raw.totalGenerationKw, energy.totalGenerationKw, energy.total_generation_kw),
  );
  const totalDemandKw = round1(
    num(0, raw.totalDemandKw, energy.totalDemandKw, energy.total_demand_kw),
  );
  const netKw = round1(
    num(totalGenerationKw - totalDemandKw, raw.netKw, energy.netKw, energy.net_kw),
  );
  const batteryPct = round1(
    Math.max(0, Math.min(100, num(50, raw.batteryPct, energy.batteryPct, energy.battery_pct))),
  );
  const batteryCapacityKwh = round1(
    num(400, raw.batteryCapacityKwh, energy.batteryCapacityKwh, energy.battery_capacity_kwh),
  );
  const batteryEnergyKwh = round1(
    num(
      (batteryPct / 100) * batteryCapacityKwh,
      raw.batteryEnergyKwh,
      energy.batteryEnergyKwh,
      energy.battery_energy_kwh,
    ),
  );

  const rawEvent = raw.activeEvent ?? raw.active_event;
  const activeEvent: IslandEvent | null =
    typeof rawEvent === "string" && EVENTS.includes(rawEvent as IslandEvent)
      ? (rawEvent as IslandEvent)
      : null;

  const energyBalanceKw = round1(
    num(
      netKw,
      raw.filteredNetPowerKw,
      stability.filteredNetPowerKw as number,
      stability.energyBalanceKw as number,
      stability.filtered_net_power_kw as number,
    ),
  );
  const velocity = round1(
    num(0, raw.velocityKwS, stability.velocityKwS as number, stability.velocity as number, stability.velocity_kw_s as number),
  );
  const acceleration = round1(
    num(
      0,
      raw.accelerationKwS2,
      stability.accelerationKwS2 as number,
      stability.acceleration as number,
      stability.acceleration_kw_s2 as number,
    ),
  );
  const trajectory = oneOf(
    TRAJECTORIES,
    raw.trajectory ?? (stability.trajectory as string | undefined),
    deriveTrajectory(energyBalanceKw, velocity),
  );
  const interpretation =
    (typeof raw.interpretation === "string" && raw.interpretation) ||
    (typeof stability.interpretation === "string" && stability.interpretation) ||
    TRAJECTORY_INTERPRETATION[trajectory];

  const status = oneOf(
    STATUSES,
    raw.status,
    deriveStatus(netKw, batteryPct, activeEvent),
  );

  return {
    timestamp: toMs(raw.timestamp),
    controller: oneOf(CONTROLLERS, raw.controller, "nimbus"),
    activeEvent,
    status,
    energy: {
      solarKw,
      windKw,
      totalGenerationKw,
      totalDemandKw,
      netKw,
      batteryPct,
      batteryEnergyKwh,
      batteryCapacityKwh,
    },
    stability: {
      energyBalanceKw,
      velocity,
      acceleration,
      trajectory,
      interpretation,
    },
    resources: normalizeResources(raw.resources),
    history: normalizeHistory(raw.history),
  };
}

function idList(raw: unknown): ResourceId[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is ResourceId =>
      typeof x === "string" && RESOURCE_ORDER.includes(x as ResourceId),
  );
}

export function normalizeDecision(raw: RawDecision, state: IslandState): NimbusDecision {
  const byState = (s: ResourceState): ResourceId[] =>
    state.resources.filter((r) => r.state === s).map((r) => r.id);

  const actions =
    Array.isArray(raw.actions) && raw.actions.length
      ? raw.actions
          .filter((a): a is { resource: ResourceId; action: string } =>
            Boolean(
              a &&
                typeof a.resource === "string" &&
                RESOURCE_ORDER.includes(a.resource as ResourceId) &&
                typeof a.action === "string",
            ),
          )
          .map((a) => ({ resource: a.resource, action: a.action }))
      : state.resources
          .filter((r) => r.state !== "normal")
          .map((r) => ({ resource: r.id, action: `${r.state} at ${r.operatingPct}%` }));

  return {
    id: raw.id != null ? String(raw.id) : `dec-${state.timestamp}`,
    timestamp: toMs(raw.timestamp ?? state.timestamp),
    title:
      (typeof raw.title === "string" && raw.title) ||
      (typeof raw.action === "string" && raw.action) ||
      "Nimbus decision",
    explanation:
      (typeof raw.explanation === "string" && raw.explanation) ||
      (typeof raw.reason === "string" && raw.reason) ||
      "",
    actions,
    protectedResources: raw.protectedResources
      ? idList(raw.protectedResources)
      : byState("protected"),
    throttledResources: raw.throttledResources
      ? idList(raw.throttledResources)
      : byState("throttled"),
    reducedResources: raw.reducedResources
      ? idList(raw.reducedResources)
      : byState("reduced"),
    shedResources: raw.shedResources ? idList(raw.shedResources) : byState("shed"),
    expectedOutcome:
      (typeof raw.expectedOutcome === "string" && raw.expectedOutcome) ||
      (typeof raw.expected_outcome === "string" && raw.expected_outcome) ||
      "",
  };
}
