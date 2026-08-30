"use client";

import type { CSSProperties } from "react";
import type {
  ControllerMode,
  NimbusDecision,
  ResourceId,
  TrajectoryLabel,
} from "@/types/nimbus";
import { Panel } from "@/components/ui/Panel";
import { Badge, type Tone } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import { useFlash } from "@/components/ui/useFlash";
import { CONTROLLER_LABEL, RESOURCE_LABEL, TRAJECTORY_LABEL } from "@/lib/api/catalog";

type GroupKey =
  | "protectedResources"
  | "throttledResources"
  | "reducedResources"
  | "shedResources";

const GROUPS: { key: GroupKey; label: string; tone: Tone }[] = [
  { key: "protectedResources", label: "Protected", tone: "ice" },
  { key: "throttledResources", label: "Throttled", tone: "amber" },
  { key: "reducedResources", label: "Reduced", tone: "orange" },
  { key: "shedResources", label: "Shed", tone: "red" },
];

function currentAction(decision: NimbusDecision): string {
  if (decision.shedResources.length)
    return `Shedding ${names(decision.shedResources)} to protect critical services.`;
  if (decision.throttledResources.length)
    return `Throttling ${names(decision.throttledResources)} to hold battery reserve.`;
  if (decision.reducedResources.length)
    return `Trimming ${names(decision.reducedResources)} demand.`;
  if (decision.protectedResources.length)
    return "Holding critical services at full power. No load reductions needed.";
  return "Monitoring — all resources nominal.";
}

function names(ids: ResourceId[]): string {
  return ids.map((id) => RESOURCE_LABEL[id]).join(" and ");
}

export function WhyNimbusPanel({
  decision,
  controller,
  trajectory,
  severityLabel,
}: {
  decision: NimbusDecision;
  controller: ControllerMode;
  trajectory: TrajectoryLabel;
  severityLabel: string;
}) {
  const flash = useFlash(decision.id);

  return (
    <Panel
      title="Why Nimbus Acted"
      right={
        <div className="flex items-center gap-2">
          <Badge tone="blue">{CONTROLLER_LABEL[controller]}</Badge>
          <Badge tone="neutral">Severity: {severityLabel}</Badge>
          <Badge tone="neutral">{TRAJECTORY_LABEL[trajectory]}</Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          className={cn(
            "rounded-lg border border-signal-blue/30 bg-signal-blue/5 p-3",
            flash && "nimbus-flash",
          )}
          style={
            { "--nimbus-flash-color": "rgba(59,130,246,0.5)" } as CSSProperties
          }
        >
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ops-dim">
            Current action
          </span>
          <p className="mt-1 text-sm font-medium leading-relaxed text-ops-text">
            {currentAction(decision)}
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-ops-text">{decision.title}</h3>
          {decision.explanation && (
            <p className="mt-1 text-sm leading-relaxed text-ops-muted">
              {decision.explanation}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ops-dim">
            Resource actions
          </span>
          {decision.actions.length === 0 ? (
            <p className="text-sm text-ops-muted">
              No load adjustments — all resources nominal.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {decision.actions.map((a) => (
                <li
                  key={a.resource}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-ops-text">{RESOURCE_LABEL[a.resource]}</span>
                  <span className="text-ops-muted">{a.action}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {GROUPS.map((g) => {
            const ids = decision[g.key];
            if (!ids.length) return null;
            return (
              <div key={g.label} className="flex items-center gap-1.5">
                <Badge tone={g.tone}>{g.label}</Badge>
                <span className="text-xs text-ops-muted">
                  {ids.map((id) => RESOURCE_LABEL[id]).join(", ")}
                </span>
              </div>
            );
          })}
        </div>

        {decision.expectedOutcome && (
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ops-dim">
              Expected outcome
            </span>
            <p className="mt-1 text-sm leading-relaxed text-ops-muted">
              {decision.expectedOutcome}
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
