"use client";

import { Panel } from "@/components/ui/Panel";
import { cn } from "@/components/ui/cn";
import type { EvaluationResult } from "@/lib/api/evaluation";
import { CONTROLLER_META, CONTROLLER_ORDER } from "./controllers";
import { METRICS, bestControllers, metricCells } from "./metrics";

/**
 * Metric × controller comparison. Highlights the best cell only when the
 * metric's direction is clear AND one controller is actually better — ties and
 * no-clear-winner rows get no highlight.
 */
export function ComparisonTable({ result }: { result: EvaluationResult }) {
  return (
    <Panel title="Controller comparison" bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ops-border">
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ops-dim">
                Metric
              </th>
              {CONTROLLER_ORDER.map((key) => {
                const meta = CONTROLLER_META[key];
                return (
                  <th
                    key={key}
                    className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-ops-muted"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: meta.color }}
                      />
                      {meta.label}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((def) => {
              const cells = metricCells(result, def.key);
              const best = bestControllers(result, def);
              const arrow =
                def.direction === "higher"
                  ? "↑"
                  : def.direction === "lower"
                    ? "↓"
                    : "";
              return (
                <tr
                  key={def.key}
                  className="border-b border-ops-border/60 last:border-0"
                >
                  <td className="px-4 py-3 align-top">
                    <span className="font-medium text-ops-text" title={def.hint}>
                      {def.label}
                    </span>
                    <span className="ml-1.5 text-ops-dim" aria-hidden>
                      {arrow}
                    </span>
                    <span className="block text-[11px] text-ops-dim">
                      {def.unit}
                    </span>
                  </td>
                  {cells.map((cell) => {
                    const isBest = best.has(cell.controller);
                    return (
                      <td
                        key={cell.controller}
                        className={cn(
                          "px-4 py-3 text-right font-mono tabular-nums",
                          cell.value == null ? "text-ops-dim" : "text-ops-text",
                          isBest &&
                            "rounded-md bg-signal-green/10 font-semibold text-signal-green ring-1 ring-inset ring-signal-green/30",
                        )}
                        title={
                          cell.value == null
                            ? "Not reported by backend"
                            : isBest
                              ? "Best value for this metric"
                              : undefined
                        }
                      >
                        {cell.value == null ? "—" : def.format(cell.value)}
                        {isBest && (
                          <span className="ml-1 text-[10px]" aria-hidden>
                            ▲
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-ops-border px-4 py-2.5 text-[11px] text-ops-dim">
        Highlighted cell = best value for that metric. ↑ higher is better · ↓ lower
        is better. Rows with no clear winner or missing data are not highlighted.
        “—” means the backend did not report that field.
      </p>
    </Panel>
  );
}
