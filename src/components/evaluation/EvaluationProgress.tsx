"use client";

import { Panel } from "@/components/ui/Panel";
import { Badge, type Tone } from "@/components/ui/Badge";
import { CONTROLLER_META } from "./controllers";
import { prettyEvent } from "./labels";
import { ProgressBar } from "./ProgressBar";
import type { EvaluationPhase } from "@/hooks/useEvaluation";
import type { ControllerKey } from "@/lib/api/evaluation";

const PHASE_BADGE: Record<
  EvaluationPhase,
  { tone: Tone; label: string }
> = {
  checking: { tone: "blue", label: "Checking backend" },
  ready: { tone: "cyan", label: "Ready" },
  starting: { tone: "amber", label: "Starting" },
  running: { tone: "amber", label: "Running" },
  completed: { tone: "green", label: "Completed" },
  failed: { tone: "red", label: "Failed" },
  "backend-unavailable": { tone: "red", label: "Backend unavailable" },
};

export function EvaluationProgress({
  phase,
  scenarioCount,
  progressPercent,
  currentScenario,
  totalScenarios,
  currentController,
  currentEvent,
  statusMessage,
  error,
  onRetry,
}: {
  phase: EvaluationPhase;
  scenarioCount: number | null;
  progressPercent: number | null;
  currentScenario: number | null;
  totalScenarios: number | null;
  currentController: ControllerKey | null;
  currentEvent: string | null;
  statusMessage: string | null;
  error: string | null;
  onRetry: () => void;
}) {
  const badge = PHASE_BADGE[phase];
  const total = totalScenarios ?? scenarioCount;
  const eventLabel = prettyEvent(currentEvent);
  const controllerLabel = currentController
    ? CONTROLLER_META[currentController].label
    : null;

  const runLine =
    controllerLabel && eventLabel
      ? `Running ${controllerLabel} controller during ${eventLabel.toLowerCase()}.`
      : controllerLabel
        ? `Running ${controllerLabel} controller.`
        : statusMessage ?? "Working through the scenario set…";

  return (
    <Panel
      title="Evaluation status"
      right={<Badge tone={badge.tone} dot pulse={phase === "running" || phase === "starting"}>{badge.label}</Badge>}
    >
      <div className="flex flex-col gap-3">
        {phase === "checking" && (
          <p className="text-sm text-ops-muted">
            Contacting the evaluation backend…
          </p>
        )}

        {phase === "ready" && (
          <p className="text-sm text-ops-muted">
            Ready to run
            {total ? ` ${total} scenario${total === 1 ? "" : "s"}` : ""} across all
            three controllers against identical starting conditions. Press the
            button above to begin.
          </p>
        )}

        {phase === "starting" && (
          <>
            <p className="text-sm text-ops-muted">
              Starting evaluation… waiting for the backend to accept the run.
            </p>
            <ProgressBar indeterminate tone="bg-signal-amber" />
          </>
        )}

        {phase === "running" && (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-ops-text">
                {currentScenario != null && total != null
                  ? `Scenario ${currentScenario} of ${total}`
                  : currentScenario != null
                    ? `Scenario ${currentScenario}`
                    : "Evaluation running"}
              </span>
              <span className="font-mono text-sm tabular-nums text-ops-muted">
                {progressPercent != null ? `${Math.round(progressPercent)}%` : "…"}
              </span>
            </div>
            <ProgressBar
              percent={progressPercent}
              indeterminate={progressPercent == null}
            />
            <p className="text-sm text-ops-muted">{runLine}</p>
            {progressPercent == null && (
              <p className="text-[11px] text-ops-dim">
                The backend is not reporting per-scenario progress for this run —
                showing an indeterminate state rather than a fabricated one.
              </p>
            )}
          </>
        )}

        {phase === "completed" && (
          <p className="text-sm text-ops-muted">
            Evaluation complete. Results below come from the simulation API.
          </p>
        )}

        {phase === "failed" && (
          <div className="flex flex-col gap-2">
            <p className="rounded-md bg-signal-red/10 px-3 py-2 text-sm text-signal-red ring-1 ring-inset ring-signal-red/30">
              {error ?? "The evaluation run failed."}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="self-start rounded-md border border-ops-border px-3 py-1.5 text-xs font-semibold text-ops-text hover:bg-ops-raised"
            >
              Retry
            </button>
          </div>
        )}

        {phase === "backend-unavailable" && (
          <div className="flex flex-col gap-2">
            <p className="rounded-md bg-signal-red/10 px-3 py-2 text-sm text-signal-red ring-1 ring-inset ring-signal-red/30">
              {error ?? "The evaluation backend is unreachable."} Start the
              FastAPI evaluation server, or load sample data below to preview the
              layout.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="self-start rounded-md border border-ops-border px-3 py-1.5 text-xs font-semibold text-ops-text hover:bg-ops-raised"
            >
              Retry connection
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}
