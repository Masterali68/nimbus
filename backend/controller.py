"""
Nimbus Phase 2 — Decision engine.

This module is called by the FastAPI backend once per simulation tick with the
current island state and returns a decision the backend can apply and publish.

INPUT  (matches the shared telemetry contract, camelCase):
    {
      "timestampMs": ...,
      "tick": ...,
      "activeEvent": "storm-cloud-cover",
      "controllerMode": "naive" | "reactive" | "nimbus",
      "solarKw": ...,
      "windKw": ...,
      "totalDemandKw": ...,
      "batteryPct": ...,
      "netPowerKw": ...,
      "filteredNetPowerKw": ...,   # previous tick's engine output (write-back loop)
      "velocityKwS": ...,
      "accelerationKwS2": ...,
      "resources": { hospital, desalination, residential, resort }
    }

OUTPUT (NimbusDecision):
    severity, trajectory, action, reasonCode, explanation, expectedOutcome,
    resourceUpdates (authoritative post-decision snapshot of every resource),
    metrics (filteredNetPowerKw, velocityKwS, accelerationKwS2, netPowerKw,
             warmupComplete) that the backend must write back into the next tick.

The engine is stateless on purpose: all memory (resource states, cooldown
counters, previous metrics) rides inside the island state, so FastAPI can call
it freely and replay stays deterministic.
"""

from controller_config import TICK_INTERVAL_SECONDS as _DT
from controller_config import MAX_OPERATING_PCT, MIN_OPERATING_PCT
from hysteresis import (
    STATE_NORMAL,
    STATE_REDUCED,
    STATE_SHED,
    EVENT_COOLDOWN_HOLD,
    EVENT_ENTER_COOLDOWN,
    EVENT_ENTER_RESTORING,
    EVENT_REDUCED,
    EVENT_RESTORED,
    EVENT_RESTORING_HOLD,
    EVENT_SHED,
    advance_residential,
    advance_resort,
    residential_reduce_trigger,
    resort_shed_trigger,
)
from explainability import build_explanation

PROTECTED = "PROTECTED"
THROTTLED = "THROTTLED"

ACTION_NONE = "NONE"
ACTION_PROTECT = "PROTECT"
ACTION_THROTTLE = "THROTTLE"
ACTION_REDUCE = "REDUCE"
ACTION_SHED = "SHED"
ACTION_COOLDOWN = "COOLDOWN"
ACTION_RESTORE = "RESTORE"


def clamp(value, lower, upper):
    return max(lower, min(upper, value))


def _finite(value):
    return isinstance(value, (int, float)) and value == value  # NaN guard


def round1(value):
    return round(value, 1)


def _resource(state, resource_id):
    return state.get("resources", {}).get(resource_id, {})


def _resource_out(resource, state, pct):
    out = dict(resource)
    out["state"] = state
    out["operatingPct"] = round1(clamp(pct, MIN_OPERATING_PCT, MAX_OPERATING_PCT))
    out["currentDemandKw"] = round1(resource.get("maxDemandKw", 0.0) * out["operatingPct"] / 100.0)
    out.pop("cooldownTicksRemaining", None)
    out.pop("restoreHoldTicksRemaining", None)
    return out


# ---------------------------------------------------------------------------
# Energy-balance analysis
# ---------------------------------------------------------------------------

