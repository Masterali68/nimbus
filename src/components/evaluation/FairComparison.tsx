"use client";

import { Panel } from "@/components/ui/Panel";
import { n0, n1 } from "@/components/ui/format";
import type { ScenarioDescriptor } from "@/lib/api/evaluation";
import { prettyEvent, prettyRecovery, prettySeverity } from "./labels";

/**
 * Explains why the comparison is fair: every controller faced the exact same
 * scenario. Renders only the descriptor fields the backend actually provides;
 * if none are present it falls back to the plain-English statement alone.
 */
export function FairComparison({
  scenario,
}: {
  scenario: ScenarioDescriptor;
}) {
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value != null && value !== "") rows.push({ label, value });
  };

  push("Scenario seed", scenario.seed != null ? `#${scenario.seed}` : null);
  push("Event type", prettyEvent(scenario.event));
  push("Event severity", prettySeverity(scenario.severity));
  push(
    "Initial battery",
    scenario.initialBatteryPct != null ? `${n0(scenario.initialBatteryPct)}%` : null,
  );
  push(
    "Event duration",
    scenario.eventDurationS != null ? `${n0(scenario.eventDurationS)} s` : null,
  );
  push(
    "Demand spike",
    scenario.demandSpikePct != null
      ? `+${n0(scenario.demandSpikePct)}%`
      : null,
  );
  push("Recovery speed", prettyRecovery(scenario.recoverySpeed));
  push(
    "Timestep",
    scenario.timestepS != null ? `${n1(scenario.timestepS)} s` : null,
  );
  push(
    "Scenarios",
    scenario.scenarioCount != null ? n0(scenario.scenarioCount) : null,
  );

  return (
    <Panel title="Fair comparison — identical conditions">
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-ops-muted">
          Every controller received the same simulated starting battery, solar and
          wind availability, resource demand, event type, event severity, event
          duration, recovery conditions, timestep, and scenario seed. For each
          scenario the <span className="text-ops-text">only</span> thing that
          changes between the three results is the controller.
        </p>

        {rows.length > 0 ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {rows.map((r) => (
              <div
                key={r.label}
                className="flex flex-col gap-1 rounded-lg border border-ops-border bg-ops-bg/40 p-2.5"
              >
                <dt className="text-[11px] uppercase tracking-wide text-ops-dim">
                  {r.label}
                </dt>
                <dd className="font-mono text-sm tabular-nums text-ops-text">
                  {r.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[11px] text-ops-dim">
            Scenario parameters were not reported by the backend for this run.
          </p>
        )}

        <p className="text-[11px] text-ops-dim">
          Controllers cannot see future weather — no controller is given advance
          knowledge of the event.
        </p>
      </div>
    </Panel>
  );
}
