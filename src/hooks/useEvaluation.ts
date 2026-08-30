"use client";

/**
 * useEvaluation — drives the Controller Evaluation page.
 *
 * Responsibilities:
 *   • probe the evaluation backend on mount; load the latest completed result
 *   • start a run and follow it to completion via status polling
 *   • expose progress (percent / scenario counters / message) or, when the
 *     backend gives no detail, an honest indeterminate loading state
 *   • guard against duplicate runs
 *   • offer an explicit, clearly-labelled local sample-data fallback
 *
 * Deliberately simple: one POST + interval polling. No WebSocket — the live
 * telemetry socket is a separate concern and an eval socket is not yet defined.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkEvaluationBackend,
  getEvaluationStatus,
  getLatestEvaluation,
  startEvaluation,
  type ControllerKey,
  type EvaluationResult,
  type StartEvaluationOptions,
} from "@/lib/api/evaluation";
import { EVALUATION_FALLBACK } from "@/lib/mock/evaluationFallback";

export type EvaluationPhase =
  | "checking"
  | "ready"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "backend-unavailable";

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_FAILURES = 4;
/** Overall client-side ceiling on a single run before we give up. */
const RUN_TIMEOUT_MS = 180_000;

export interface UseEvaluation {
  phase: EvaluationPhase;
  result: EvaluationResult | null;
  /** True when `result` is the local sample, not a live run. */
  usingFallback: boolean;
  runId: string | null;
  /** 0–100, or null when the backend exposes no progress detail. */
  progressPercent: number | null;
  currentScenario: number | null;
  totalScenarios: number | null;
  currentController: ControllerKey | null;
  currentEvent: string | null;
  statusMessage: string | null;
  error: string | null;
  /** True while a run is starting or in flight. */
  isRunning: boolean;
  /** True while the initial backend probe is in flight. */
  isChecking: boolean;
  runEvaluation: (options?: StartEvaluationOptions) => void;
  retryConnection: () => void;
  showSampleData: () => void;
  dismissSampleData: () => void;
}

