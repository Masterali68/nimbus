import type { StabilityMetrics, TrajectoryLabel } from "@/types/nimbus";
import { Panel } from "@/components/ui/Panel";
import { Badge, type Tone } from "@/components/ui/Badge";
import { signed1 } from "@/components/ui/format";
import { TRAJECTORY_LABEL } from "@/lib/api/catalog";

const TRAJ: Record<TrajectoryLabel, { tone: Tone }> = {
  stable: { tone: "cyan" },
  improving: { tone: "green" },
  deteriorating: { tone: "amber" },
  critical: { tone: "red" },
};

function toneForSign(v: number): string {
  if (v > 0.2) return "text-signal-green";
  if (v < -0.2) return "text-signal-red";
  return "text-ops-text";
}

function Cell({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-ops-border bg-ops-bg/40 p-2.5">
      <dt className="text-[11px] uppercase tracking-wide text-ops-dim">{label}</dt>
      <dd className={`font-mono text-base tabular-nums ${tone}`}>
        {value} <span className="text-[11px] text-ops-dim">{unit}</span>
      </dd>
    </div>
  );
}

export function StabilityPanel({
  stability,
  severityLabel,
}: {
  stability: StabilityMetrics;
  severityLabel: string;
}) {
  const t = TRAJ[stability.trajectory];

  return (
    <Panel
      title="Stability / Trajectory"
      right={
        <Badge tone={t.tone} dot>
          {TRAJECTORY_LABEL[stability.trajectory]}
        </Badge>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cell
            label="Net Power"
            value={signed1(stability.energyBalanceKw)}
            unit="kW"
            tone={toneForSign(stability.energyBalanceKw)}
          />
          <Cell
            label="Velocity"
            value={signed1(stability.velocity)}
            unit="kW/s"
            tone={toneForSign(stability.velocity)}
          />
          <Cell
            label="Acceleration"
            value={signed1(stability.acceleration)}
            unit="kW/s²"
            tone={toneForSign(stability.acceleration)}
          />
          <Cell label="Severity" value={severityLabel} unit="" tone="text-ops-text" />
        </dl>
        <p className="text-sm leading-relaxed text-ops-muted">
          {stability.interpretation}
        </p>
      </div>
    </Panel>
  );
}
