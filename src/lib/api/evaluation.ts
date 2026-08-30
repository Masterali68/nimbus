/**
 * FastAPI evaluation client.
 *
 * The one place that knows the evaluation backend URL + endpoint shape. Every
 * component and hook goes through the functions exported here — nothing else
 * builds an evaluation URL or calls `fetch` for evaluation data.
 *
 * Base URL comes from `NEXT_PUBLIC_API_BASE_URL` (same var the live dashboard
 * uses). If Vishruth's final route names differ from the assumptions below,
 * this file is the only edit needed.
 *
 *   POST /api/evaluate          -> start a run   ({ runId } or a full result)
 *   GET  /api/evaluate/{runId}  -> run status / progress / final result
 *   GET  /api/evaluate/latest   -> most recent completed result (404 if none)
 */

const DEFAULT_BASE_URL = "http://localhost:8000";

const BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_BASE_URL
).replace(/\/$/, "");

/** Endpoint paths — adjust here only if the backend contract changes. */
export const EVAL_ENDPOINTS = {
  start: "/api/evaluate",
  status: (runId: string) => `/api/evaluate/${encodeURIComponent(runId)}`,
  latest: "/api/evaluate/latest",
  health: "/health",
} as const;

/** Per-request timeout. Starting a run can be slow, so it gets its own budget. */
const REQUEST_TIMEOUT_MS = 15_000;
const START_TIMEOUT_MS = 30_000;

export type ControllerKey = "naive" | "reactive" | "nimbus";
export const CONTROLLER_KEYS: ControllerKey[] = ["naive", "reactive", "nimbus"];

export type EvaluationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface ScoreComponent {
  key: string;
  label: string;
  kind: "reward" | "penalty";
  /** Optional per-controller contribution. `null` when the backend omits it. */
  value: number | null;
}

export interface ScoreBreakdown {
  rewards: ScoreComponent[];
  penalties: ScoreComponent[];
}

/** One controller's evaluation metrics. `null` = field not reported by backend. */
export interface ControllerMetrics {
  criticalUptimePct: number | null;
  waterAvailabilityPct: number | null;
  totalLoadShedKwh: number | null;
  sheddingEventCount: number | null;
  recoveryTimeS: number | null;
  minBatteryPct: number | null;
  instabilityIndex: number | null;
  criticalInterruptions: number | null;
  nimbusScore: number | null;
  scoreBreakdown: ScoreBreakdown | null;
}

/** Shared scenario conditions every controller was run against. */
export interface ScenarioDescriptor {
  seed: number | null;
  event: string | null;
  severity: number | string | null;
  initialBatteryPct: number | null;
  eventDurationS: number | null;
  demandSpikePct: number | null;
  recoverySpeed: number | string | null;
  timestepS: number | null;
  scenarioCount: number | null;
}

export interface EvaluationResult {
  runId: string | null;
  generatedAt: number | null;
  durationMs: number | null;
  scenario: ScenarioDescriptor;
  controllers: Record<ControllerKey, ControllerMetrics>;
  /** "live" = from FastAPI. "fallback" = local dev sample data, never real. */
  source: "live" | "fallback";
}

export interface EvaluationProgress {
  runId: string | null;
  status: EvaluationRunStatus;
  completedScenarios: number | null;
  totalScenarios: number | null;
  /** 0–100, or `null` when the backend exposes no progress detail. */
  percent: number | null;
  currentController: ControllerKey | null;
  currentEvent: string | null;
  message: string | null;
  result: EvaluationResult | null;
  error: string | null;
}

export interface StartEvaluationOptions {
  scenarioCount?: number;
  seed?: number;
}

export class EvaluationApiError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "EvaluationApiError";
  }
}

// ---------------------------------------------------------------------------
// low-level request
// ---------------------------------------------------------------------------