def calculate_energy_metrics(solar_kw, wind_kw, total_demand_kw, previous=None, tick=0, cfg=None):
    """
    Compute extrapolated net power, its EMA, velocity and acceleration.

    Uses the previous tick's filtered/velocity/acceleration values (from the
    write-back loop) so the filter stays consistent across simulation ticks.
    `velocityKwS` and `accelerationKwS2` describe the short-term trajectory of
    the LIVE energy balance — this is not weather forecasting.
    """
    cfg = cfg if cfg is not None else _cfg()
    previous = previous or {}

    if not (_finite(solar_kw) and _finite(wind_kw) and _finite(total_demand_kw)):
        # Non-finite input: carry forward previous state rather than invent data.
        return {
            "netPowerKw": 0.0,
            "filteredNetPowerKw": previous.get("filteredNetPowerKw", 0.0) if _finite(previous.get("filteredNetPowerKw")) else 0.0,
            "velocityKwS": previous.get("velocityKwS", 0.0) if _finite(previous.get("velocityKwS")) else 0.0,
            "accelerationKwS2": previous.get("accelerationKwS2", 0.0) if _finite(previous.get("accelerationKwS2")) else 0.0,
            "warmupComplete": False,
        }

    net_power_kw = solar_kw + wind_kw - total_demand_kw

    prev_filtered = previous.get("filteredNetPowerKw")
    prev_filtered = prev_filtered if _finite(prev_filtered) else net_power_kw
    filtered = cfg.EMA_FILTER_ALPHA * net_power_kw + (1 - cfg.EMA_FILTER_ALPHA) * prev_filtered

    raw_velocity = (filtered - prev_filtered) / _DT
    prev_velocity = previous.get("velocityKwS")
    prev_velocity = prev_velocity if _finite(prev_velocity) else raw_velocity
    velocity = cfg.EMA_VELOCITY_ALPHA * raw_velocity + (1 - cfg.EMA_VELOCITY_ALPHA) * prev_velocity

    raw_acceleration = (velocity - prev_velocity) / _DT
    prev_acceleration = previous.get("accelerationKwS2")
    prev_acceleration = prev_acceleration if _finite(prev_acceleration) else raw_acceleration
    acceleration = cfg.EMA_ACCELERATION_ALPHA * raw_acceleration + (1 - cfg.EMA_ACCELERATION_ALPHA) * prev_acceleration

    return {
        "netPowerKw": round1(net_power_kw),
        "filteredNetPowerKw": round1(filtered),
        "velocityKwS": round1(velocity),
        "accelerationKwS2": round1(acceleration),
        "warmupComplete": tick >= cfg.EMA_WARMUP_TICKS,
    }


# ---------------------------------------------------------------------------
# Trajectory + severity classification
# ---------------------------------------------------------------------------

def detect_trajectory(metrics, battery_pct, cfg=None):
    """Short-term trajectory label of the live energy balance (not a forecast)."""
    cfg = cfg if cfg is not None else _cfg()
    if not metrics.get("warmupComplete"):
        return "STABLE"

    declining = metrics["velocityKwS"] < 0
    # A fast decline is only an emergency when the island is genuinely in
    # (or heading into) deficit, or the battery is already critical. A steep
    # decline on a still-healthy surplus — e.g. the temporary dip a controlled
    # restore ramp creates as it reconnects load — is DETERIORATING, not CRITICAL.
    in_deficit = metrics.get("netPowerKw", 0.0) <= cfg.CRITICAL_NET_POWER_KW
    fast_collapse = (
        metrics["velocityKwS"] <= cfg.CRITICAL_VELOCITY_KWS
        or (declining and metrics["accelerationKwS2"] <= cfg.CRITICAL_ACCELERATION_KWS2)
    )

    if battery_pct <= cfg.CRITICAL_BATTERY_PCT:
        return "CRITICAL"
    if in_deficit and fast_collapse:
        return "CRITICAL"
    if metrics["velocityKwS"] >= cfg.IMPROVING_VELOCITY_KWS:
        return "IMPROVING"
    if metrics["velocityKwS"] <= cfg.DETERIORATING_VELOCITY_KWS:
        return "DETERIORATING"
    return "STABLE"


def classify_severity(trajectory, metrics, battery_pct, cfg=None):
    cfg = cfg if cfg is not None else _cfg()
    if trajectory == "CRITICAL" or battery_pct <= cfg.CRITICAL_BATTERY_PCT:
        return "CRITICAL"
    if (
        trajectory == "DETERIORATING"
        or battery_pct <= cfg.WARNING_BATTERY_PCT
        or metrics["filteredNetPowerKw"] <= cfg.WATCH_NET_POWER_KW
    ):
        return "WARNING"
    if battery_pct <= cfg.WATCH_BATTERY_PCT or metrics["filteredNetPowerKw"] < 0:
        return "WATCH"
    return "STABLE"


