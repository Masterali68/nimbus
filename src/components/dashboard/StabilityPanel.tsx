import type { StabilityMetrics, TrajectoryLabel } from "@/types/nimbus";
import { Panel } from "@/components/ui/Panel";
import { Badge, type Tone } from "@/components/ui/Badge";
import { signed1 } from "@/components/ui/format";

const TRAJ: Record<TrajectoryLabel, { tone: Tone; label: string }> = {
  stable: { tone: "cyan", label: "Stable" },
  improving: { tone: "green", label: "Improving" },
  deteriorating: { tone: "amber", label: "Deteriorating" },
  critical: { tone: "red", label: "Critical" },
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

export function StabilityPanel({ stability }: { stability: StabilityMetrics }) {
  const t = TRAJ[stability.trajectory];

  return (
    <Panel
      title="Stability / Trajectory"
      right={
        <Badge tone={t.tone} dot>
          {t.label}
        </Badge>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-3">
          <Cell
            label="Energy Balance"
            value={signed1(stability.energyBalanceKw)}
            unit="kW"
            tone={toneForSign(stability.energyBalanceKw)}
          />
          <Cell
            label="Velocity"
            value={signed1(stability.velocity)}
            unit="kW/min"
            tone={toneForSign(stability.velocity)}
          />
          <Cell
            label="Acceleration"
            value={signed1(stability.acceleration)}
            unit="kW/min²"
            tone={toneForSign(stability.acceleration)}
          />
        </dl>
        <p className="text-sm leading-relaxed text-ops-muted">
          {stability.interpretation}
        </p>
      </div>
    </Panel>
  );
}
