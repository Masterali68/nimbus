import type { IslandResource, ResourceId, ResourceMap, ResourceState } from "./types";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function updateResource(
  resources: Partial<ResourceMap>,
  id: ResourceId,
  patch: Partial<IslandResource>,
): Partial<ResourceMap> {
  const current: IslandResource = resources[id] ?? {
    id,
    name: id,
    criticality: 0,
    maxDemandKw: 0,
    minimumOperatingPct: 0,
    operatingPct: 0,
    currentDemandKw: 0,
    state: "NORMAL" as ResourceState,
    throttleable: false,
    shedCapable: false,
  };
  return { ...resources, [id]: { ...current, ...patch } };
}

export function isFiniteNumber(value: number | undefined | null): boolean {
  return typeof value === "number" && Number.isFinite(value);
}