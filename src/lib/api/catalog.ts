/**
 * Display catalog + plain-English helpers.
 *
 * Single source of truth for the event / controller / resource / state
 * vocabulary the UI shows. The mock engine re-exports CONTROLLERS / EVENTS from
 * here so the two never drift.
 */

import type {
  ControllerMode,
  IslandEvent,
  ResourceId,
  ResourceState,
  SystemStatus,
  TrajectoryLabel,
} from "@/types/nimbus";

export const CONTROLLERS: { id: ControllerMode; label: string; blurb: string }[] = [
  {
    id: "naive",
    label: "Naive",
    blurb: "Holds every load at full draw. Takes no protective action.",
  },
  {
    id: "reactive",
    label: "Reactive",
    blurb: "Blanket load-shedding once the deficit crosses a fixed threshold.",
  },
  {
    id: "nimbus",
    label: "Nimbus",
    blurb: "Priority-aware protection of critical services, acting early.",
  },
];

export const EVENTS: { id: IslandEvent; label: string; glyph: string; blurb: string }[] = [
  { id: "storm", label: "Storm", glyph: "⛈", blurb: "Solar collapses, wind falls" },
  { id: "cloud_cover", label: "Cloud Cover", glyph: "☁", blurb: "Solar generation drops" },
  { id: "wind_drop", label: "Wind Drop", glyph: "🍃", blurb: "Wind falls below forecast" },
  { id: "tourist_surge", label: "Tourist Surge", glyph: "🛬", blurb: "Resort demand spikes" },
  { id: "water_emergency", label: "Water Emergency", glyph: "💧", blurb: "Desalination demand spikes" },
  { id: "compound_crisis", label: "Compound Crisis", glyph: "⚠", blurb: "Multiple failures at once" },
];

export const CONTROLLER_LABEL: Record<ControllerMode, string> = {
  naive: "Naive",
  reactive: "Reactive",
  nimbus: "Nimbus",
};

export const EVENT_LABEL: Record<IslandEvent, string> = {
  storm: "Storm",
  cloud_cover: "Cloud Cover",
  wind_drop: "Wind Drop",
  tourist_surge: "Tourist Surge",
  water_emergency: "Water Emergency",
  compound_crisis: "Compound Crisis",
};

export const RESOURCE_LABEL: Record<ResourceId, string> = {
  hospital: "Hospital",
  desalination: "Desalination",
  residential: "Residential",
  resort: "Resort",
};

/** Fallback nominal draw (kW) when the backend omits `nominalKw`. */
export const RESOURCE_NOMINAL_KW: Record<ResourceId, number> = {
  hospital: 22,
  desalination: 34,
  residential: 40,
  resort: 24,
};

export const RESOURCE_CRITICALITY: Record<
  ResourceId,
  "vital" | "high" | "standard" | "deferrable"
> = {
  hospital: "vital",
  desalination: "high",
  residential: "standard",
  resort: "deferrable",
};

/** Human meaning of each resource state, shown under the operating %. */
export const STATE_MEANING: Record<ResourceState, string> = {
  protected: "Held at full power — never reduced",
  normal: "Running normally",
  throttled: "Output smoothly reduced",
  reduced: "Demand trimmed to save reserve",
  shed: "Offline to protect the battery",
  cooldown: "Recovering gradually",
};

export const SEVERITY_LABEL: Record<SystemStatus, string> = {
  stable: "Low",
  watch: "Elevated",
  warning: "High",
  critical: "Severe",
};

/** Plain-English one-liner for the stability panel, keyed by trajectory. */
export const TRAJECTORY_INTERPRETATION: Record<TrajectoryLabel, string> = {
  stable: "Energy supply and demand are balanced.",
  improving: "Generation and battery reserve are recovering.",
  deteriorating:
    "Energy availability is falling quickly. Nimbus is preparing protective actions.",
  critical:
    "Battery reserve and energy balance require immediate priority-based reductions.",
};

export const TRAJECTORY_LABEL: Record<TrajectoryLabel, string> = {
  stable: "Stable",
  improving: "Improving",
  deteriorating: "Deteriorating",
  critical: "Critical",
};

/** Short caption for an operating percentage + state (used on resource cards). */
export function operatingCaption(state: ResourceState, pct: number): string {
  switch (state) {
    case "protected":
      return "Protected at 100%";
    case "shed":
      return "Shed — 0%";
    case "throttled":
      return `Throttled to ${Math.round(pct)}%`;
    case "reduced":
      return `Reduced to ${Math.round(pct)}%`;
    case "cooldown":
      return `Restoring — ${Math.round(pct)}%`;
    default:
      return `Running at ${Math.round(pct)}%`;
  }
}
