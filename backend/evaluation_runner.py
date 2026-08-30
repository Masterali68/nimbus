"""Isolated evaluation runner for the Nimbus backend.

Runs a set of deterministic scenarios against Naive, Reactive and Nimbus, one
scenario at a time, recreating the exact same initial simulation state before
EVERY controller run so the comparison is fair by construction.

Isolation guarantees:
  * The evaluation NEVER touches the live dashboard ``StateManager`` or the
    live ``BackendRuntime`` loop. It builds its own fresh simulation instances
    via the shared ``SimulationAdapter``/``ControllerAdapter`` seams and records
    its own private trace.
  * A controller/simulation failure marks that run as failed and continues; an
    unexpected top-level error fails the whole run — it never crashes the
    backend or the live demo loop.
  * Exactly one evaluation runs at a time (a second ``start`` is refused).

The runner uses REAL controller/simulation code when it is available on this
machine (via the standard ``NIMBUS_SIMULATION_BACKEND`` /
``NIMBUS_CONTROLLER_BACKEND`` adapters, which import Lalith's / Ali's modules).
When ``require_real`` is set and a real backend cannot be built, the run fails
with a clear integration error instead of fabricating results.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import statistics
import threading
import time
import uuid
from collections import deque
from typing import Any

from config import Config
from evaluation_models import (
    ComparisonResult,
    ControllerAggregate,
    ControllerMetrics,
    ControllerMode,
    ControllerSummary,
    EvaluationProgress,
    EvaluationResult,
    EvaluationRunStarted,
    EvaluationRunRequest,
    EvaluationSummary,
    MetricAggregate,
    ScenarioConfig,
    ScenarioDescriptor,
    ScenarioEvaluation,
    ScoreBreakdown,
    ScoreComponent,
)
from evaluation_scenarios import (
    ScenarioGeneratorError,
    build_scenarios,
    generate_local_scenarios,
    validate_selected_events,
)
from integrations import (
    ControllerAdapter,
    ControllerAdapterError,
    SimulationAdapter,
    SimulationAdapterError,
    build_controller_adapter,
    build_simulation_adapter,
)
from metric_fallback import compute_metrics_for_trace, detect_metric_source

logger = logging.getLogger("nimbus.evaluation")

DEFAULT_CONTROLLERS: tuple[ControllerMode, ...] = ("naive", "reactive", "nimbus")

MAX_CONCURRENT = 1  # single evaluation slot


class EvaluationError(RuntimeError):
    """Base class for evaluation subsystem errors."""


class EvaluationInProgressError(EvaluationError):
    """A run is already queued/running; only one is allowed."""


class EvaluationInvalidRequestError(EvaluationError):
    """The request payload failed validation."""


class EvaluationIntegrationError(EvaluationError):
    """A required real module (Lalith/Ali) is missing for an explicit request."""


def _now_ms() -> int:
    return int(time.time() * 1000)


# --------------------------------------------------------------------------- #
# Per-controller run (single scenario)
# --------------------------------------------------------------------------- #
def _record_tick(
    sim: SimulationAdapter,
    sim_state: Any,
    decision: dict,
    controller_mode: ControllerMode,
) -> dict:
    """Build one compact trace record from the post-control simulation state."""
    snap = sim.get_state(sim_state)
    resources: dict[str, dict] = {}
    raw = snap.get("resources") or {}
    for name, res in raw.items():
        resources[name] = {
            "state": str(res.get("state", "normal")),
            "operatingPct": round(float(res.get("operatingPct", 100.0)), 3),
            "currentDemandKw": round(float(res.get("demandKw", 0.0)), 3),
            "baselineDemandKw": round(float(res.get("maxDemandKw", 0.0)), 3),
        }
    return {
        "tick": snap.get("tick", 0),
        "batteryPct": round(float(snap.get("batteryPct", 0.0)), 3),
        "netPowerKw": round(float(snap.get("netPowerKw", 0.0)), 3),
        "filteredNetPowerKw": round(float(snap.get("filteredNetPowerKw", snap.get("netPowerKw", 0.0))), 3),
        "severity": snap.get("severity", "stable"),
        "trajectory": snap.get("trajectory", "stable"),
        "controllerMode": controller_mode,
        "resources": resources,
    }


def _apply_initial_battery(sim: SimulationAdapter, sim_state: Any, battery_pct: float) -> None:
    """Best-effort battery override. No-op for non-dict adapters (fair for all)."""
    if not isinstance(sim_state, dict):
        return
    try:
        capacity = float(sim.get_state(sim_state).get("batteryCapacityKwh", 0.0))
        if capacity > 0.0 and "prev" in sim_state and isinstance(sim_state["prev"], dict):
            sim_state["prev"]["battery_kwh"] = battery_pct / 100.0 * capacity
    except Exception:  # noqa: BLE001 - override is best-effort only
        logger.debug("battery override not applicable for this adapter", exc_info=True)


def run_one_controller(
    sim: SimulationAdapter,
    controller: ControllerAdapter,
    controller_mode: ControllerMode,
    scenario: ScenarioConfig,
    config: Config,
    timeout_s: float = 120.0,
) -> ControllerMetrics:
    """Run one controller across one scenario and compute its metrics.

    A fresh simulation state is created from the scenario seed BEFORE this call
    (see ``run_scenario``), so every controller observes the identical start.
    """
    # Recreate the exact same initial state for this controller (isolation).
    sim_state = sim.create_initial_state(scenario.seed)
    if scenario.initial_battery_pct is not None:
        # Best-effort battery override for dict-based adapters. Applied BEFORE
        # every controller identically, so it never breaks fairness even when
        # the active adapter cannot honour it (real adapters own their initial
        # state; the override is then tolerated silently for that adapter).
        _apply_initial_battery(sim, sim_state, scenario.initial_battery_pct)
    if scenario.event_type:
        sim.apply_event(sim_state, scenario.event_type, {"durationTicks": scenario.duration_ticks})

    trace: list[dict] = []
    prev_controller_state: dict | None = None
    dt = scenario.timestep_s
    started = time.monotonic()
    for _ in range(scenario.max_ticks):
        if time.monotonic() - started > timeout_s:
            raise TimeoutError(f"evaluation run exceeded {timeout_s}s budget")
        island_before = sim.get_state(sim_state)
        decision = controller.decide(
            controller_mode, island_before, prev_controller_state, dt
        )
        prev_controller_state = decision.get("controllerState")
        sim_state = sim.tick(sim_state, dt, decision.get("resourceUpdates"))
        trace.append(_record_tick(sim, sim_state, decision, controller_mode))

    return compute_metrics_for_trace(
        controller_mode, trace, timestep_s=dt, use_ali=True
    )


def run_scenario(
    sim: SimulationAdapter,
    controller: ControllerAdapter,
    scenario: ScenarioConfig,
    controllers: list[ControllerMode],
    config: Config,
    index: int | None = None,
    on_controller_started=None,
) -> ScenarioEvaluation:
    """Run all controllers on one scenario; each starts from the identical seed."""
    controller_results: dict[ControllerMode, ControllerMetrics] = {}
    for mode in controllers:
        if on_controller_started is not None:
            on_controller_started(mode)
        try:
            controller_results[mode] = run_one_controller(
                sim, controller, mode, scenario, config
            )
        except Exception as exc:  # noqa: BLE001 - capture per-controller failures
            logger.exception("controller %s failed on scenario", mode)
            controller_results[mode] = ControllerMetrics(
                controller_mode=mode,
                errors=[f"{type(exc).__name__}: {exc}"],
                metric_source="local_fallback",
            )
    return ScenarioEvaluation(
        scenario_index=index if index is not None else scenario.seed,
        scenario=scenario,
        controllers=controller_results,
    )


# --------------------------------------------------------------------------- #
# Aggregation
# --------------------------------------------------------------------------- #
def _aggregate(values: list[float]) -> MetricAggregate:
    if not values:
        return MetricAggregate(count=0)
    return MetricAggregate(
        mean=round(statistics.mean(values), 4),
        median=round(statistics.median(values), 4),
        min=round(min(values), 4),
        max=round(max(values), 4),
        p90=round(sorted(values)[max(0, int(0.9 * len(values)) - 1)], 4),
        count=len(values),
    )


_METRIC_FIELDS = (
    ("criticalServiceUptimePct", "critical_service_uptime_pct"),
    ("waterAvailabilityPct", "water_availability_pct"),
    ("totalLoadShedKwh", "total_load_shed_kwh"),
    ("sheddingEventCount", "shedding_event_count"),
    ("recoveryTimeSeconds", "recovery_time_seconds"),
    ("minimumBatteryPct", "minimum_battery_pct"),
    ("instabilityScore", "instability_score"),
    ("criticalServiceInterruptions", "critical_service_interruptions"),
)

_METRIC_LABELS = {
    "criticalServiceUptimePct": "Critical-service uptime (%)",
    "waterAvailabilityPct": "Water availability (%)",
    "totalLoadShedKwh": "Total load shed (kWh)",
    "sheddingEventCount": "Shedding events",
    "recoveryTimeSeconds": "Recovery time (s)",
    "minimumBatteryPct": "Minimum battery (%)",
    "instabilityScore": "Energy-balance instability",
    "criticalServiceInterruptions": "Critical-service interruptions",
}


def build_comparison(
    scenario_results: list[ScenarioEvaluation], controllers: list[ControllerMode]
) -> ComparisonResult:
    per_controller: dict[str, dict[str, list[float]]] = {
        mode: {wire: [] for wire, _ in _METRIC_FIELDS} for mode in controllers
    }
    scores: dict[str, list[float]] = {mode: [] for mode in controllers}

    for scenario in scenario_results:
        for mode in controllers:
            cm = scenario.controllers.get(mode)
            if cm is None or cm.errors:
                continue
            for wire, attr in _METRIC_FIELDS:
                v = getattr(cm, attr)
                if v is not None:
                    per_controller[mode][wire].append(float(v))
            if cm.prototype_score is not None:
                scores[mode].append(float(cm.prototype_score))

    agg: dict[ControllerMode, ControllerAggregate] = {}
    for mode in controllers:
        metrics_agg = {
            wire: _aggregate(vals) for wire, vals in per_controller[mode].items()
        }
        agg[mode] = ControllerAggregate(
            controller_mode=mode,
            metrics=metrics_agg,
            prototype_score=_aggregate(scores[mode]) if scores[mode] else None,
        )
    return ComparisonResult(controllers=agg, metric_labels=dict(_METRIC_LABELS))


_SUMMARY_FIELDS = (
    "critical_service_uptime_pct",
    "water_availability_pct",
    "total_load_shed_kwh",
    "shedding_event_count",
    "recovery_time_seconds",
    "minimum_battery_pct",
    "instability_score",
    "critical_service_interruptions",
)

_LOCAL_TERM_LABELS = {
    "uptime": "Critical-service uptime",
    "water": "Water availability",
    "batteryPreservation": "Battery preservation",
    "recoverySpeed": "Recovery speed",
    "loadShed": "Load shed",
    "sheddingEvents": "Shedding events",
    "instability": "Instability",
}


def _normalize_breakdown(bd: dict) -> tuple[list[tuple[str, float]], list[tuple[str, float]]]:
    """Return (rewards, penalties) of (label, value) from either known shape.

    Local fallback emits ``{rewardTerms: {...}, penaltyTerms: {...}}``; Ali's
    real module emits a dict keyed by term name with ``group``/``subScore``.
    """
    rewards: list[tuple[str, float]] = []
    penalties: list[tuple[str, float]] = []
    if not isinstance(bd, dict):
        return rewards, penalties
    if "rewardTerms" in bd and "penaltyTerms" in bd:
        for key, value in (bd.get("rewardTerms") or {}).items():
            rewards.append((_LOCAL_TERM_LABELS.get(key, key), float(value)))
        for key, value in (bd.get("penaltyTerms") or {}).items():
            penalties.append((_LOCAL_TERM_LABELS.get(key, key), float(value)))
        return rewards, penalties
    for key, entry in bd.items():
        if not isinstance(entry, dict):
            continue
        group = str(entry.get("group", "")).lower()
        if group not in ("reward", "penalty"):
            continue
        value = entry.get("subScore")
        if value is None:
            value = entry.get("contribution")
        if value is None:
            continue
        label = str(entry.get("label") or key)
        (rewards if group == "reward" else penalties).append((label, float(value)))
    return rewards, penalties


def _mean_or_none(values: list[float]) -> float | None:
    return round(statistics.mean(values), 4) if values else None


def build_controller_summaries(
    scenario_results: list[ScenarioEvaluation], controllers: list[ControllerMode]
) -> dict[ControllerMode, ControllerSummary]:
    """Aggregate each controller's metrics across scenarios into a flat summary.

    All values are means of the controller's *recorded* per-scenario metrics;
    nothing is invented. Errored scenarios do not contribute (``sample_count``).
    """
    scenarios_by_mode: dict[ControllerMode, dict[str, list[float]]] = {}
    rewards_by_mode: dict[ControllerMode, dict[str, list[float]]] = {}
    penalties_by_mode: dict[ControllerMode, dict[str, list[float]]] = {}
    source_by_mode: dict[ControllerMode, str] = {}
    samples_by_mode: dict[ControllerMode, int] = {}
    for scenario in scenario_results:
        for mode in controllers:
            cm = scenario.controllers.get(mode)
            if cm is None or cm.errors:
                continue
            scenarios_by_mode.setdefault(mode, {})
            for attr in _SUMMARY_FIELDS:
                value = getattr(cm, attr)
                if value is not None:
                    scenarios_by_mode[mode].setdefault(attr, []).append(float(value))
            if cm.prototype_score is not None:
                scenarios_by_mode[mode].setdefault("prototype_score", []).append(
                    float(cm.prototype_score)
                )
            if cm.score_breakdown:
                rewards, penalties = _normalize_breakdown(cm.score_breakdown)
                for label, value in rewards:
                    rewards_by_mode.setdefault(mode, {}).setdefault(label, []).append(value)
                for label, value in penalties:
                    penalties_by_mode.setdefault(mode, {}).setdefault(label, []).append(value)
            source_by_mode.setdefault(mode, cm.metric_source)
            samples_by_mode[mode] = samples_by_mode.get(mode, 0) + 1

    out: dict[ControllerMode, ControllerSummary] = {}
    for mode in controllers:
        per_scenario = scenarios_by_mode.get(mode, {})
        probes: dict[str, float | None] = {
            attr: _mean_or_none(per_scenario.get(attr, [])) for attr in _SUMMARY_FIELDS
        }
        score = _mean_or_none(per_scenario.get("prototype_score", []))
        rewards: list[ScoreComponent] = [
            ScoreComponent(key=label, label=label, value=_mean_or_none(vals))
            for label, vals in sorted((rewards_by_mode.get(mode) or {}).items())
        ]
        penalized: list[ScoreComponent] = [
            ScoreComponent(key=label, label=label, value=_mean_or_none(vals))
            for label, vals in sorted((penalties_by_mode.get(mode) or {}).items())
        ]
        breakdown = (
            ScoreBreakdown(rewards=rewards, penalties=penalized)
            if rewards or penalized
            else None
        )
        out[mode] = ControllerSummary(
            controller_mode=mode,
            sample_count=samples_by_mode.get(mode, 0),
            metric_source=source_by_mode.get(mode, "local_fallback"),
            prototype_score=score,
            score_breakdown=breakdown,
            **probes,
        )
    return out


# --------------------------------------------------------------------------- #
# Runner / registry
# --------------------------------------------------------------------------- #
class EvaluationRunner:
    """Owns one in-process evaluation slot + in-memory result registry.

    Evaluation runs on a dedicated worker thread with its own event loop, so it
    never uses (or blocks) the live backend's loop or the request loop, and
    background runs persist reliably regardless of how requests are dispatched.
    This guarantees the live dashboard loop and any running evaluation are fully
    isolated. Mirrors the ``StateManager`` singleton pattern.
    """

    def __init__(self, config: Config) -> None:
        self.config = config
        self._sim_adapter: SimulationAdapter = build_simulation_adapter(config)
        self._controller_adapter: ControllerAdapter = build_controller_adapter(config)
        # Dedicated worker thread + event loop for background evaluation.
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._loop.run_forever, name="nimbus-eval-loop", daemon=True
        )
        self._thread.start()
        self._slot_lock = threading.Lock()
        self._active_run_id: str | None = None
        self._task: asyncio.Task | None = None
        self._futures: dict[str, Any] = {}
        self._runs: dict[str, EvaluationResult] = {}
        self._latest_run_id: str | None = None

    # -- introspection ------------------------------------------------------ #
    @property
    def running(self) -> bool:
        with self._slot_lock:
            return self._active_run_id is not None

    def get_progress(self, run_id: str) -> EvaluationProgress | None:
        result = self._runs.get(run_id)
        if result is None:
            return None
        return EvaluationProgress(
            run_id=run_id,
            status=result.status,
            current_scenario=result.current_scenario,
            total_scenarios=result.scenario_count,
            progress_pct=result.progress_pct,
            current_controller=result.current_controller,
            message=result.message,
            error=result.error or (result.errors[0] if result.errors else None),
            started_at_ms=result.started_at_ms,
            finished_at_ms=result.finished_at,
        )

    def get_result(self, run_id: str) -> EvaluationResult | None:
        return self._runs.get(run_id)

    def get_latest(self) -> EvaluationResult | None:
        if self._latest_run_id is not None:
            return self._runs.get(self._latest_run_id)
        # Fallback for the cross-thread publish race: scan for the most recent
        # completed run rather than returning None too early.
        completed = [r for r in self._runs.values() if r.status == "completed"]
        return max(completed, key=lambda r: r.started_at_ms or 0) if completed else None

    def list_runs(self) -> list[EvaluationSummary]:
        summaries = []
        for rr in reversed(list(self._runs.values())):
            summaries.append(
                EvaluationSummary(
                    run_id=rr.run_id,
                    status=rr.status,
                    scenario_count=rr.scenario_count,
                    progress_pct=round(
                        len(rr.controller_results) / max(rr.scenario_count, 1) * 100.0, 2
                    ),
                    started_at_ms=rr.started_at_ms,
                    finished_at_ms=rr.completed_at_ms,
                )
            )
        return summaries

    # -- lifecycle ---------------------------------------------------------- #
    def close(self) -> None:
        """Stop the dedicated worker loop/thread (called on app shutdown)."""
        if self._thread.is_alive():
            self._loop.call_soon_threadsafe(self._loop.stop)
            self._thread.join(timeout=2.0)

    def start(
        self, request: EvaluationRunRequest
    ) -> EvaluationRunStarted:
        """Validate and start an evaluation. Refuses a second concurrent run."""
        # Integration checks that must not be deferred.
        self._validate_request(request)
        run_id = uuid.uuid4().hex
        now = _now_ms()

        self._runs[run_id] = EvaluationResult(
            run_id=run_id,
            status="queued",
            scenario_count=request.scenario_count,
            random_seed=request.random_seed
            if request.random_seed is not None
            else self.config.seed,
            controller_results=[],
            warnings=[],
            errors=[],
            started_at_ms=now,
            metric_source="local_fallback",
            message="Evaluation queued.",
        )

        try:
            self._launch_task(run_id, request)
        except Exception:  # noqa: BLE001 - do not leave a stray queued run
            self._runs[run_id].status = "failed"
            self._runs[run_id].message = "Evaluation failed to start."
            self._runs[run_id].completed_at_ms = _now_ms()
            self._latest_run_id = run_id
            raise

        return EvaluationRunStarted(
            run_id=run_id,
            status="queued",
            scenario_count=request.scenario_count,
        )

    def _launch_task(self, run_id: str, request: EvaluationRunRequest) -> None:
        with self._slot_lock:
            if self._active_run_id is not None:
                raise EvaluationInProgressError(
                    "An evaluation is already running. Start another after it completes."
                )
            self._active_run_id = run_id  # reserve the single slot atomically
        # Schedule on the dedicated worker loop so the run persists regardless of
        # which loop dispatched this request (also in TestClient).
        fut = asyncio.run_coroutine_threadsafe(self._run(run_id, request), self._loop)
        self._futures[run_id] = fut

        def _on_done(done: Any) -> None:
            with contextlib.suppress(Exception):
                done.result()
            self._futures.pop(run_id, None)

        fut.add_done_callback(_on_done)

    def wait_for(self, run_id: str, timeout: float = 60.0) -> EvaluationResult | None:
        """Block the calling thread until the run finishes (or timeout)."""
        fut = self._futures.get(run_id)
        if fut is not None:
            with contextlib.suppress(Exception):
                fut.result(timeout=timeout)
        return self.get_result(run_id)

    def _validate_request(self, request: EvaluationRunRequest) -> None:
        if request.scenario_count < 1 or request.scenario_count > 500:
            raise EvaluationInvalidRequestError(
                "scenarioCount must be between 1 and 500"
            )
        try:
            validate_selected_events(request.selected_events)
        except ValueError as exc:
            raise EvaluationInvalidRequestError(str(exc)) from exc
        if request.controllers is not None:
            bad = [c for c in request.controllers if c not in ("naive", "reactive", "nimbus")]
            if bad:
                raise EvaluationInvalidRequestError(
                    f"unknown controllers: {bad}; allowed: naive, reactive, nimbus"
                )
        # Real-module availability gate.
        if request.require_real:
            missing = self._missing_integration_notes()
            if missing:
                raise EvaluationIntegrationError("; ".join(missing))

    def _missing_integration_notes(self) -> list[str]:
        notes: list[str] = []
        if not self._sim_adapter.is_real:
            notes.append(
                "Lalith's real simulation (NIMBUS_SIMULATION_BACKEND=lalith) is not "
                "available; only the labeled mock simulation is present."
            )
        if not self._controller_adapter.is_real:
            notes.append(
                "Ali's real controller (NIMBUS_CONTROLLER_BACKEND=nimbus) is not "
                "available; only the labeled mock controller is present."
            )
        return notes

    async def _run(
        self, run_id: str, request: EvaluationRunRequest
    ) -> None:
        result = self._runs[run_id]
        # Capture the real asyncio Task so cancel() can cancel this cross-thread.
        self._task = asyncio.current_task()
        try:
            result.status = "running"
            result.message = "Evaluation running."
            controllers = list(request.controllers) if request.controllers else list(DEFAULT_CONTROLLERS)
            base_seed = request.random_seed if request.random_seed is not None else self.config.seed
            scenarios = build_scenarios(
                request.scenario_count,
                base_seed,
                request.selected_events,
                use_real=self._sim_adapter.is_real,
            )
            metric_source, notes = detect_metric_source(use_ali=True)
            result.metric_source = metric_source
            result.integration_notes = notes + self._integration_notes()
            result.warnings = [
                "Evaluation ran on the clearly-labeled mock simulation/controller "
                "because real modules are not present in this branch. Metrics are "
                "real computed values, not fabricated."
            ] if not (self._sim_adapter.is_real and self._controller_adapter.is_real) else []

            result.controller_results = []
            total = len(scenarios)
            for idx, scenario in enumerate(scenarios):
                result.current_scenario = idx + 1
                result.current_event = scenario.event_type
                result.progress_pct = round(idx / total * 100.0, 2)
                result.message = f"Running scenario {idx + 1}/{total}."

                def _mark_controller(mode: ControllerMode) -> None:
                    result.current_controller = mode

                scenario_eval = run_scenario(
                    self._sim_adapter,
                    self._controller_adapter,
                    scenario,
                    controllers,
                    self.config,
                    index=idx,
                    on_controller_started=_mark_controller,
                )
                result.controller_results.append(scenario_eval)
                result.progress_pct = round((idx + 1) / total * 100.0, 2)

            result.current_controller = None
            result.comparison = build_comparison(result.controller_results, controllers)
            result.controllers = build_controller_summaries(result.controller_results, controllers)
            result.scenario = ScenarioDescriptor(
                seed=result.random_seed,
                event=scenarios[0].event_type if scenarios else None,
                initial_battery_pct=(
                    scenarios[0].initial_battery_pct if scenarios else None
                ),
                event_duration_s=(
                    (scenarios[0].duration_ticks * scenarios[0].timestep_s)
                    if scenarios and scenarios[0].duration_ticks is not None
                    else None
                ),
                timestep_s=scenarios[0].timestep_s if scenarios else None,
                scenario_count=len(scenarios),
            )
            self._latest_run_id = run_id  # publish BEFORE status for cross-thread readers
            result.finished_at = _now_ms()
            result.duration_ms = result.finished_at - (result.started_at_ms or 0)
            result.message = "Evaluation completed."
            result.status = "completed"
            result.completed_at_ms = result.finished_at
            logger.info("evaluation %s completed (%d scenarios)", run_id, len(scenarios))
        except asyncio.CancelledError:
            result.status = "failed"
            result.errors = ["Evaluation cancelled."]
            result.message = "Evaluation cancelled."
            result.current_controller = None
            result.finished_at = _now_ms()
            result.completed_at_ms = result.finished_at
            raise
        except Exception as exc:  # noqa: BLE001 - never crash the backend
            logger.exception("evaluation %s failed", run_id)
            result.status = "failed"
            result.error = f"{type(exc).__name__}: {exc}"
            result.errors = [result.error]
            result.message = "Evaluation failed."
            result.current_controller = None
            result.finished_at = _now_ms()
            result.completed_at_ms = result.finished_at
            self._latest_run_id = run_id
        finally:
            self._clear_slot(run_id)

    def _integration_notes(self) -> list[str]:
        notes = []
        if not self._sim_adapter.is_real:
            notes.append(
                "Simulation: labeled MockSimulationAdapter (Lalith's island_sim "
                "not present)."
            )
        if not self._controller_adapter.is_real:
            notes.append(
                "Controller: labeled MockControllerAdapter (Ali's controller not "
                "present)."
            )
        return notes

    def cancel(self, run_id: str) -> bool:
        """Attempt to cancel an in-flight run. Returns True if cancelled."""
        with self._slot_lock:
            if self._active_run_id != run_id:
                return False
            self._active_run_id = None
        result = self._runs.get(run_id)
        if result is None or result.status not in ("queued", "running"):
            return False
        task = self._task
        if task is None or task.done():
            return False
        self._loop.call_soon_threadsafe(task.cancel)
        return True

    def _clear_slot(self, run_id: str) -> None:
        """Release the single evaluation slot when a run finishes/cancels."""
        with self._slot_lock:
            if self._active_run_id == run_id:
                self._active_run_id = None
        self._task = None
