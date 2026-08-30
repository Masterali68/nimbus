"""Pydantic schemas for the Nimbus Phase 3 evaluation subsystem.

All outbound JSON uses camelCase to match the shared frontend contract (the
same convention enforced by ``models.CamelModel``). Evaluation never touches
the live dashboard ``StateManager``; it owns a separate in-memory registry and
its own asynchronous runner task.

Ownership note: metric *formulas* are defined by Ali (``docs/evaluation-metrics.md``
and ``backend/evaluation_metrics.py`` on ``feat/nimbus-engine``). This module only
defines the wire schemas. The runner prefers Ali's real metric module when it is
present and falls back to a clearly-labeled local implementation otherwise.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """snake_case internally, camelCase on the wire (mirrors models.CamelModel)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --------------------------------------------------------------------------- #
# Enumerations
# --------------------------------------------------------------------------- #
ControllerMode = Literal["naive", "reactive", "nimbus"]

EvaluatorStatus = Literal["queued", "running", "completed", "failed"]

# Which code path produced the metrics. Always surfaced so results are never
# mistaken for "real physics" when the labeled mock/fallback path was used.
MetricSource = Literal["ali", "local_fallback"]


# --------------------------------------------------------------------------- #
# Scenario configuration (fairness contract)
# --------------------------------------------------------------------------- #
class ScenarioConfig(CamelModel):
    """Everything that identifies one scenario.

    This is the *same* object reused for Naive, Reactive and Nimbus runs of a
    given scenario index, which is what makes the comparison fair by
    construction. Fields mirror the fairness requirements (same seed, same
    battery, same solar/wind availability, same baseline demand, same event,
    same duration, same recovery, same timestep).
    """

    seed: int = Field(ge=0, description="Deterministic scenario seed (Lalith's)")
    event_type: str | None = Field(
        default=None,
        description="One of the ALLOWED_EVENTS, when a single disturbance is used.",
    )
    duration_ticks: int | None = Field(
        default=None, ge=1, description="Simulation ticks the event remains active."
    )
    initial_battery_pct: float | None = Field(
        default=None, ge=0.0, le=100.0, description="Optional battery override."
    )
    timestep_s: float = Field(
        default=1.0, gt=0.0, description="Simulation seconds per tick (fairness param)."
    )
    max_ticks: int = Field(
        default=7200, ge=1, description="Ticks to run for this scenario."
    )


# --------------------------------------------------------------------------- #
# Per-controller metrics (single scenario run)
# --------------------------------------------------------------------------- #
class ControllerMetrics(CamelModel):
    """Recorded metrics for one controller on one scenario.

    Every value is computed from the actually-recorded tick trace for that
    controller. No value is invented, adjusted, or tuned to favor a controller.
    When Ali's real ``evaluation_metrics`` module is unavailable, the runner
    uses a documented local fallback and labels ``metricSource`` accordingly.
    """

    controller_mode: ControllerMode
    critical_service_uptime_pct: float | None = None
    water_availability_pct: float | None = None
    total_load_shed_kwh: float | None = None
    shedding_event_count: int | None = None
    recovery_time_seconds: float | None = None
    minimum_battery_pct: float | None = None
    instability_score: float | None = None
    critical_service_interruptions: int | None = None
    prototype_score: float | None = None
    score_breakdown: dict | None = None
    metric_source: MetricSource = "local_fallback"
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Per-scenario result (all three controllers)
# --------------------------------------------------------------------------- #
class ScenarioEvaluation(CamelModel):
    """One scenario index evaluated across all controllers."""

    scenario_index: int
    scenario: ScenarioConfig
    controllers: dict[ControllerMode, ControllerMetrics]


# --------------------------------------------------------------------------- #
# Aggregated / comparison output (used by frontend)
# --------------------------------------------------------------------------- #
class MetricAggregate(CamelModel):
    mean: float | None = None
    median: float | None = None
    min: float | None = None
    max: float | None = None
    p90: float | None = None
    count: int = 0


class ControllerAggregate(CamelModel):
    controller_mode: ControllerMode
    metrics: dict[str, MetricAggregate] = Field(default_factory=dict)
    prototype_score: MetricAggregate | None = None


class ComparisonResult(CamelModel):
    controllers: dict[ControllerMode, ControllerAggregate] = Field(default_factory=dict)
    metric_labels: dict[str, str] = Field(default_factory=dict)
    note: str = "Fair comparison: all controllers received identical scenario inputs."


