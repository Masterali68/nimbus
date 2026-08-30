"use client";

import {
  ComparisonBarChart,
  type BarDatum,
} from "@/components/charts/ComparisonBarChart";
import type { EvaluationResult } from "@/lib/api/evaluation";
import {
  CHART_METRIC_KEYS,
  METRICS,
  metricCells,
} from "./metrics";

const CHART_QUESTION: Record<string, string> = {
  criticalUptimePct:
    "When the crisis hit, did essential services stay powered?",
  waterAvailabilityPct:
    "How much of the island's water demand was still met?",
  totalLoadShedKwh:
    "How much demand did each controller cut to survive the event?",
  recoveryTimeS:
    "After the disturbance, how fast did service return to normal?",
  instabilityIndex: "How much did each controller make the grid oscillate?",
};

export function ResultsCharts({ result }: { result: EvaluationResult }) {
  const defs = CHART_METRIC_KEYS.map(
    (key) => METRICS.find((m) => m.key === key)!,
  ).filter(Boolean);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {defs.map((def) => {
        const data: BarDatum[] = metricCells(result, def.key);
        const question = CHART_QUESTION[def.key as string] ?? def.hint;
        const caption =
          def.direction === "higher"
            ? `${question} — higher is better (${def.unit}).`
            : def.direction === "lower"
              ? `${question} — lower is better (${def.unit}).`
              : `${question} (${def.unit}).`;
        return (
          <ComparisonBarChart
            key={def.key}
            title={def.label}
            caption={caption}
            unit={def.unit}
            direction={def.direction}
            data={data}
            format={def.format}
          />
        );
      })}
    </div>
  );
}
