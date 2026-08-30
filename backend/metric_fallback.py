"""Metric computation for the Nimbus evaluation subsystem.

Ali owns the authoritative metric definitions (``docs/evaluation-metrics.md``
and ``backend/evaluation_metrics.py`` on ``feat/nimbus-engine``). This module
provides:

1. A lazy import hook that PREFERS Ali's real ``evaluation_metrics`` module when
   it is available on the running machine, so the moment his code lands in this
   branch the runner automatically uses it.
2. A clearly-labeled local fallback that implements the same *documented*
   formulas from ``docs/evaluation-metrics.md`` so the pipeline can run and be
   tested before Ali's module lands.

Every metric is computed from the actually-recorded tick trace for a specific
controller run. No value is invented, adjusted, or tuned to favor any
controller. The ``metric_source`` field on every result states which path
produced the numbers (``ali`` vs ``local_fallback``).
"""

from __future__ import annotations

import logging
import math

from evaluation_models import ControllerMetrics, ControllerMode, MetricSource

logger = logging.getLogger("nimbus.evaluation.metrics")

# Ali's authoritative metrics module. Imported lazily so the backend still
# boots without it.
ALI_METRICS_MODULE = "evaluation_metrics"
ALI_REQUIRED = (
    "evaluate_controller",
    "run_scenario_for_controller",
    "make_initial_state",
)

# A local "driver" is expected to expose run_controller(state) -> NimbusDecision.
ALI_CONTROLLER_MODULE = "controller"

# Module-level guard so the warn-once message about Ali's missing module fires
# only once per process rather than once per controller run.
_warned_ali_missing: list[bool] = [False]

# Trace-record field helpers --------------------------------------------------


def ali_metrics_available() -> bool:
    try:
        __import__(ALI_METRICS_MODULE)
        return True
    except ImportError:
        return False


def load_ali_metrics():
    module = __import__(ALI_METRICS_MODULE)
    missing = [fn for fn in ALI_REQUIRED if not hasattr(module, fn)]
    if missing:
        raise ImportError(
            f"`{ALI_METRICS_MODULE}` is missing required functions {missing!r}"
        )
    return module


def local_metric_source() -> MetricSource:
    """Return the metric source the local fallback should report."""
    return "local_fallback"


# --------------------------------------------------------------------------- #
# Local fallback metric formulas (mirror docs/evaluation-metrics.md)
# --------------------------------------------------------------------------- #
def _operating_pct(tick: dict, resource: str) -> float:
    res = (tick.get("resources") or {}).get(resource) or {}
    return float(res.get("operatingPct", 100.0))


def _state(tick: dict, resource: str) -> str:
    res = (tick.get("resources") or {}).get(resource) or {}
    return str(res.get("state", res.get("state_state", "normal"))).upper()


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def critical_service_uptime_pct(trace: list[dict]) -> float:
    total = max(len(trace), 1)
    ok = sum(1 for t in trace if _operating_pct(t, "hospital") >= 100.0)
    return round(ok / total * 100.0, 3)


def water_availability_pct(trace: list[dict]) -> float:
    if not trace:
        return 0.0
    pcts = [_operating_pct(t, "desalination") for t in trace]
    return round(_mean(pcts), 3)


def total_load_shed_kwh(trace: list[dict], timestep_s: float = 1.0) -> float:
    total = 0.0
    for t in trace:
        res = t.get("resources") or {}
        for rid in ("residential", "resort"):
            r = res.get(rid) or {}
            baseline = float(r.get("baselineDemandKw", r.get("maxDemandKw", 0.0)))
            current = float(r.get("currentDemandKw", r.get("demandKw", baseline)))
            total += max(0.0, baseline - current)
    return round(total * (timestep_s / 3600.0), 3)


def shedding_event_count(trace: list[dict]) -> int:
    events = 0
    prev_shed = {rid: False for rid in ("resort", "residential")}
    for t in trace:
        res = t.get("resources") or {}
        for rid in ("resort", "residential"):
            r = res.get(rid) or {}
            st = str(r.get("state", "normal")).upper()
            is_shed = st in ("SHED", "REDUCED")
            if is_shed and not prev_shed[rid]:
                events += 1
            prev_shed[rid] = is_shed
    return events