def base_severity_from_battery(battery_pct, cfg=None):
    cfg = cfg if cfg is not None else _cfg()
    if battery_pct >= cfg.WATCH_BATTERY_PCT:
        return "STABLE"
    if battery_pct >= cfg.WARNING_BATTERY_PCT:
        return "WATCH"
    if battery_pct >= cfg.CRITICAL_BATTERY_PCT:
        return "WARNING"
    return "CRITICAL"


def base_trajectory_from_battery(battery_pct, cfg=None):
    cfg = cfg if cfg is not None else _cfg()
    return "CRITICAL" if battery_pct <= cfg.CRITICAL_BATTERY_PCT else "STABLE"


# ---------------------------------------------------------------------------
# PD-style desalination control
# ---------------------------------------------------------------------------

def compute_desalination(desal, metrics, prev_filtered_net_power_kw, cfg=None):
    """
    Proportional-derivative control over the desalination operating percentage.

        error      = targetNetPowerKw - filteredNetPowerKw
        derivative = change in the same error / dt

    Positive error (deficit) curtails load; negative error (surplus) lets the
    plant recover. Output is clamped to the safe band AND rate-limited so the
    plant never jumps (100% -> 88% -> 74%, never 100% -> 0%).
    """
    cfg = cfg if cfg is not None else _cfg()
    target = cfg.TARGET_NET_POWER_KW
    error = target - metrics["filteredNetPowerKw"]

    if _finite(prev_filtered_net_power_kw):
        previous_error = target - prev_filtered_net_power_kw
        derivative = (error - previous_error) / _DT
    else:
        derivative = 0.0

    signal = cfg.PD_KP * error + cfg.PD_KD * derivative
    curtail_kw = clamp(signal, 0.0, cfg.PD_MAX_CURTAIL_KW)

    max_demand_kw = desal.get("maxDemandKw") or 1.0
    desired_pct = clamp(
        100.0 * (1.0 - curtail_kw / max_demand_kw),
        cfg.DESALINATION_MIN_OPERATING_PCT,
        cfg.DESALINATION_MAX_OPERATING_PCT,
    )

    prev_pct = desal.get("operatingPct", cfg.DESALINATION_MAX_OPERATING_PCT)
    ramped_pct = clamp(
        desired_pct,
        prev_pct - cfg.DESALINATION_MAX_STEP_PCT_PER_TICK,
        prev_pct + cfg.DESALINATION_MAX_STEP_PCT_PER_TICK,
    )
    ramped_pct = clamp(
        ramped_pct,
        cfg.DESALINATION_MIN_OPERATING_PCT,
        cfg.DESALINATION_MAX_OPERATING_PCT,
    )

    next_pct = round1(ramped_pct)
    state = THROTTLED if next_pct < cfg.DESALINATION_MAX_OPERATING_PCT else STATE_NORMAL
    return _resource_out(desal, state, next_pct)


# ---------------------------------------------------------------------------
# Priority cascade + controllers
# ---------------------------------------------------------------------------

def protect_hospital(decision, state, cfg=None):
    hospital = _resource(state, "hospital")
    hospital_out = {
        **hospital,
        "state": PROTECTED,
        "operatingPct": 100.0,
        "currentDemandKw": round1(hospital.get("maxDemandKw", 0.0)),
    }
    hospital_out.pop("cooldownTicksRemaining", None)
    hospital_out.pop("restoreHoldTicksRemaining", None)
    decision["resourceUpdates"]["hospital"] = hospital_out
    return decision


def enforce_safety(decision, cfg=None):
    """Fail-closed guard: hospital can never leave PROTECTED, pct never leaves [0, 100]."""
    for rid, res in decision.get("resourceUpdates", {}).items():
        if rid == "hospital":
            res["state"] = PROTECTED
            res["operatingPct"] = 100.0
        res["operatingPct"] = round1(clamp(res.get("operatingPct", 100.0), MIN_OPERATING_PCT, MAX_OPERATING_PCT))
        res["currentDemandKw"] = round1(res.get("maxDemandKw", 0.0) * res["operatingPct"] / 100.0)
    return decision


