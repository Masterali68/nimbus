/**
 * Metric catalog for the comparison table and charts.
 *
 * `direction` drives best-value highlighting:
 *   "higher" — a larger value is better
 *   "lower"  — a smaller value is better
 *   "none"   — no clear direction; never highlight a "best"
 *
 * Units and formatting live here so the table, the charts, and the score panel
 * can never disagree.
 */

import { n0, n1 } from "@/components/ui/format";
import type {
  ControllerKey,
  ControllerMetrics,
  EvaluationResult,
} from "@/lib/api/evaluation";
import { CONTROLLER_ORDER } from "./controllers";

export type MetricDirection = "higher" | "lower" | "none";

export interface MetricDef {
  key: keyof ControllerMetrics;
  label: string;
  /** Short unit shown next to the value / on the chart axis. */
  unit: string;
  direction: MetricDirection;
  format: (v: number) => string;
  /** One-line plain-English note for the row tooltip / chart caption. */
  hint: string;
}

const numeric = (v: ControllerMetrics[keyof ControllerMetrics]): v is number =>
  typeof v === "number" && Number.isFinite(v);

export const METRICS: MetricDef[] = [
  {
    key: "criticalUptimePct",
    label: "Critical-service uptime",
    unit: "%",
    direction: "higher",
    format: (v) => `${n1(v)}%`,
    hint: "Share of the run the hospital and other essential services stayed powered.",
  },
  {
    key: "waterAvailabilityPct",
    label: "Water availability",
    unit: "%",
    direction: "higher",
    format: (v) => `${n1(v)}%`,
    hint: "Share of desired desalination / water output that was actually delivered.",
  },
  {
    key: "totalLoadShedKwh",
    label: "Total load shed",
    unit: "kWh",
    direction: "lower",
    format: (v) => `${n0(v)} kWh`,
    hint: "Total energy removed from consumers to keep the grid alive.",
  },
  {
    key: "sheddingEventCount",
    label: "Number of shedding events",
    unit: "count",
    direction: "lower",
    format: (v) => n0(v),
    hint: "How many separate times a load was cut or reduced.",
  },
  {
    key: "recoveryTimeS",
    label: "Recovery time",
    unit: "s",
    direction: "lower",
    format: (v) => `${n0(v)} s`,
    hint: "Seconds from the end of the disturbance to full normal service.",
  },
  {
    key: "minBatteryPct",
    label: "Minimum battery percentage",
    unit: "%",
    direction: "higher",
    format: (v) => `${n1(v)}%`,
    hint: "Lowest the battery fell during the run — higher means more reserve kept.",
  },
  {
    key: "instabilityIndex",
    label: "Energy-balance instability",
    unit: "index",
    direction: "lower",
    format: (v) => n1(v),
    hint: "Prototype measure of how much the supply/demand balance oscillated.",
  },
  {
    key: "criticalInterruptions",
    label: "Critical-service interruptions",
    unit: "count",
    direction: "lower",
    format: (v) => n0(v),
    hint: "Number of times a critical service actually lost power.",
  },
  {
    key: "nimbusScore",
    label: "Prototype Nimbus Score",
    unit: "pts",
    direction: "higher",
    format: (v) => `${n0(v)} pts`,
    hint: "Configurable prototype summary score (see the score panel below).",
  },
];

/** Metrics shown as charts, in order. Kept to four to stay readable. */
export const CHART_METRIC_KEYS: (keyof ControllerMetrics)[] = [
  "criticalUptimePct",
  "waterAvailabilityPct",
  "totalLoadShedKwh",
  "recoveryTimeS",
];

export interface MetricCell {
  controller: ControllerKey;
  value: number | null;
}

export function metricCells(
  result: EvaluationResult,
  key: keyof ControllerMetrics,
): MetricCell[] {
  return CONTROLLER_ORDER.map((controller) => {
    const raw = result.controllers[controller]?.[key];
    return { controller, value: numeric(raw) ? raw : null };
  });
}

/**
 * Controllers tied for the best value on this metric. Empty when the direction
 * is unclear or fewer than two controllers reported a number — we never mark a
 * "best" that isn't clearly better.
 */
export function bestControllers(
  result: EvaluationResult,
  def: MetricDef,
): Set<ControllerKey> {
  if (def.direction === "none") return new Set();
  const cells = metricCells(result, def.key).filter(
    (c): c is { controller: ControllerKey; value: number } => c.value != null,
  );
  if (cells.length < 2) return new Set();

  const values = cells.map((c) => c.value);
  const target =
    def.direction === "higher" ? Math.max(...values) : Math.min(...values);
  // All equal → no meaningful winner.
  if (values.every((v) => v === values[0])) return new Set();

  const EPS = 1e-9;
  return new Set(
    cells.filter((c) => Math.abs(c.value - target) <= EPS).map((c) => c.controller),
  );
}
