"use client";

import { cn } from "@/components/ui/cn";

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

/**
 * Primary call-to-action for the evaluation page. Disables itself while a run
 * is in flight so judges can't fire duplicate evaluations.
 */
export function RunEvaluationButton({
  scenarioCount,
  isRunning,
  hasResult,
  disabled = false,
  onRun,
}: {
  scenarioCount: number | null;
  isRunning: boolean;
  hasResult: boolean;
  disabled?: boolean;
  onRun: () => void;
}) {
  const label =
    scenarioCount && scenarioCount > 1
      ? `Run ${scenarioCount}-scenario evaluation`
      : "Run controller evaluation";

  return (
    <button
      type="button"
      onClick={onRun}
      disabled={disabled || isRunning}
      aria-busy={isRunning}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold uppercase tracking-wide transition-colors",
        "bg-signal-blue text-ops-bg hover:bg-signal-cyan",
        (disabled || isRunning) &&
          "cursor-not-allowed bg-ops-raised text-ops-dim hover:bg-ops-raised",
      )}
    >
      {isRunning ? <Spinner /> : null}
      {isRunning ? "Evaluation running…" : hasResult ? `${label} again` : label}
    </button>
  );
}