def run_naive_controller(state, cfg=None):
    """Pure battery-level controller. No velocity/acceleration, no PD desalination."""
    cfg = cfg if cfg is not None else _cfg()
    battery_pct = state.get("batteryPct", 100.0)
    resort = _resource(state, "resort")
    residential = _resource(state, "residential")

    metrics = _metrics_from_state(state, cfg)

    severity = base_severity_from_battery(battery_pct, cfg)
    trajectory = base_trajectory_from_battery(battery_pct, cfg)

    if battery_pct < cfg.NAIVE_RESIDENTIAL_REDUCE_BATTERY_PCT:
        resort_out = _resource_out(resort, STATE_SHED, 0.0)
        residential_out = _resource_out(residential, STATE_REDUCED, cfg.RESIDENTIAL_REDUCED_OPERATING_PCT)
        action = ACTION_REDUCE
        reason_code = "WARNING_REDUCE_RESIDENTIAL"
    elif battery_pct < cfg.NAIVE_RESORT_SHED_BATTERY_PCT:
        resort_out = _resource_out(resort, STATE_SHED, 0.0)
        residential_out = _resource_out(residential, STATE_NORMAL, 100.0)
        action = ACTION_SHED
        reason_code = "WARNING_SHED_RESORT"
    else:
        resort_out = _resource_out(resort, STATE_NORMAL, 100.0)
        residential_out = _resource_out(residential, STATE_NORMAL, 100.0)
        action = ACTION_NONE
        reason_code = "OK_STABLE"

    resource_updates = {
        "resort": resort_out,
        "residential": residential_out,
        "desalination": _passthrough(_resource(state, "desalination")),
    }
    explanation = build_explanation(
        state,
        "naive",
        severity,
        trajectory,
        action,
        reason_code,
        resource_updates,
        metrics,
        cfg,
    )
    return _decision(state, "naive", severity, trajectory, action, reason_code, resource_updates, metrics, explanation)


def run_reactive_controller(state, cfg=None):
    """Battery + raw net power with basic hysteresis. No trajectory early warning."""
    cfg = cfg if cfg is not None else _cfg()
    battery_pct = state.get("batteryPct", 100.0)
    net_power_kw = state.get("netPowerKw", 0.0)
    resort = _resource(state, "resort")
    residential = _resource(state, "residential")

    metrics = _metrics_from_state(state, cfg)

    severity = base_severity_from_battery(battery_pct, cfg)
    trajectory = base_trajectory_from_battery(battery_pct, cfg)

    battery_declining = state.get("batteryDischargeRateKw", 0.0) > 0
    deficit = net_power_kw < 0
    severe_deficit = net_power_kw <= cfg.REACTIVE_SHED_NET_POWER_KW

    resort_offline = resort.get("state") in (STATE_SHED, "COOLDOWN")
    if battery_pct <= cfg.REACTIVE_RESORT_SHED_BATTERY_PCT and (severe_deficit or battery_declining):
        resort_out = _resource_out(resort, STATE_SHED, 0.0)
    elif battery_pct >= cfg.REACTIVE_RESORT_RESTORE_BATTERY_PCT and net_power_kw >= cfg.REACTIVE_RESTORE_NET_POWER_KW:
        resort_out = _resource_out(resort, STATE_NORMAL, 100.0)
    else:
        resort_out = _resource_out(resort, STATE_SHED if resort_offline else STATE_NORMAL, 0.0 if resort_offline else 100.0)

    residential_reduced = residential.get("state") == STATE_REDUCED
    if battery_pct <= cfg.REACTIVE_RESIDENTIAL_REDUCE_BATTERY_PCT and (deficit or battery_declining):
        residential_out = _resource_out(residential, STATE_REDUCED, cfg.RESIDENTIAL_REDUCED_OPERATING_PCT)
    elif battery_pct >= cfg.REACTIVE_RESIDENTIAL_RESTORE_BATTERY_PCT:
        residential_out = _resource_out(residential, STATE_NORMAL, 100.0)
    else:
        residential_out = _resource_out(
            residential,
            STATE_REDUCED if residential_reduced else STATE_NORMAL,
            cfg.RESIDENTIAL_REDUCED_OPERATING_PCT if residential_reduced else 100.0,
        )

    desal_out = _passthrough(_resource(state, "desalination"))

    resort_shed = resort_out["state"] == STATE_SHED
    residential_reducing = residential_out["state"] == STATE_REDUCED
    restored_something = (
        (not resort_shed and resort_offline) or (not residential_reducing and residential_reduced)
    )

    if resort_shed:
        action, reason_code = ACTION_SHED, "WARNING_SHED_RESORT"
    elif residential_reducing:
        action, reason_code = ACTION_REDUCE, "WARNING_REDUCE_RESIDENTIAL"
    elif restored_something:
        action, reason_code = ACTION_RESTORE, "RECOVERY_RESTORE_RESORT"
    else:
        action, reason_code = ACTION_NONE, "OK_STABLE"

    resource_updates = {
        "resort": resort_out,
        "residential": residential_out,
        "desalination": desal_out,
    }
    explanation = build_explanation(
        state,
        "reactive",
        severity,
        trajectory,
        action,
        reason_code,
        resource_updates,
        metrics,
        cfg,
    )
    return _decision(state, "reactive", severity, trajectory, action, reason_code, resource_updates, metrics, explanation)


