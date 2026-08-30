"use client";

import Link from "next/link";
import { useEvaluation } from "@/hooks/useEvaluation";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { DemoGuide } from "@/components/demo/DemoGuide";
import { ComparisonTable } from "./ComparisonTable";
import { ControllerCards } from "./ControllerCards";
import { EvaluationProgress } from "./EvaluationProgress";
import { FairComparison } from "./FairComparison";
import { NimbusScorePanel } from "./NimbusScorePanel";
import { ResultsCharts } from "./ResultsCharts";
import { RunEvaluationButton } from "./RunEvaluationButton";
import { SampleDataBanner } from "./SampleDataBanner";

function relativeTime(ts: number | null): string | null {
  if (ts == null) return null;
  const diff = Date.now() - ts;
  if (diff < 0 || !Number.isFinite(diff)) return null;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export function EvaluationView() {
  const ev = useEvaluation();
  const {
    phase,
    result,
    usingFallback,
    isRunning,
    isChecking,
    runEvaluation,
    retryConnection,
    showSampleData,
    dismissSampleData,
  } = ev;

  const scenarioCount = result?.scenario.scenarioCount ?? null;
  const hasResult = result != null;
  const showResults = hasResult;
  const runDisabled = isChecking || phase === "backend-unavailable";

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
      {/* header */}
      <header className="flex flex-col gap-4 border-b border-ops-border pb-5">
        <div className="flex items-center gap-3 text-xs">
          <Link href="/" className="text-ops-muted hover:text-ops-text">
            ← Live dashboard
          </Link>
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-ops-text">
              Controller Evaluation
            </h1>
            <p className="max-w-2xl text-sm text-ops-muted">
              Each controller is tested against the same simulated starting
              conditions and disturbances.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {scenarioCount ? (
              <Badge tone="neutral">
                {scenarioCount} scenarios · 3 controllers
              </Badge>
            ) : (
              <Badge tone="neutral">3 controllers</Badge>
            )}
            <RunEvaluationButton
              scenarioCount={scenarioCount}
              isRunning={isRunning}
              hasResult={hasResult}
              disabled={runDisabled}
              onRun={() => runEvaluation(scenarioCount ? { scenarioCount } : undefined)}
            />
          </div>
        </div>
      </header>

      <EvaluationProgress
        phase={phase}
        scenarioCount={scenarioCount}
        progressPercent={ev.progressPercent}
        currentScenario={ev.currentScenario}
        totalScenarios={ev.totalScenarios}
        currentController={ev.currentController}
        currentEvent={ev.currentEvent}
        statusMessage={ev.statusMessage}
        error={ev.error}
        onRetry={retryConnection}
      />

      {usingFallback && <SampleDataBanner onDismiss={dismissSampleData} />}

      {phase === "backend-unavailable" && !usingFallback && (
        <Panel title="Preview with sample data">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ops-muted">
              The evaluation backend is not reachable. You can load a clearly
              labelled local sample so the layout can be reviewed — the numbers
              are illustrative and are never presented as real results.
            </p>
            <button
              type="button"
              onClick={showSampleData}
              className="self-start rounded-md border border-signal-amber/40 px-3 py-1.5 text-xs font-semibold text-signal-amber hover:bg-signal-amber/10"
            >
              Show sample evaluation
            </button>
          </div>
        </Panel>
      )}

      {/* empty state */}
      {!showResults && phase === "ready" && (
        <Panel title="No evaluation results yet">
          <p className="text-sm text-ops-muted">
            No evaluation has been run yet. Press{" "}
            <span className="font-semibold text-ops-text">
              Run controller evaluation
            </span>{" "}
            above to test Naive, Reactive, and Nimbus against the same scenarios
            and populate the comparison table and charts.
          </p>
        </Panel>
      )}

      {/* running, nothing to show yet */}
      {!showResults && (phase === "starting" || phase === "running") && (
        <Panel title="Results">
          <p className="text-sm text-ops-muted">
            Results will appear here as soon as the run finishes.
          </p>
        </Panel>
      )}

      {/* completed results */}
      {showResults && result && (
        <div className="flex flex-col gap-5">
          {phase !== "completed" && (
            <p className="text-[11px] uppercase tracking-wide text-ops-dim">
              {usingFallback
                ? "Sample data"
                : `Last completed evaluation${
                    relativeTime(result.generatedAt)
                      ? ` · ${relativeTime(result.generatedAt)}`
                      : ""
                  }${result.scenario.seed != null ? ` · seed #${result.scenario.seed}` : ""}`}
            </p>
          )}

          <FairComparison scenario={result.scenario} />
          <ComparisonTable result={result} />
          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ops-muted">
              Results at a glance
            </h2>
            <ResultsCharts result={result} />
          </section>
          <NimbusScorePanel result={result} />
          <ControllerCards />
        </div>
      )}

      <DemoGuide />

      <footer className="border-t border-ops-border pt-4 text-[11px] leading-relaxed text-ops-dim">
        Prototype evaluation. Metrics are produced by the Nimbus simulation API.
        The Prototype Nimbus Score weighting is configurable and is not presented
        as a scientifically optimal utility-grid metric. Nimbus does not predict
        weather and is not represented as ready to control a real electrical grid.
      </footer>
    </div>
  );
}