async function request<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(),
    init?.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    if (!res.ok) {
      throw new EvaluationApiError(`${path} responded ${res.status}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch (err) {
    if (err instanceof EvaluationApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new EvaluationApiError(`${path} timed out`);
    }
    throw new EvaluationApiError(`Could not reach evaluation backend (${path})`, err);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// tolerant normalisation (camelCase | snake_case, flat | nested, missing)
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

function asRecord(v: unknown): Raw {
  return v && typeof v === "object" ? (v as Raw) : {};
}

/** First finite number among candidates, else `null`. */
function numOrNull(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof c === "string" && c.trim() !== "" && Number.isFinite(Number(c))) {
      return Number(c);
    }
  }
  return null;
}

function strOrNull(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c;
  }
  return null;
}

function pick(raw: Raw, ...keys: string[]): unknown {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null) return raw[k];
  }
  return undefined;
}

function normalizeController(raw: unknown): ControllerMetrics {
  const r = asRecord(raw);
  const m = asRecord(pick(r, "metrics"));
  const src = { ...m, ...r };
  return {
    criticalUptimePct: numOrNull(
      pick(src, "criticalUptimePct", "critical_uptime_pct", "criticalServiceUptimePct", "critical_service_uptime_pct", "criticalUptime"),
    ),
    waterAvailabilityPct: numOrNull(
      pick(src, "waterAvailabilityPct", "water_availability_pct", "waterAvailability", "water_availability"),
    ),
    totalLoadShedKwh: numOrNull(
      pick(src, "totalLoadShedKwh", "total_load_shed_kwh", "loadShedKwh", "load_shed_kwh", "totalLoadShed"),
    ),
    sheddingEventCount: numOrNull(
      pick(src, "sheddingEventCount", "shedding_event_count", "sheddingEvents", "shedding_events", "sheddingCount"),
    ),
    recoveryTimeS: numOrNull(
      pick(src, "recoveryTimeS", "recovery_time_s", "recoveryTimeSeconds", "recovery_time_seconds", "recoveryTime"),
    ),
    minBatteryPct: numOrNull(
      pick(src, "minBatteryPct", "min_battery_pct", "minimumBatteryPct", "minimum_battery_pct", "minBattery"),
    ),
    instabilityIndex: numOrNull(
      pick(src, "instabilityIndex", "instability_index", "energyBalanceInstability", "energy_balance_instability", "instability"),
    ),
    criticalInterruptions: numOrNull(
      pick(src, "criticalInterruptions", "critical_interruptions", "criticalServiceInterruptions", "critical_service_interruptions"),
    ),
    nimbusScore: numOrNull(
      pick(src, "nimbusScore", "nimbus_score", "prototypeScore", "prototype_score", "score"),
    ),
    scoreBreakdown: normalizeBreakdown(pick(src, "scoreBreakdown", "score_breakdown", "breakdown")),
  };
}

function normalizeBreakdown(raw: unknown): ScoreBreakdown | null {
  if (!raw || typeof raw !== "object") return null;
  const r = asRecord(raw);
  const toComp = (kind: "reward" | "penalty") => (entry: unknown): ScoreComponent | null => {
    const e = asRecord(entry);
    const label = strOrNull(pick(e, "label", "name", "key"));
    if (!label) return null;
    return {
      key: strOrNull(pick(e, "key", "id", "name")) ?? label,
      label,
      kind,
      value: numOrNull(pick(e, "value", "contribution", "points", "weight")),
    };
  };
  const rewards = Array.isArray(pick(r, "rewards", "reward"))
    ? (pick(r, "rewards", "reward") as unknown[]).map(toComp("reward")).filter(Boolean) as ScoreComponent[]
    : [];
  const penalties = Array.isArray(pick(r, "penalties", "penalty"))
    ? (pick(r, "penalties", "penalty") as unknown[]).map(toComp("penalty")).filter(Boolean) as ScoreComponent[]
    : [];
  if (rewards.length === 0 && penalties.length === 0) return null;
  return { rewards, penalties };
}

function normalizeScenario(raw: unknown): ScenarioDescriptor {
  const r = asRecord(raw);
  return {
    seed: numOrNull(pick(r, "seed", "scenarioSeed", "scenario_seed")),
    event: strOrNull(pick(r, "event", "eventType", "event_type")),
    severity:
      numOrNull(pick(r, "severity", "eventSeverity", "event_severity")) ??
      strOrNull(pick(r, "severity", "eventSeverity", "event_severity")),
    initialBatteryPct: numOrNull(
      pick(r, "initialBatteryPct", "initial_battery_pct", "startingBatteryPct", "starting_battery_pct"),
    ),
    eventDurationS: numOrNull(
      pick(r, "eventDurationS", "event_duration_s", "eventDurationSeconds", "event_duration_seconds", "eventDuration"),
    ),
    demandSpikePct: numOrNull(
      pick(r, "demandSpikePct", "demand_spike_pct", "demandSpike", "demand_spike"),
    ),
    recoverySpeed:
      numOrNull(pick(r, "recoverySpeed", "recovery_speed", "recoveryRate", "recovery_rate")) ??
      strOrNull(pick(r, "recoverySpeed", "recovery_speed", "recoveryRate", "recovery_rate")),
    timestepS: numOrNull(pick(r, "timestepS", "timestep_s", "timestep", "dtSeconds", "dt_seconds")),
    scenarioCount: numOrNull(
      pick(r, "scenarioCount", "scenario_count", "numScenarios", "num_scenarios", "scenarios"),
    ),
  };
}

function normalizeResult(raw: unknown): EvaluationResult {
  const r = asRecord(raw);
  const controllersRaw = asRecord(
    pick(r, "controllers", "results", "byController", "by_controller"),
  );
  const scenario = normalizeScenario(
    pick(r, "scenario", "conditions", "scenarioDescriptor", "scenario_descriptor"),
  );
  return {
    runId: strOrNull(pick(r, "runId", "run_id", "id")),
    generatedAt:
      numOrNull(pick(r, "generatedAt", "generated_at", "finishedAt", "finished_at")) ??
      (() => {
        const iso = strOrNull(pick(r, "generatedAt", "finishedAt", "completedAt"));
        const t = iso ? Date.parse(iso) : NaN;
        return Number.isFinite(t) ? t : null;
      })(),
    durationMs:
      numOrNull(pick(r, "durationMs", "duration_ms")) ??
      (() => {
        const s = numOrNull(pick(r, "durationS", "duration_s", "durationSeconds"));
        return s == null ? null : Math.round(s * 1000);
      })(),
    scenario,
    controllers: {
      naive: normalizeController(pick(controllersRaw, "naive", "Naive", "NAIVE")),
      reactive: normalizeController(pick(controllersRaw, "reactive", "Reactive", "REACTIVE")),
      nimbus: normalizeController(pick(controllersRaw, "nimbus", "Nimbus", "NIMBUS")),
    },
    source: "live",
  };
}

function looksLikeResult(raw: unknown): boolean {
  const r = asRecord(raw);
  return Boolean(pick(r, "controllers", "results", "byController", "by_controller"));
}

function normalizeController_(k: string): ControllerKey | null {
  const low = k.toLowerCase();
  return low === "naive" || low === "reactive" || low === "nimbus" ? (low as ControllerKey) : null;
}

function normalizeProgress(raw: unknown): EvaluationProgress {
  const r = asRecord(raw);
  const statusRaw = strOrNull(pick(r, "status", "state"))?.toLowerCase() ?? "running";
  const status: EvaluationRunStatus =
    statusRaw === "completed" || statusRaw === "done" || statusRaw === "finished" || statusRaw === "success"
      ? "completed"
      : statusRaw === "failed" || statusRaw === "error"
        ? "failed"
        : statusRaw === "queued" || statusRaw === "pending"
          ? "queued"
          : "running";

  const completed = numOrNull(
    pick(r, "completedScenarios", "completed_scenarios", "completed", "currentScenario", "current_scenario", "scenarioIndex", "scenario_index"),
  );
  const total = numOrNull(
    pick(r, "totalScenarios", "total_scenarios", "total", "scenarioCount", "scenario_count"),
  );
  let percent = numOrNull(pick(r, "percent", "progress", "progressPct", "progress_pct"));
  if (percent != null && percent <= 1 && percent >= 0) percent = percent * 100;
  if (percent == null && completed != null && total != null && total > 0) {
    percent = (completed / total) * 100;
  }
  if (percent != null) percent = Math.max(0, Math.min(100, percent));

  const resultRaw = pick(r, "result", "results", "evaluation");
  const embedded =
    resultRaw && looksLikeResult(resultRaw) ? normalizeResult(resultRaw) : null;
  const wholeIsResult =
    !embedded && status === "completed" && looksLikeResult(r) ? normalizeResult(r) : null;

  const ctrlRaw = strOrNull(pick(r, "currentController", "current_controller", "controller"));

  return {
    runId: strOrNull(pick(r, "runId", "run_id", "id")),
    status,
    completedScenarios: completed,
    totalScenarios: total,
    percent,
    currentController: ctrlRaw ? normalizeController_(ctrlRaw) : null,
    currentEvent: strOrNull(pick(r, "currentEvent", "current_event", "event", "scenarioEvent", "scenario_event")),
    message: strOrNull(pick(r, "message", "statusMessage", "status_message", "detail")),
    result: embedded ?? wholeIsResult,
    error: strOrNull(pick(r, "error", "errorMessage", "error_message")),
  };
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/** Is the evaluation backend reachable at all? */
export async function checkEvaluationBackend(): Promise<boolean> {
  try {
    await request(EVAL_ENDPOINTS.health, { timeoutMs: 3500 });
    return true;
  } catch {
    // Some deployments have no /health — fall back to probing `latest`.
    try {
      await request(EVAL_ENDPOINTS.latest, { timeoutMs: 3500 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Start an evaluation run. Returns a `runId` to poll, and/or a full result if
 * the backend runs synchronously and replies with the finished evaluation.
 */
export async function startEvaluation(
  options: StartEvaluationOptions = {},
): Promise<{ runId: string | null; result: EvaluationResult | null }> {
  const raw = await request<unknown>(EVAL_ENDPOINTS.start, {
    method: "POST",
    body: JSON.stringify({
      ...(options.scenarioCount != null ? { scenarioCount: options.scenarioCount } : {}),
      ...(options.seed != null ? { seed: options.seed } : {}),
    }),
    timeoutMs: START_TIMEOUT_MS,
  });

  const r = asRecord(raw);
  const runId = strOrNull(pick(r, "runId", "run_id", "id"));
  const result = looksLikeResult(raw) ? normalizeResult(raw) : null;

  if (!runId && !result) {
    throw new EvaluationApiError(
      "Evaluation backend did not return a run id or a result.",
    );
  }
  return { runId, result };
}

/** Poll a run's status / progress. */
export async function getEvaluationStatus(
  runId: string,
): Promise<EvaluationProgress> {
  const raw = await request<unknown>(EVAL_ENDPOINTS.status(runId));
  const progress = normalizeProgress(raw);
  if (!progress.runId) progress.runId = runId;
  return progress;
}

/** Fetch the most recent completed evaluation, or `null` if there is none. */
export async function getLatestEvaluation(): Promise<EvaluationResult | null> {
  try {
    const raw = await request<unknown>(EVAL_ENDPOINTS.latest);
    if (!raw || !looksLikeResult(raw)) return null;
    return normalizeResult(raw);
  } catch (err) {
    if (err instanceof EvaluationApiError && /responded 404/.test(err.message)) {
      return null;
    }
    throw err;
  }
}