def run_nimbus_controller(state, cfg=None):
    """
    Full engine: filtering, trajectory, severity, priority cascade, PD
    desalination, cooldown/hysteresis, gradual restoration, explanations.
    """
    cfg = cfg if cfg is not None else _cfg()
    battery_pct = state.get("batteryPct", 100.0)
    resort = _resource(state, "resort")
    residential = _resource(state, "residential")
    desalination = _resource(state, "desalination")

    metrics = _metrics_from_state(state, cfg)
    trajectory = detect_trajectory(metrics, battery_pct, cfg)
    severity = classify_severity(trajectory, metrics, battery_pct, cfg)

    desal_out = compute_desalination(desalination, metrics, state.get("filteredNetPowerKw"), cfg)

    resort_trigger = resort_shed_trigger(severity, battery_pct, cfg)
    new_resort, resort_event = advance_resort(
        resort, resort_trigger, battery_pct, trajectory, metrics["filteredNetPowerKw"], cfg
    )

    resort_handled = new_resort["state"] != STATE_NORMAL or new_resort["operatingPct"] < 100.0
    residential_trigger = residential_reduce_trigger(severity, battery_pct, resort_handled, cfg)
    new_residential, residential_event = advance_residential(
        residential, residential_trigger, battery_pct, trajectory, metrics["filteredNetPowerKw"], cfg
    )

    action, reason_code = _select_action_and_reason(
        state,
        severity,
        trajectory,
        metrics,
        desalination,
        desal_out,
        resort_event,
        residential_event,
        cfg,
    )

    resource_updates = {
        "resort": new_resort,
        "residential": new_residential,
        "desalination": desal_out,
    }
    explanation = build_explanation(
        state,
        "nimbus",
        severity,
        trajectory,
        action,
        reason_code,
        resource_updates,
        metrics,
        cfg,
    )
    return _decision(state, "nimbus", severity, trajectory, action, reason_code, resource_updates, metrics, explanation)