def recovery_time_seconds(trace: list[dict], timestep_s: float = 1.0) -> float:
    """First disturbance tick -> first stable-recovery tick (documented rule)."""
    n = len(trace)
    if n == 0:
        return 0.0
    t0 = None
    for i, t in enumerate(trace):
        res = t.get("resources") or {}
        shed = any(
            str((res.get(rid) or {}).get("state", "normal")).upper() in ("SHED", "REDUCED")
            for rid in ("resort", "residential")
        )
        if shed:
            t0 = i
            break
    if t0 is None:
        return 0.0
    t1 = None
    for i in range(t0, n):
        t = trace[i]
        res = t.get("resources") or {}
        resort = res.get("resort") or {}
        residential = res.get("residential") or {}
        desal = res.get("desalination") or {}
        battery = float(t.get("batteryPct", 0.0))
        net = float(t.get("filteredNetPowerKw", t.get("netPowerKw", 0.0)))
        resort_ok = str(resort.get("state", "normal")).upper() == "NORMAL" and float(
            resort.get("operatingPct", 100.0)
        ) >= 100.0
        residential_ok = str(residential.get("state", "normal")).upper() == "NORMAL"
        desal_ok = float(desal.get("operatingPct", 100.0)) >= 90.0
        battery_ok = battery >= 40.0
        net_ok = net >= 5.0
        trajectory_ok = str(t.get("trajectory", "stable")).upper() in ("STABLE", "IMPROVING")
        if resort_ok and residential_ok and desal_ok and battery_ok and net_ok and trajectory_ok:
            t1 = i
            break
    if t1 is None:
        return round((n - t0) * timestep_s, 3)
    return round((t1 - t0) * timestep_s, 3)


def minimum_battery_pct(trace: list[dict]) -> float:
    if not trace:
        return 0.0
    return round(min(float(t.get("batteryPct", 0.0)) for t in trace), 3)


def energy_balance_instability(trace: list[dict]) -> float:
    """state-change count + desalination oscillations + net-power zero crossings."""
    state_changes = 0
    prev = {rid: None for rid in ("resort", "residential")}
    for t in trace:
        res = t.get("resources") or {}
        for rid in ("resort", "residential"):
            st = str((res.get(rid) or {}).get("state", "normal")).upper()
            if prev[rid] is not None and st != prev[rid]:
                state_changes += 1
            prev[rid] = st

    desal_osc = 0
    prev_desal = None
    prev_sign = None
    for t in trace:
        v = _operating_pct(t, "desalination")
        if prev_desal is not None:
            delta = v - prev_desal
            sign = 0 if abs(delta) < 1e-9 else (1 if delta > 0 else -1)
            if prev_sign is not None and sign != 0 and prev_sign != 0 and sign != prev_sign:
                desal_osc += 1
            if sign != 0:
                prev_sign = sign
        prev_desal = v

    crossings = 0
    prev_net = None
    for t in trace:
        net = float(t.get("filteredNetPowerKw", t.get("netPowerKw", 0.0)))
        if prev_net is not None:
            if (prev_net < 0 <= net) or (net < 0 <= prev_net):
                crossings += 1
        prev_net = net

    return float(state_changes + 0.5 * desal_osc + 0.5 * crossings)


def critical_service_interruptions(trace: list[dict]) -> int:
    return sum(1 for t in trace if _operating_pct(t, "hospital") < 100.0)