export function useEvaluation(): UseEvaluation {
  const [phase, setPhase] = useState<EvaluationPhase>("checking");
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [currentScenario, setCurrentScenario] = useState<number | null>(null);
  const [totalScenarios, setTotalScenarios] = useState<number | null>(null);
  const [currentController, setCurrentController] = useState<ControllerKey | null>(null);
  const [currentEvent, setCurrentEvent] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unmountedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFailuresRef = useRef(0);
  const runningRef = useRef(false);
  const lastPercentRef = useRef(0);
  const runTokenRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (runTimeoutRef.current) {
      clearTimeout(runTimeoutRef.current);
      runTimeoutRef.current = null;
    }
  }, []);

  const resetProgress = useCallback(() => {
    lastPercentRef.current = 0;
    setProgressPercent(null);
    setCurrentScenario(null);
    setTotalScenarios(null);
    setCurrentController(null);
    setCurrentEvent(null);
    setStatusMessage(null);
  }, []);

  const finishRun = useCallback(
    (finalResult: EvaluationResult) => {
      if (unmountedRef.current) return;
      clearTimers();
      runningRef.current = false;
      setResult(finalResult);
      setUsingFallback(finalResult.source === "fallback");
      setProgressPercent(100);
      setStatusMessage(null);
      setError(null);
      setPhase("completed");
    },
    [clearTimers],
  );

  const failRun = useCallback(
    (message: string) => {
      if (unmountedRef.current) return;
      clearTimers();
      runningRef.current = false;
      setError(message);
      setPhase("failed");
    },
    [clearTimers],
  );

  // ---- initial backend probe -------------------------------------------------
  const probeBackend = useCallback(async () => {
    setPhase("checking");
    setError(null);
    const ok = await checkEvaluationBackend();
    if (unmountedRef.current) return;
    if (!ok) {
      setPhase("backend-unavailable");
      return;
    }
    try {
      const latest = await getLatestEvaluation();
      if (unmountedRef.current) return;
      if (latest) {
        setResult(latest);
        setUsingFallback(false);
      }
    } catch {
      /* latest is optional — a missing/erroring endpoint is not fatal here */
    }
    if (!unmountedRef.current) setPhase("ready");
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    // Defer one macrotask so the effect body itself does no synchronous state
    // updates (mirrors useNimbusTelemetry, and keeps StrictMode's double-invoke
    // from racing the probe).
    const boot = setTimeout(() => {
      if (!unmountedRef.current) void probeBackend();
    }, 0);
    return () => {
      unmountedRef.current = true;
      runTokenRef.current += 1;
      clearTimeout(boot);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- polling -------------------------------------------------------------
  const pollOnce = useCallback(
    async (id: string, token: number) => {
      try {
        const progress = await getEvaluationStatus(id);
        if (unmountedRef.current || token !== runTokenRef.current) return;
        pollFailuresRef.current = 0;

        // monotonic percent — never let a late frame walk it backwards
        if (progress.percent != null) {
          const next = Math.max(lastPercentRef.current, progress.percent);
          lastPercentRef.current = next;
          setProgressPercent(next);
        }
        if (progress.completedScenarios != null) {
          setCurrentScenario(progress.completedScenarios);
        }
        if (progress.totalScenarios != null) {
          setTotalScenarios(progress.totalScenarios);
        }
        if (progress.currentController) setCurrentController(progress.currentController);
        if (progress.currentEvent) setCurrentEvent(progress.currentEvent);
        if (progress.message) setStatusMessage(progress.message);

        if (progress.status === "completed") {
          const finalResult = progress.result ?? (await getLatestEvaluation());
          if (unmountedRef.current || token !== runTokenRef.current) return;
          if (finalResult) {
            finishRun({ ...finalResult, source: "live" });
          } else {
            failRun(
              "Evaluation finished but the backend returned no result payload.",
            );
          }
          return;
        }
        if (progress.status === "failed") {
          failRun(progress.error ?? "The evaluation run failed on the backend.");
          return;
        }
        setPhase("running");
      } catch {
        if (unmountedRef.current || token !== runTokenRef.current) return;
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current >= MAX_POLL_FAILURES) {
          failRun("Lost contact with the evaluation backend during the run.");
        }
      }
    },
    [failRun, finishRun],
  );

  // ---- run ---------------------------------------------------------------
  const runEvaluation = useCallback(
    (options?: StartEvaluationOptions) => {
      if (runningRef.current) return; // guard: no duplicate runs
      runningRef.current = true;
      const token = ++runTokenRef.current;

      clearTimers();
      resetProgress();
      pollFailuresRef.current = 0;
      setError(null);
      setUsingFallback(false);
      setRunId(null);
      setPhase("starting");

      runTimeoutRef.current = setTimeout(() => {
        if (token === runTokenRef.current) {
          failRun("Evaluation timed out. The backend is taking longer than expected.");
        }
      }, RUN_TIMEOUT_MS);

      void (async () => {
        try {
          const { runId: newRunId, result: syncResult } = await startEvaluation(
            options ?? {},
          );
          if (unmountedRef.current || token !== runTokenRef.current) return;

          if (syncResult) {
            finishRun({ ...syncResult, source: "live" });
            return;
          }
          if (!newRunId) {
            failRun("Evaluation backend did not return a run id.");
            return;
          }
          setRunId(newRunId);
          setPhase("running");
          void pollOnce(newRunId, token);
          pollTimerRef.current = setInterval(
            () => void pollOnce(newRunId, token),
            POLL_INTERVAL_MS,
          );
        } catch (err) {
          if (unmountedRef.current || token !== runTokenRef.current) return;
          failRun(
            err instanceof Error
              ? `Could not start evaluation: ${err.message}`
              : "Could not start evaluation.",
          );
        }
      })();
    },
    [clearTimers, failRun, finishRun, pollOnce, resetProgress],
  );

  const retryConnection = useCallback(() => {
    clearTimers();
    runningRef.current = false;
    runTokenRef.current += 1;
    resetProgress();
    setError(null);
    void probeBackend();
  }, [clearTimers, probeBackend, resetProgress]);

  const showSampleData = useCallback(() => {
    clearTimers();
    runningRef.current = false;
    runTokenRef.current += 1;
    setResult(EVALUATION_FALLBACK);
    setUsingFallback(true);
    setError(null);
  }, [clearTimers]);

  const dismissSampleData = useCallback(() => {
    setUsingFallback(false);
    setResult(null);
    void probeBackend();
  }, [probeBackend]);

  const isRunning = phase === "starting" || phase === "running";

  return {
    phase,
    result,
    usingFallback,
    runId,
    progressPercent,
    currentScenario,
    totalScenarios,
    currentController,
    currentEvent,
    statusMessage,
    error,
    isRunning,
    isChecking: phase === "checking",
    runEvaluation,
    retryConnection,
    showSampleData,
    dismissSampleData,
  };
}