def _select_action_and_reason(
    state, severity, trajectory, metrics, desalination, desal_out, resort_event, residential_event, cfg
):
    critical_reason = "CRITICAL_COLLAPSE" if trajectory == "CRITICAL" else "CRITICAL_BATTERY"
    desal_reduced_this_tick = desal_out["operatingPct"] < desalination.get("operatingPct", 100.0)
    desal_restored_this_tick = desal_out["operatingPct"] > desalination.get("operatingPct", 100.0)

    if resort_event == EVENT_SHED:
        reason_code = (
            critical_reason
            if severity == "CRITICAL"
            else "WARNING_SHED_RESORT"
        )
        return ACTION_SHED, reason_code

    if residential_event == EVENT_REDUCED:
        reason_code = critical_reason if severity == "CRITICAL" else "WARNING_REDUCE_RESIDENTIAL"
        return ACTION_REDUCE, reason_code

    if residential_event in (EVENT_ENTER_COOLDOWN, EVENT_COOLDOWN_HOLD) or resort_event in (
        EVENT_ENTER_COOLDOWN,
        EVENT_COOLDOWN_HOLD,
    ):
        return ACTION_COOLDOWN, "COOLDOWN_HOLD"

    if resort_event in (EVENT_ENTER_RESTORING, EVENT_RESTORING_HOLD, EVENT_RESTORED):
        return ACTION_RESTORE, "RECOVERY_RESTORE_RESORT"

    if residential_event in (EVENT_ENTER_RESTORING, EVENT_RESTORING_HOLD, EVENT_RESTORED):
        return ACTION_RESTORE, "RECOVERY_RESTORE_RESIDENTIAL"

    if desal_reduced_this_tick:
        reason_code = critical_reason if severity == "CRITICAL" else "WARNING_THROTTLE_DESALINATION"
        return ACTION_THROTTLE, reason_code

    if desal_restored_this_tick:
        return ACTION_RESTORE, "RECOVERY_RESTORE_DESALINATION"

    if severity == "CRITICAL":
        return ACTION_NONE, critical_reason
    if severity == "WATCH":
        return ACTION_NONE, "WATCH_TRAJECTORY" if trajectory == "DETERIORATING" else "WATCH_BATTERY"
    if trajectory == "IMPROVING":
        return ACTION_NONE, "OK_IMPROVING"
    return ACTION_NONE, "OK_STABLE"


def run_controller(state, cfg=None):
    """Dispatch by controllerMode, then apply the unconditional hospital guard."""
    cfg = cfg if cfg is not None else _cfg()
    mode = state.get("controllerMode", "nimbus")
    if mode == "naive":
        decision = run_naive_controller(state, cfg)
    elif mode == "reactive":
        decision = run_reactive_controller(state, cfg)
    else:
        decision = run_nimbus_controller(state, cfg)
    decision = protect_hospital(decision, state, cfg)
    decision = enforce_safety(decision, cfg)
    return decision


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _passthrough(resource):
    """Return a resource unchanged (minus transient counters) for controllers
    that do not manage it, so the write-back loop never resets it."""
    out = dict(resource)
    out.pop("cooldownTicksRemaining", None)
    out.pop("restoreHoldTicksRemaining", None)
    out["operatingPct"] = round1(clamp(out.get("operatingPct", 100.0), MIN_OPERATING_PCT, MAX_OPERATING_PCT))
    out["currentDemandKw"] = round1(out.get("maxDemandKw", 0.0) * out["operatingPct"] / 100.0)
    return out


def _metrics_from_state(state, cfg=None):
    cfg = cfg if cfg is not None else _cfg()
    return calculate_energy_metrics(
        state.get("solarKw", 0.0),
        state.get("windKw", 0.0),
        state.get("totalDemandKw", 0.0),
        previous={
            "filteredNetPowerKw": state.get("filteredNetPowerKw"),
            "velocityKwS": state.get("velocityKwS"),
            "accelerationKwS2": state.get("accelerationKwS2"),
        },
        tick=state.get("tick", 0),
        cfg=cfg,
    )


def _decision(state, mode, severity, trajectory, action, reason_code, resource_updates, metrics, explanation):
    return {
        "timestampMs": state.get("timestampMs", 0),
        "controllerMode": mode,
        "severity": severity,
        "trajectory": trajectory,
        "action": action,
        "reasonCode": reason_code,
        "explanation": explanation["explanation"],
        "expectedOutcome": explanation["expectedOutcome"],
        "resourceUpdates": resource_updates,
        "metrics": metrics,
    }


def _cfg():
    import controller_config

    return controller_config