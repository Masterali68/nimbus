/**
 * Phase 1 mock telemetry engine.
 *
 * Deterministic so server render and client hydration match: the only "motion"
 * comes from layered sine terms keyed on the tick counter, plus easing toward
 * per-event generation targets. No Date / Math.random on the render path.
 *
 * Produces the shared `IslandState` and `NimbusDecision` shapes from
 * `@/types/nimbus`. Swap this module for a live source later without touching
 * any component.
 */

import type {
  ControllerMode,
  DecisionAction,
  EnergyMetrics,
  IslandEvent,
  IslandState,
  NimbusDecision,
  ResourceCriticality,
  ResourceId,
  ResourceState,
  ResourceStatus,
  SystemStatus,
  TelemetrySample,
  TrajectoryLabel,
} from "@/types/nimbus";

export const BATTERY_CAPACITY_KWH = 400;
export const TICK_MS = 2000;
const SIM_MINUTES_PER_TICK = 1;
const HISTORY_LENGTH = 36;

// Display catalog lives in the API layer so the mock and the live UI never drift.
import { CONTROLLERS, EVENTS } from "@/lib/api/catalog";

export { CONTROLLERS, EVENTS };

interface ResourceMeta {
  id: ResourceId;
  name: string;
  criticality: ResourceCriticality;
  nominalKw: number;
}

const RESOURCES: ResourceMeta[] = [
  { id: "hospital", name: "Hospital", criticality: "vital", nominalKw: 22 },
  { id: "desalination", name: "Desalination", criticality: "high", nominalKw: 34 },
  { id: "residential", name: "Residential", criticality: "standard", nominalKw: 40 },
  { id: "resort", name: "Resort", criticality: "deferrable", nominalKw: 24 },
];

const RESOURCE_NAME: Record<ResourceId, string> = {
  hospital: "Hospital",
  desalination: "Desalination",
  residential: "Residential",
  resort: "Resort",
};

const GEN_TARGETS: Record<"calm" | IslandEvent, { solar: number; wind: number }> = {
  calm: { solar: 88, wind: 46 },
  storm: { solar: 26, wind: 16 },
  cloud_cover: { solar: 34, wind: 44 },
  wind_drop: { solar: 84, wind: 10 },
  tourist_surge: { solar: 82, wind: 40 },
  water_emergency: { solar: 82, wind: 42 },
  compound_crisis: { solar: 22, wind: 12 },
};

const EVENT_STATUS: Record<IslandEvent, SystemStatus> = {
  storm: "warning",
  cloud_cover: "watch",
  wind_drop: "watch",
  tourist_surge: "watch",
  water_emergency: "warning",
  compound_crisis: "critical",
};

const EVENT_NARRATIVE: Record<IslandEvent, string> = {
  storm: "A storm has cut solar output sharply and wind is falling.",
  cloud_cover: "Heavy cloud cover has pulled solar generation down.",
  wind_drop: "Wind generation has dropped well below forecast.",
  tourist_surge: "A tourist surge has pushed resort and residential demand up sharply.",
  water_emergency: "A water emergency has raised desalination demand.",
  compound_crisis:
    "Multiple failures at once — renewable output has collapsed while demand is elevated.",
};