# --------------------------------------------------------------------------- #
# Local fallback score (documented prototype formula)
# --------------------------------------------------------------------------- #
def local_score_and_breakdown(m: ControllerMetrics) -> tuple[float | None, dict]:
    """Return (prototype_score, breakdown) using the documented terms.

    Rewards: uptime, water, battery preservation, recovery speed.
    Penalties: load shed, shedding-event count, instability.
    Interrupted -> score 0.
    """
    uptime = (m.critical_service_uptime_pct or 0.0) / 100.0
    water = (m.water_availability_pct or 0.0) / 100.0
    battery = (m.minimum_battery_pct or 0.0) / 100.0  # assume starting 100% range proxy
    recovery = (m.recovery_time_seconds or 0.0) / 180.0
    rec_speed = 1.0 if recovery >= 1.0 else math.exp(-recovery)

    penalty_terms = {
        "loadShed": min((m.total_load_shed_kwh or 0.0) / 250.0, 1.0),
        "sheddingEvents": min((m.shedding_event_count or 0) / 10.0, 1.0),
        "instability": min((m.instability_score or 0.0) / 40.0, 1.0),
    }
    reward_terms = {
        "uptime": uptime,
        "water": water,
        "batteryPreservation": battery,
        "recoverySpeed": rec_speed,
    }
    interrupted = (m.critical_service_interruptions or 0) > 0

    penalty = (penalty_terms["loadShed"] + penalty_terms["sheddingEvents"] + penalty_terms["instability"])
    penalty /= 3.0
    reward = (reward_terms["uptime"] + reward_terms["water"] + reward_terms["batteryPreservation"] + reward_terms["recoverySpeed"])
    reward /= 4.0
    score = reward * (1.0 - penalty)
    if interrupted:
        score = 0.0
    breakdown = {
        "rewardScore": round(reward, 4),
        "penaltyScore": round(penalty, 4),
        "interrupted": interrupted,
        "rewardTerms": {k: round(v, 4) for k, v in reward_terms.items()},
        "penaltyTerms": {k: round(v, 4) for k, v in penalty_terms.items()},
        "disclaimer": (
            "Prototype score. Computed from recorded metrics, never tuned to "
            "favor any controller."
        ),
    }
    return round(score * 100.0, 3), breakdown


# --------------------------------------------------------------------------- #
# Public entry points used by the runner
# --------------------------------------------------------------------------- #
def compute_metrics_for_trace(
    controller_mode: ControllerMode,
    trace: list[dict],
    timestep_s: float = 1.0,
    use_ali: bool = True,
) -> ControllerMetrics:
    """Compute the full ControllerMetrics for one recorded controller run."""
    if use_ali:
        try:
            module = load_ali_metrics()
        except Exception:  # noqa: BLE001 - fall through to local, warn once
            if not _warned_ali_missing[0]:
                _warned_ali_missing[0] = True
                logger.warning(
                    "Ali's metrics module unavailable; using documented local "
                    "fallback for the rest of this process."
                )
        else:
            result = module.evaluate_controller(trace, controller_mode)
            metrics = result.get("metrics", {})
            score = result.get("score", {})
            interrupted_ticks = int(metrics.get("interruptedTicks", 0))
            return ControllerMetrics(
                controller_mode=controller_mode,
                critical_service_uptime_pct=metrics.get("criticalServiceUptimePct"),
                water_availability_pct=metrics.get("waterAvailabilityPct"),
                total_load_shed_kwh=metrics.get("totalLoadShedKwh"),
                shedding_event_count=metrics.get("sheddingEventCount"),
                recovery_time_seconds=metrics.get("recoveryTimeS"),
                minimum_battery_pct=metrics.get("minBatteryPct"),
                instability_score=metrics.get("instabilityIndex"),
                critical_service_interruptions=interrupted_ticks,
                prototype_score=score.get("score"),
                score_breakdown=score.get("breakdown"),
                metric_source="ali",
            )

    m = ControllerMetrics(controller_mode=controller_mode, metric_source="local_fallback")
    m.critical_service_uptime_pct = critical_service_uptime_pct(trace)
    m.water_availability_pct = water_availability_pct(trace)
    m.total_load_shed_kwh = total_load_shed_kwh(trace, timestep_s)
    m.shedding_event_count = shedding_event_count(trace)
    m.recovery_time_seconds = recovery_time_seconds(trace, timestep_s)
    m.minimum_battery_pct = minimum_battery_pct(trace)
    m.instability_score = energy_balance_instability(trace)
    m.critical_service_interruptions = critical_service_interruptions(trace)
    m.prototype_score, m.score_breakdown = local_score_and_breakdown(m)
    return m


def detect_metric_source(use_ali: bool = True) -> tuple[MetricSource, list[str]]:
    """Return the metric source and integration notes for a run."""
    if use_ali and ali_metrics_available():
        return "ali", ["Using Ali's authoritative evaluation_metrics module."]
    return "local_fallback", [
        "Ali's evaluation_metrics module not present; using the documented local "
        "fallback (metric formulas mirror docs/evaluation-metrics.md)."
    ]
