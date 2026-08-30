import { EVENT_LABEL } from "@/lib/api/catalog";
import type { IslandEvent } from "@/types/nimbus";

const EVENT_IDS = Object.keys(EVENT_LABEL) as IslandEvent[];

/** Turn a raw backend event id into a readable label, tolerant of unknowns. */
export function prettyEvent(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const norm = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if ((EVENT_IDS as string[]).includes(norm)) {
    return EVENT_LABEL[norm as IslandEvent];
  }
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format a severity that may arrive as a 0–1 number, a label, or a string. */
export function prettySeverity(
  raw: number | string | null | undefined,
): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    const band =
      raw >= 0.85 ? "Severe" : raw >= 0.6 ? "High" : raw >= 0.35 ? "Elevated" : "Low";
    const scaled = raw <= 1 ? raw.toFixed(2) : String(raw);
    return `${band} (${scaled})`;
  }
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format a recovery-speed field (number rate or descriptive string). */
export function prettyRecovery(
  raw: number | string | null | undefined,
): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return `${raw}× rate`;
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}