const EVENT_OUTCOME: Record<IslandEvent, string> = {
  storm:
    "Battery holds above 40% until renewable output recovers; hospital and homes stay fully supplied.",
  cloud_cover: "Solar recovers as the cloud clears; only deferrable load is affected.",
  wind_drop: "Battery covers the gap until wind returns; essential services are untouched.",
  tourist_surge: "Peak demand is trimmed at the resort so essential supply is unaffected.",
  water_emergency:
    "Desalination is held at full output while the resort is shed to protect battery reserve.",
  compound_crisis: "Only the hospital and homes remain fully supplied until conditions ease.",
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function ease(current: number, target: number, k: number): number {
  return current + (target - current) * k;
}

/** Deterministic layered wobble so the chart looks alive without randomness. */
function wobble(seed: number, amp: number): number {
  return Math.sin(seed * 0.9) * amp * 0.6 + Math.sin(seed * 2.3 + 1) * amp * 0.3;
}

function demandMultiplier(resource: ResourceId, event: IslandEvent | null): number {
  if (event === "tourist_surge") {
    if (resource === "resort") return 1.9;
    if (resource === "residential") return 1.15;
  }
  if (event === "water_emergency" && resource === "desalination") return 1.9;
  if (event === "compound_crisis") {
    if (resource === "resort") return 1.7;
    if (resource === "residential") return 1.12;
    if (resource === "desalination") return 1.6;
  }
  return 1;
}

interface StepControl {
  pct: number;
  state: ResourceState;
}

function controlFor(
  controller: ControllerMode,
  resource: ResourceId,
  ratio: number,
  event: IslandEvent | null,
  restoring: boolean,
): StepControl {
  if (resource === "hospital") {
    return { pct: 100, state: controller === "nimbus" ? "protected" : "normal" };
  }

  if (controller === "naive") {
    return { pct: 100, state: "normal" };
  }

  if (controller === "reactive") {
    if (ratio > 0.15) {
      if (resource === "resort") return { pct: 0, state: "shed" };
      if (resource === "desalination") return { pct: 50, state: "throttled" };
      return { pct: 72, state: "reduced" };
    }
    return { pct: 100, state: "normal" };
  }

  // nimbus — priority aware
  if (resource === "resort") {
    if (restoring) return { pct: 45, state: "cooldown" };
    if (event === "water_emergency" && ratio > 0.08) return { pct: 0, state: "shed" };
    if (ratio > 0.28) return { pct: 0, state: "shed" };
    if (ratio > 0.12) return { pct: 50, state: "reduced" };
    return { pct: 100, state: "normal" };
  }

  if (resource === "desalination") {
    if (event === "water_emergency") return { pct: 100, state: "normal" };
    if (ratio > 0.28) {
      return { pct: clamp(Math.round(85 - ratio * 60), 45, 85), state: "throttled" };
    }
    return { pct: 100, state: "normal" };
  }

  // residential — reduced only in a serious shortage
  if (ratio > 0.42) {
    return { pct: clamp(Math.round(98 - ratio * 18), 82, 96), state: "reduced" };
  }
  return { pct: 100, state: "normal" };
}

function deriveStatus(
  event: IslandEvent | null,
  controller: ControllerMode,
  batteryPct: number,
): SystemStatus {
  const order: SystemStatus[] = ["stable", "watch", "warning", "critical"];
  let level = event ? order.indexOf(EVENT_STATUS[event]) : 0;

  if (controller === "naive" && event) level += 1;
  if (controller === "reactive" && batteryPct < 30) level += 1;
  if (batteryPct < 32 && level >= 2) level += 1;
  if (batteryPct < 18) level = 3;
  if (!event && batteryPct > 45) level = 0;

  return order[clamp(level, 0, 3)];
}

interface Drivers {
  event: IslandEvent | null;
  controller: ControllerMode;
  solarKw: number;
  windKw: number;
  batteryPct: number;
  batteryEnergyKwh: number;
  restoreTicks: number;
}

interface Resolved {
  energy: EnergyMetrics;
  resources: ResourceStatus[];
  status: SystemStatus;
  netKw: number;
}

function resolve(d: Drivers): Resolved {
  const gen = d.solarKw + d.windKw;
  const rawDemandTotal = RESOURCES.reduce(
    (sum, r) => sum + r.nominalKw * demandMultiplier(r.id, d.event),
    0,
  );
  const ratio = clamp((rawDemandTotal - gen) / rawDemandTotal, 0, 1);
  const restoring = d.event === null && d.restoreTicks > 0;

  const resources: ResourceStatus[] = RESOURCES.map((r) => {
    const want = r.nominalKw * demandMultiplier(r.id, d.event);
    const ctl = controlFor(d.controller, r.id, ratio, d.event, restoring);
    return {
      id: r.id,
      name: r.name,
      criticality: r.criticality,
      operatingPct: ctl.pct,
      demandKw: round1((want * ctl.pct) / 100),
      nominalKw: r.nominalKw,
      state: ctl.state,
    };
  });

  const totalGenerationKw = round1(gen);
  const totalDemandKw = round1(resources.reduce((s, r) => s + r.demandKw, 0));
  const netKw = round1(totalGenerationKw - totalDemandKw);

  return {
    energy: {
      solarKw: round1(d.solarKw),
      windKw: round1(d.windKw),
      totalGenerationKw,
      totalDemandKw,
      netKw,
      batteryPct: round1(d.batteryPct),
      batteryEnergyKwh: round1(d.batteryEnergyKwh),
      batteryCapacityKwh: BATTERY_CAPACITY_KWH,
    },
    resources,
    status: deriveStatus(d.event, d.controller, d.batteryPct),
    netKw,
  };
}

export interface MockSnapshot {
  clock: number;
  event: IslandEvent | null;
  controller: ControllerMode;
  solarKw: number;
  windKw: number;
  batteryEnergyKwh: number;
  restoreTicks: number;
  filteredNetKw: number;
  velocity: number;
  acceleration: number;
  history: TelemetrySample[];
  resolved: Resolved;
}

function genTargets(event: IslandEvent | null): { solar: number; wind: number } {
  return event ? GEN_TARGETS[event] : GEN_TARGETS.calm;
}

function batteryPctOf(energyKwh: number): number {
  return (energyKwh / BATTERY_CAPACITY_KWH) * 100;
}

function step(prev: MockSnapshot): MockSnapshot {
  const clock = prev.clock + 1;
  const target = genTargets(prev.event);
  const solarKw = clamp(ease(prev.solarKw, target.solar, 0.3) + wobble(clock, 3), 0, 140);
  const windKw = clamp(ease(prev.windKw, target.wind, 0.3) + wobble(clock * 1.7, 2.4), 0, 90);

  const batteryEnergyKwh = clamp(
    prev.batteryEnergyKwh + prev.resolved.netKw * (SIM_MINUTES_PER_TICK / 60),
    24,
    BATTERY_CAPACITY_KWH,
  );
  const restoreTicks = Math.max(0, prev.restoreTicks - 1);

  const resolved = resolve({
    event: prev.event,
    controller: prev.controller,
    solarKw,
    windKw,
    batteryPct: batteryPctOf(batteryEnergyKwh),
    batteryEnergyKwh,
    restoreTicks,
  });

  const filteredNetKw = ease(prev.filteredNetKw, resolved.netKw, 0.4);
  const velocity = round1(filteredNetKw - prev.filteredNetKw);
  const acceleration = round1(velocity - prev.velocity);

  const sample: TelemetrySample = {
    t: clock,
    solarKw: resolved.energy.solarKw,
    windKw: resolved.energy.windKw,
    totalDemandKw: resolved.energy.totalDemandKw,
    netKw: resolved.energy.netKw,
    batteryPct: resolved.energy.batteryPct,
  };

  return {
    clock,
    event: prev.event,
    controller: prev.controller,
    solarKw,
    windKw,
    batteryEnergyKwh,
    restoreTicks,
    filteredNetKw: round1(filteredNetKw),
    velocity,
    acceleration,
    history: [...prev.history, sample].slice(-HISTORY_LENGTH),
    resolved,
  };
}

/**
 * Seed a snapshot. Defaults to a calm, stable island so the STORM button is
 * dramatic; pass an event to start mid-scenario.
 */
export function createInitialSnapshot(event: IslandEvent | null = null): MockSnapshot {
  const seedEnergyKwh = event ? 214 : 268;
  const target = genTargets(event);
  let snap: MockSnapshot = {
    clock: 0,
    event,
    controller: "nimbus",
    solarKw: target.solar,
    windKw: target.wind,
    batteryEnergyKwh: seedEnergyKwh,
    restoreTicks: 0,
    filteredNetKw: 4,
    velocity: 0,
    acceleration: 0,
    history: [],
    resolved: resolve({
      event,
      controller: "nimbus",
      solarKw: target.solar,
      windKw: target.wind,
      batteryPct: batteryPctOf(seedEnergyKwh),
      batteryEnergyKwh: seedEnergyKwh,
      restoreTicks: 0,
    }),
  };
  for (let i = 0; i < 32; i += 1) snap = step(snap);
  return snap;
}

export function advance(snap: MockSnapshot): MockSnapshot {
  return step(snap);
}

export function withEvent(snap: MockSnapshot, event: IslandEvent | null): MockSnapshot {
  const restoreTicks = event === null ? 3 : 0;
  const solarKw =
    event === null ? ease(snap.solarKw, GEN_TARGETS.calm.solar, 0.55) : snap.solarKw;
  const windKw =
    event === null ? ease(snap.windKw, GEN_TARGETS.calm.wind, 0.55) : snap.windKw;
  const resolved = resolve({
    event,
    controller: snap.controller,
    solarKw,
    windKw,
    batteryPct: batteryPctOf(snap.batteryEnergyKwh),
    batteryEnergyKwh: snap.batteryEnergyKwh,
    restoreTicks,
  });
  return { ...snap, event, solarKw, windKw, restoreTicks, resolved };
}

export function withController(snap: MockSnapshot, controller: ControllerMode): MockSnapshot {
  const resolved = resolve({
    event: snap.event,
    controller,
    solarKw: snap.solarKw,
    windKw: snap.windKw,
    batteryPct: batteryPctOf(snap.batteryEnergyKwh),
    batteryEnergyKwh: snap.batteryEnergyKwh,
    restoreTicks: snap.restoreTicks,
  });
  return { ...snap, controller, resolved };
}

function deriveTrajectory(balance: number, velocity: number): TrajectoryLabel {
  if (balance < -38) return "critical";
  if (velocity > 1.2) return "improving";
  if (balance < -8 || velocity < -1.5) return "deteriorating";
  return "stable";
}

const TRAJECTORY_TEXT: Record<TrajectoryLabel, string> = {
  stable:
    "Energy balance is steady and near zero. Generation and demand are closely matched.",
  improving:
    "Energy balance is climbing back toward positive. Nimbus is easing restrictions as headroom returns.",
  deteriorating:
    "Generation is running below demand and the battery is bridging the gap. Nimbus is holding critical services while it works to close the deficit.",
  critical:
    "Energy balance is deeply negative. Nimbus is protecting only the highest-priority loads until conditions improve.",
};

export function toIslandState(snap: MockSnapshot): IslandState {
  const trajectory = deriveTrajectory(snap.filteredNetKw, snap.velocity);
  return {
    timestamp: snap.clock,
    controller: snap.controller,
    activeEvent: snap.event,
    status: snap.resolved.status,
    energy: snap.resolved.energy,
    stability: {
      energyBalanceKw: round1(snap.filteredNetKw),
      velocity: snap.velocity,
      acceleration: snap.acceleration,
      trajectory,
      interpretation: TRAJECTORY_TEXT[trajectory],
    },
    resources: snap.resolved.resources,
    history: snap.history,
  };
}

function eventLabel(event: IslandEvent): string {
  return EVENTS.find((e) => e.id === event)?.label ?? event;
}

function actionText(state: ResourceState, pct: number): string {
  switch (state) {
    case "protected":
      return "Protected at 100%";
    case "throttled":
      return `Throttled to ${pct}%`;
    case "reduced":
      return `Reduced to ${pct}%`;
    case "shed":
      return "Shed to protect battery reserve";
    case "cooldown":
      return `Recovering — ${pct}%`;
    default:
      return `Holding at ${pct}%`;
  }
}

function actionsFrom(resources: ResourceStatus[]): DecisionAction[] {
  return resources
    .filter((r) => r.state !== "normal")
    .map((r) => ({ resource: r.id, action: actionText(r.state, r.operatingPct) }));
}

function names(ids: ResourceId[]): string {
  return ids.map((id) => RESOURCE_NAME[id].toLowerCase()).join(" and ");
}

function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) return clauses[0] ?? "";
  return `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
}

export function buildDecision(state: IslandState): NimbusDecision {
  const { controller, activeEvent, resources, timestamp } = state;
  const id = `dec-${timestamp}`;
  const byState = (s: ResourceState): ResourceId[] =>
    resources.filter((r) => r.state === s).map((r) => r.id);

  const protectedResources = resources
    .filter((r) => r.state === "protected")
    .map((r) => r.id);
  const throttledResources = byState("throttled");
  const reducedResources = byState("reduced");
  const shedResources = byState("shed");

  if (controller === "naive") {
    return {
      id,
      timestamp,
      title: "Naive controller — no protective action",
      explanation:
        "The naive controller holds every load at full draw. Net power is negative and the battery is carrying the entire deficit, with no prioritisation of the hospital.",
      actions: [],
      protectedResources: [],
      throttledResources: [],
      reducedResources: [],
      shedResources: [],
      expectedOutcome:
        "Battery falls toward its minimum reserve; hospital supply is at risk if the event continues.",
    };
  }

  if (controller === "reactive") {
    return {
      id,
      timestamp,
      title: activeEvent
        ? `${eventLabel(activeEvent)} — blanket load-shedding`
        : "Reactive controller — monitoring",
      explanation: activeEvent
        ? `${EVENT_NARRATIVE[activeEvent]} The reactive controller shed the resort and cut residential and desalination by fixed amounts once the deficit crossed its threshold. The hospital is not explicitly prioritised.`
        : "Generation covers demand. The reactive controller is holding all loads at full draw until a deficit appears.",
      actions: actionsFrom(resources),
      protectedResources,
      throttledResources,
      reducedResources,
      shedResources,
      expectedOutcome: activeEvent
        ? "The deficit is reduced, but residential comfort drops more than necessary and the response lags the event."
        : "System is stable; no intervention required.",
    };
  }

  // nimbus
  if (!activeEvent) {
    return {
      id,
      timestamp,
      title: "Grid stable — all resources nominal",
      explanation:
        "Generation comfortably exceeds demand. Every load is running at full capacity and the battery is recharging.",
      actions: [{ resource: "hospital", action: "Protected at 100%" }],
      protectedResources,
      throttledResources,
      reducedResources,
      shedResources,
      expectedOutcome: "System remains stable; no intervention required.",
    };
  }

  const clauses: string[] = [];
  if (throttledResources.length) clauses.push(`throttling ${names(throttledResources)}`);
  if (reducedResources.length) clauses.push(`trimming ${names(reducedResources)}`);
  if (shedResources.length) clauses.push(`shedding ${names(shedResources)}`);
  const tail = clauses.length ? ` It is ${joinClauses(clauses)} to hold battery reserve.` : "";

  return {
    id,
    timestamp,
    title: `${eventLabel(activeEvent)} detected — protecting critical services`,
    explanation: `${EVENT_NARRATIVE[activeEvent]} Nimbus is holding the hospital at full power.${tail}`,
    actions: actionsFrom(resources),
    protectedResources,
    throttledResources,
    reducedResources,
    shedResources,
    expectedOutcome: EVENT_OUTCOME[activeEvent],
  };
}
