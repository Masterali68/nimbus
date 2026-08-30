/**
 * ComparisonBarChart — one metric, three controllers, three bars.
 *
 * Hand-rolled SVG (same approach as EnergyChart) so it needs no chart library
 * and stays crisp on a projector. Bars use the fixed controller colour language;
 * the best bar (per the metric's direction) gets a thin outline — not a
 * different hue — so the "winner" reads without recolouring anything.
 */

import type { ControllerKey } from "@/lib/api/evaluation";
import { CONTROLLER_META } from "@/components/evaluation/controllers";
import type { MetricDirection } from "@/components/evaluation/metrics";

export interface BarDatum {
  controller: ControllerKey;
  value: number | null;
}

export function ComparisonBarChart({
  title,
  caption,
  unit,
  direction,
  data,
  format,
}: {
  title: string;
  caption: string;
  unit: string;
  direction: MetricDirection;
  data: BarDatum[];
  format: (v: number) => string;
}) {
  const known = data.filter(
    (d): d is { controller: ControllerKey; value: number } => d.value != null,
  );

  if (known.length < 2) {
    return (
      <figure className="flex flex-col gap-2 rounded-xl border border-ops-border bg-ops-panel p-4">
        <figcaption className="text-sm font-semibold text-ops-text">{title}</figcaption>
        <div className="flex h-[168px] items-center justify-center text-xs text-ops-dim">
          Not enough data reported for this chart.
        </div>
      </figure>
    );
  }

  const values = known.map((d) => d.value);
  const maxValue = Math.max(...values, 0);
  const minValue = Math.min(...values, 0);
  const span = maxValue - minValue || 1;

  const best =
    direction === "none" || values.every((v) => v === values[0])
      ? null
      : direction === "higher"
        ? Math.max(...values)
        : Math.min(...values);

  const H = 132; // px, drawing area height
  const barH = (v: number) => Math.max(2, ((v - minValue) / span) * H);

  return (
    <figure className="flex flex-col gap-3 rounded-xl border border-ops-border bg-ops-panel p-4">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-ops-text">{title}</span>
        <span className="text-[11px] text-ops-dim">{caption}</span>
      </figcaption>

      <div
        className="flex items-end justify-around gap-3 pt-4"
        style={{ height: H + 32 }}
        role="img"
        aria-label={`${title}. ${data
          .map(
            (d) =>
              `${CONTROLLER_META[d.controller].label}: ${
                d.value == null ? "not reported" : format(d.value)
              }`,
          )
          .join(", ")}.`}
      >
        {data.map((d) => {
          const meta = CONTROLLER_META[d.controller];
          const isBest = best != null && d.value != null && d.value === best;
          return (
            <div
              key={d.controller}
              className="flex h-full w-full max-w-[92px] flex-col items-center justify-end gap-1.5"
            >
              <span className="font-mono text-xs tabular-nums text-ops-text">
                {d.value == null ? "—" : format(d.value)}
              </span>
              <div
                className="w-full rounded-t-md"
                style={{
                  height: d.value == null ? 2 : barH(d.value),
                  backgroundColor: d.value == null ? "var(--color-ops-border)" : meta.color,
                  outline: isBest ? "2px solid var(--color-ops-text)" : "none",
                  outlineOffset: 2,
                }}
              />
              <span className="flex items-center gap-1 text-[11px] text-ops-muted">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                {meta.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[10px] text-ops-dim">
        <span>Units: {unit}</span>
        <span>
          {direction === "higher"
            ? "Higher is better"
            : direction === "lower"
              ? "Lower is better"
              : "No clear direction"}
          {best != null ? " · outline = best" : ""}
        </span>
      </div>
    </figure>
  );
}
