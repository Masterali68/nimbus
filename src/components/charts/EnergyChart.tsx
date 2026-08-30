import type { TelemetrySample } from "@/types/nimbus";

type SeriesKey = "solarKw" | "windKw" | "totalDemandKw" | "netKw";

const SERIES: { key: SeriesKey; label: string; color: string; width: number }[] = [
  { key: "solarKw", label: "Solar", color: "var(--color-signal-amber)", width: 1 },
  { key: "windKw", label: "Wind", color: "var(--color-signal-cyan)", width: 1 },
  { key: "totalDemandKw", label: "Demand", color: "var(--color-ops-text)", width: 1 },
  { key: "netKw", label: "Net", color: "var(--color-signal-blue)", width: 1.8 },
];

const W = 100;
const H = 42;

export function EnergyChart({ history }: { history: TelemetrySample[] }) {
  if (history.length < 2) {
    return <div className="h-[220px] w-full animate-pulse rounded-lg bg-ops-bg" />;
  }

  const kwValues = history.flatMap((s) => [s.solarKw, s.windKw, s.totalDemandKw, s.netKw]);
  const maxKw = Math.max(...kwValues, 10);
  const minKw = Math.min(...kwValues, 0);
  const span = maxKw - minKw || 1;

  const x = (i: number) => (i / (history.length - 1)) * W;
  const yKw = (v: number) => H - ((v - minKw) / span) * H;
  const yPct = (v: number) => H - (v / 100) * H;

  const path = (fn: (s: TelemetrySample) => number) =>
    history.map((s, i) => `${x(i).toFixed(2)},${fn(s).toFixed(2)}`).join(" ");

  const zeroY = yKw(0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {SERIES.map((s) => (
          <span
            key={s.key}
            className="inline-flex items-center gap-1.5 text-[11px] text-ops-muted"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ops-muted">
          <span
            className="h-0 w-3 border-t-2 border-dashed"
            style={{ borderColor: "var(--color-signal-green)" }}
          />
          Battery %
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[220px] w-full"
        role="img"
        aria-label="Live energy generation, demand, net power and battery level"
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1={0}
            x2={W}
            y1={H * g}
            y2={H * g}
            stroke="var(--color-ops-border)"
            strokeWidth={0.25}
          />
        ))}
        <line
          x1={0}
          x2={W}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--color-ops-dim)"
          strokeWidth={0.4}
          strokeDasharray="1 1"
        />
        <polyline
          points={path((s) => yPct(s.batteryPct))}
          fill="none"
          stroke="var(--color-signal-green)"
          strokeWidth={1}
          strokeDasharray="2 1.5"
          vectorEffect="non-scaling-stroke"
        />
        {SERIES.map((s) => (
          <polyline
            key={s.key}
            points={path((d) => yKw(d[s.key]))}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}