# --------------------------------------------------------------------------- #
# Frontend-friendly result summary (Adith's evaluation page)
# --------------------------------------------------------------------------- #
class ScoreComponent(CamelModel):
    """One reward/penalty term with its average sub-score."""

    key: str
    label: str
    value: float | None = Field(default=None, description="Average sub-score (0..1).")


class ScoreBreakdown(CamelModel):
    """Score-contribution view split into rewards and penalties."""

    rewards: list[ScoreComponent] = Field(default_factory=list)
    penalties: list[ScoreComponent] = Field(default_factory=list)


class ControllerSummary(CamelModel):
    """One controller's aggregated metrics ACROSS all scenarios.

    Continuous metrics and the prototype score are averaged per scenario so the
    value shown is a typical scenario's result. ``sample_count`` states how many
    scenarios actually contributed (errored scenarios are excluded).
    """

    controller_mode: ControllerMode
    critical_service_uptime_pct: float | None = None
    water_availability_pct: float | None = None
    total_load_shed_kwh: float | None = None
    shedding_event_count: float | None = None
    recovery_time_seconds: float | None = None
    minimum_battery_pct: float | None = None
    instability_score: float | None = None
    critical_service_interruptions: float | None = None
    prototype_score: float | None = None
    score_breakdown: ScoreBreakdown | None = None
    metric_source: MetricSource = "local_fallback"
    sample_count: int = 0


class ScenarioDescriptor(CamelModel):
    """Brief description of the shared scenario set the run used.

    Fairness note: every controller saw the *same* scenario set. ``seed`` is
    the run's base seed; ``event`` is the first scenario's disturbance type
    (the set cycles through all allowed types).
    """

    seed: int | None = None
    event: str | None = None
    initial_battery_pct: float | None = None
    event_duration_s: float | None = None
    timestep_s: float | None = None
    scenario_count: int | None = None


# --------------------------------------------------------------------------- #
# Progress
# --------------------------------------------------------------------------- #
class EvaluationProgress(CamelModel):
    run_id: str
    status: EvaluatorStatus
    current_scenario: int = 0
    total_scenarios: int
    progress_pct: float = 0.0
    current_controller: ControllerMode | None = None
    message: str = ""
    error: str | None = None
    started_at_ms: int | None = None
    finished_at_ms: int | None = None


# --------------------------------------------------------------------------- #
# Requests / top-level results
# --------------------------------------------------------------------------- #
class EvaluationRunRequest(CamelModel):
    scenario_count: int = Field(default=100, ge=1, le=500)
    random_seed: int | None = Field(default=None, ge=0)
    selected_events: list[str] | None = Field(default=None)
    controllers: list[ControllerMode] | None = Field(default=None)
    require_real: bool = Field(
        default=False,
        description=(
            "When true, the run is rejected with a clear integration error if "
            "Lalith's/Ali's real modules are not importable. Defaults to the "
            "clearly-labeled mock/fallback pipeline."
        ),
    )
    scenario_options: dict | None = Field(default=None)


class EvaluationRunStarted(CamelModel):
    run_id: str
    status: Literal["queued", "running"] = "queued"
    scenario_count: int
    message: str = "Evaluation queued."


class EvaluationResult(CamelModel):
    run_id: str
    status: EvaluatorStatus
    scenario_count: int
    random_seed: int
    controller_results: list[ScenarioEvaluation] = Field(default_factory=list)
    comparison: ComparisonResult | None = None
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    started_at_ms: int | None = None
    completed_at_ms: int | None = None
    metric_source: MetricSource = "local_fallback"
    integration_notes: list[str] = Field(default_factory=list)

    # Live progress mirror (so GET /api/evaluate/{runId} doubles as the poll
    # endpoint Adith's frontend already calls).
    progress_pct: float = 0.0
    current_scenario: int = 0
    current_controller: ControllerMode | None = None
    current_event: str | None = None
    message: str = ""
    error: str | None = None

    # Frontend result view (flat aggregated controllers + scenario descriptor).
    controllers: dict[ControllerMode, ControllerSummary] = Field(default_factory=dict)
    scenario: ScenarioDescriptor | None = None
    source: Literal["live"] = "live"
    finished_at: int | None = None
    duration_ms: int | None = None


class EvaluationSummary(CamelModel):
    """Lightweight list entry returned by GET /api/evaluate."""

    run_id: str
    status: EvaluatorStatus
    scenario_count: int
    progress_pct: float = 0.0
    started_at_ms: int | None = None
    finished_at_ms: int | None = None
