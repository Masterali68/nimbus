"""
Nimbus Phase 3 — Evaluation metrics, fair-comparison harness, and
decision-quality checks.

This module is the single owner of metric definitions used to fairly compare
the Naive, Reactive, and Nimbus controllers. It contains:

  1. A deterministic battery/physics model used identically for every
     controller in a comparison (so a controller's decisions are the ONLY
     reason two runs of the same scenario differ).
  2. Metric-calculation functions (uptime, water, load shed, events, recovery,
     min battery, instability, interruption).
  3. The prototype Nimbus Score with a detailed breakdown.
  4. Decision-quality checks (hospital safety, ordering, desalination
     smoothness, cooldown/flapping, explanations).
  5. Fair-comparison helpers that consume recorded runs and report the actual
     results for each controller WITHOUT manipulating any controller's numbers.

All metric calculations use the actual recorded simulation values. No result is
fabricated, and no controller's numbers are improved so it can win.
"""

import math

from evaluation_config import (
    DESALINATION_MAX_OPERATING_PCT,
    DESALINATION_MAX_STEP_PCT_PER_TICK,
    DESALINATION_MIN_OPERATING_PCT,
    HOSPITAL_OPERATIONAL_PCT,
    INTERRUPTION_FLOORS_SCORE,
    MEANINGFUL_STATE_DELTA_PCT,
    RECOVERY_BATTERY_PCT,
    RECOVERY_SURPLUS_KW,
    SHED_EVENT_MIN_DROP_PCT,
    TICK_INTERVAL_SECONDS,
    WATER_RECOVERED_PCT,
    W_BATTERY,
    W_CRITICAL_UPTIME,
    W_EVENTS,
    W_INSTABILITY,
    W_RECOVERY,
    W_SHED,
    W_WATER,
)

CONTROLLER_MODES = ("naive", "reactive", "nimbus")

# Resource states (consistent with controller/hysteresis).
STATE_NORMAL = "NORMAL"
STATE_REDUCED = "REDUCED"
STATE_SHED = "SHED"
STATE_RESTORING = "RESTORING"
STATE_THROTTLED = "THROTTLED"


# ---------------------------------------------------------------------------
# Deterministic physics model (shared across all controllers)
# ---------------------------------------------------------------------------

class BatteryModel:
    """
    Minimal deterministic battery/integration model used for fair comparison.

    The real battery physics lives in Lalith's simulator; this model exists so
    the evaluation harness can run end-to-end deterministically and produce the
    same numbers for the same controller decisions. It is deliberately simple:

        net = solar + wind - totalDemand
        energy_delta_kwh = net * dt / 3600
        battery_kwh = clamp(battery_kwh + energy_delta_kwh, 0, capacity)
        battery_pct = battery_kwh / capacity * 100

    It accepts a clamp band so experiments can bound how low the battery may
    fall (the real island has physical limits). It NEVER invents generation or
    demand; it only integrates what the scenario and the controller provide.
    """

    def __init__(self, capacity_kwh, min_kwh=0.0, max_kwh=None):
        self.capacity_kwh = float(capacity_kwh)
        self.min_kwh = float(min_kwh)
        self.max_kwh = float(max_kwh) if max_kwh is not None else float(capacity_kwh)

    def step(self, battery_kwh, net_power_kw, dt_seconds=TICK_INTERVAL_SECONDS):
        energy_delta_kwh = net_power_kw * dt_seconds / 3600.0
        next_kwh = battery_kwh + energy_delta_kwh
        next_kwh = max(self.min_kwh, min(self.max_kwh, next_kwh))
        pct = next_kwh / self.capacity_kwh * 100.0 if self.capacity_kwh else 0.0
        return next_kwh, clamp(pct, 0.0, 100.0)


# ---------------------------------------------------------------------------
# Metric primitives
# ---------------------------------------------------------------------------

def clamp(value, lower, upper):
    return max(lower, min(upper, value))


def _finite(value):
    return isinstance(value, (int, float)) and value == value


def round_metric(value, digits=None):
    digits = eval_config_digits() if digits is None else digits
    return round(float(value), digits)


def eval_config_digits():
    from evaluation_config import METRIC_ROUND_DIGITS
    return METRIC_ROUND_DIGITS


def _hospital_pct(state_or_decision):
    """Return hospital operatingPct from a state dict or decision dict."""
    if "resources" in state_or_decision:
        return state_or_decision["resources"].get("hospital", {}).get("operatingPct", 0.0)
    updates = state_or_decision.get("resourceUpdates", {})
    return updates.get("hospital", {}).get("operatingPct", 0.0)


# ---------------------------------------------------------------------------
# Fair-comparison scenario driver
# ---------------------------------------------------------------------------

def default_resources():
    """Default initial resource map, identical to the Phase 2 test fixtures."""
    def r(rid, name, crit, max_kw, min_pct, pct, state, throttleable, shed):
        return {
            "id": rid,
            "name": name,
            "criticality": crit,
            "maxDemandKw": max_kw,
            "minimumOperatingPct": min_pct,
            "operatingPct": pct,
            "currentDemandKw": round(max_kw * pct / 100.0, 1),
            "state": state,
            "throttleable": throttleable,
            "shedCapable": shed,
        }
    return {
        "hospital": r("hospital", "Hospital", 100, 40, 100, 100, "PROTECTED", False, False),
        "desalination": r("desalination", "Desalination", 90, 120, 30, 100, "NORMAL", True, False),
        "residential": r("residential", "Residential", 70, 400, 20, 100, "NORMAL", False, True),
        "resort": r("resort", "Resort", 20, 250, 0, 100, "NORMAL", False, True),
    }


def make_initial_state(controller_mode="nimbus", battery_pct=74.0, active_event="clear-sky-noon",
                       timestamp_ms=0, tick=0):
    capacity = 1000.0
    resources = default_resources()
    total_demand = round(sum(x["currentDemandKw"] for x in resources.values()), 1)
    state = {
        "timestampMs": timestamp_ms,
        "tick": tick,
        "activeEvent": active_event,
        "controllerMode": controller_mode,
        "solarKw": 0.0,
        "windKw": 0.0,
        "totalGenerationKw": 0.0,
        "batteryKwh": capacity * battery_pct / 100.0,
        "batteryCapacityKwh": capacity,
        "batteryPct": battery_pct,
        "batteryChargeRateKw": 0.0,
        "batteryDischargeRateKw": 0.0,
        "totalDemandKw": total_demand,
        "netPowerKw": 0.0,
        "filteredNetPowerKw": None,
        "velocityKwS": None,
        "accelerationKwS2": None,
        "resources": resources,
    }
    return state


# ---------------------------------------------------------------------------
# Metric functions (operate on recorded tick series)
# ---------------------------------------------------------------------------

def total_ticks(trace):
    return max(len(trace), 1)


def critical_service_uptime_pct(trace):
    """
    Percentage of scenario ticks where the hospital is operational
    (operatingPct >= HOSPITAL_OPERATIONAL_PCT).
    """
    if not trace:
        return 0.0
    operational = sum(
        1 for s in trace if _hospital_pct(s) >= HOSPITAL_OPERATIONAL_PCT
    )
    return round_metric(operational / len(trace) * 100.0)


def water_availability_pct(trace):
    """Average desalination operatingPct over the scenario (proxy for water output)."""
    if not trace:
        return 0.0
    total = 0.0
    for s in trace:
        if "resources" in s:
            total += s["resources"].get("desalination", {}).get("operatingPct", 0.0)
        else:
            total += s.get("resourceUpdates", {}).get("desalination", {}).get("operatingPct", 0.0)
    return round_metric(total / len(trace))


def resource_current_demand_kw(s, rid):
    if "resources" in s:
        return s["resources"].get(rid, {}).get("currentDemandKw", 0.0)
    return s.get("resourceUpdates", {}).get(rid, {}).get("currentDemandKw", 0.0)


def resource_baseline_demand_kw(s, rid):
    """Baseline (nominal) demand for a resource from the scenario's own map."""
    if "resources" in s:
        return s["resources"].get(rid, {}).get("maxDemandKw", 0.0)
    return s.get("resourceUpdates", {}).get(rid, {}).get("maxDemandKw", 0.0)


def total_load_shed_kwh(trace, flexible=("residential", "resort")):
    """
    Total flexible energy removed from the given resources over the scenario.

        shed_kwh = sum_t [ sum_r (baselineDemand - actualDemand) ] * dt / 3600

    where baselineDemand is the resource's nominal (100%) max demand and
    actualDemand is its recorded currentDemandKw. Uses the real timestep so the
    result is in kilowatt-hours.
    """
    dt_hours = TICK_INTERVAL_SECONDS / 3600.0
    total = 0.0
    for s in trace:
        for rid in flexible:
            baseline = resource_baseline_demand_kw(s, rid)
            actual = resource_current_demand_kw(s, rid)
            total += max(0.0, baseline - actual)
    return round_metric(total * dt_hours)


def _resource_state(s, rid):
    if "resources" in s:
        return s["resources"].get(rid, {}).get("state")
    return s.get("resourceUpdates", {}).get(rid, {}).get("state")


def _resource_pct(s, rid):
    if "resources" in s:
        return s["resources"].get(rid, {}).get("operatingPct", 100.0)
    return s.get("resourceUpdates", {}).get(rid, {}).get("operatingPct", 100.0)


def shedding_events(trace, flexible=("residential", "resort")):
    """
    Count meaningful shedding events.

    An event is counted when a flexible resource ENTERS SHED, or when it enters
    REDUCED and its operating percentage dropped by at least
    SHED_EVENT_MIN_DROP_PCT from the previous tick. Consecutive transitions into
    the same kept-shed state are NOT counted again (no per-tick inflation).
    """
    count = 0
    prev_state = {rid: None for rid in flexible}
    prev_pct = {rid: 100.0 for rid in flexible}
    # Whether the resource was already counted as shed in its current run.
    armed = {rid: True for rid in flexible}

    for s in trace:
        for rid in flexible:
            st = _resource_state(s, rid)
            pct = _resource_pct(s, rid)
            if st in (STATE_SHED, STATE_REDUCED):
                entered_shed = st == STATE_SHED and prev_state[rid] != STATE_SHED
                entered_reduce_big = (
                    st == STATE_REDUCED
                    and prev_state[rid] != STATE_REDUCED
                    and (prev_pct[rid] - pct) >= SHED_EVENT_MIN_DROP_PCT
                )
                if entered_shed or entered_reduce_big:
                    count += 1
            prev_state[rid] = st
            prev_pct[rid] = pct
    return count


def recovery_time_ticks(trace):
    """
    Time (in ticks) from the first disturbance tick until stable recovery.

    The first disturbance tick t0 is the first tick where any flexible resource
    enters SHED/REDUCED or severity is WATCH or worse.

    Stable recovery t1 is the first tick >= t0 where ALL of the following hold:
      - resort is NORMAL at 100%
      - residential is NORMAL
      - desalination operatingPct >= WATER_RECOVERED_PCT
      - batteryPct >= RECOVERY_BATTERY_PCT
      - trajectory is STABLE or IMPROVING
      - filteredNetPowerKw >= RECOVERY_SURPLUS_KW

    If recovery is never reached, returns len(trace) (i.e. not recovered).
    """
    if not trace:
        return 0

    def _is_stable_recovered(s):
        if _resource_state(s, "resort") != STATE_NORMAL or _resource_pct(s, "resort") < 99.9:
            return False
        if _resource_state(s, "residential") != STATE_NORMAL:
            return False
        if _resource_pct(s, "desalination") < WATER_RECOVERED_PCT:
            return False
        if _battery_pct(s) < RECOVERY_BATTERY_PCT:
            return False
        traj = s.get("trajectory", "STABLE")
        if traj not in ("STABLE", "IMPROVING"):
            return False
        filtered = s.get("filteredNetPowerKw", 0.0)
        if not _finite(filtered) or filtered < RECOVERY_SURPLUS_KW:
            return False
        return True

    t0 = None
    for i, s in enumerate(trace):
        sev = s.get("severity", "STABLE")
        any_disp = any(
            _resource_state(s, rid) in (STATE_SHED, STATE_REDUCED) for rid in ("resort", "residential")
        )
        ordering = ("STABLE", "WATCH", "WARNING", "CRITICAL")
        if any_disp or (sev in ordering and ordering.index(sev) >= ordering.index("WATCH")):
            t0 = i
            break
    if t0 is None:
        return 0

    for i in range(t0, len(trace)):
        if _is_stable_recovered(trace[i]):
            return i - t0
    return len(trace) - t0


def recovery_time_seconds(trace):
    """Recovery time in seconds (ticks * TICK_INTERVAL_SECONDS)."""
    return round_metric(recovery_time_ticks(trace) * TICK_INTERVAL_SECONDS)


def minimum_battery_pct(trace):
    """Lowest batteryPct observed during the scenario (0-100)."""
    if not trace:
        return round_metric(100.0)
    values = [_battery_pct(s) for s in trace]
    return round_metric(min(values))


def _battery_pct(s):
    val = s.get("batteryPct", 100.0)
    return val if _finite(val) else 0.0


def resource_state_change_count(trace, resource_ids=("resort", "residential")):
    """Total number of state transitions for the given resources across the run."""
    changes = 0
    prev = {rid: None for rid in resource_ids}
    for s in trace:
        for rid in resource_ids:
            st = _resource_state(s, rid)
            if prev[rid] is not None and st != prev[rid]:
                changes += 1
            prev[rid] = st
    return changes


def resource_output_oscillation(trace, resource_id="desalination"):
    """
    Count oscillations in a resource's output: the number of times the sign of
    the per-tick change flips direction (up then down, or down then up).
    """
    pcts = [_resource_pct(s, resource_id) for s in trace]
    flips = 0
    prev_sign = 0
    for i in range(1, len(pcts)):
        delta = pcts[i] - pcts[i - 1]
        if abs(delta) < MEANINGFUL_STATE_DELTA_PCT:
            continue
        sign = 1 if delta > 0 else -1
        if prev_sign != 0 and sign != prev_sign:
            flips += 1
        prev_sign = sign
    return flips


def net_power_oscillation(trace, key="filteredNetPowerKw"):
    """
    Count net-power overshoot/oscillation: the number of times the filtered net
    power crosses zero (surplus <-> deficit) repeatedly.
    """
    crossings = 0
    prev_neg = None
    for s in trace:
        val = s.get(key)
        if not _finite(val):
            continue
        neg = val < 0.0
        if prev_neg is not None and neg != prev_neg:
            crossings += 1
        prev_neg = neg
    return crossings


def energy_balance_instability(trace):
    """
    Prototype instability index.

    Combines the observable signs of an unstable controller into one
    reproducible number:
        instability = state_change_count
                    + 0.5 * output_oscillations(desalination)
                    + 0.5 * net_power_crossings

    Each term is already a count, making the index intuitively interpretable:
    a lower number is a more stable island. This is a documented prototype
    metric, NOT a scientific measure.
    """
    state_changes = resource_state_change_count(trace)
    desal_osc = resource_output_oscillation(trace, "desalination")
    net_osc = net_power_oscillation(trace)
    return round_metric(state_changes + 0.5 * desal_osc + 0.5 * net_osc)


def critical_service_interruption(trace):
    """
    Return (interrupted, interrupted_ticks) where interrupted is True if any
    tick had the hospital below its operational level.
    """
    interrupted_ticks = sum(
        1 for s in trace if _hospital_pct(s) < HOSPITAL_OPERATIONAL_PCT
    )
    return interrupted_ticks > 0, interrupted_ticks


# ---------------------------------------------------------------------------
# Prototype Nimbus Score
# ---------------------------------------------------------------------------

def _normalize(value, worst, best):
    """Map value in [worst, best] to [0, 1]; 1 == best. Handles flat ranges."""
    if best == worst:
        return 1.0
    return clamp((value - worst) / (best - worst), 0.0, 1.0)


def nimbus_score(trace):
    """
    Compute the prototype Nimbus Score with a full breakdown.

    The score is derived from the recorded trace's own metrics. It is a
    combined-fraction prototype score on a 0..100 scale:

        reward_score   = sum(reward_w_i * sub_i)    / sum(reward_w_i)   # 0..1
        penalty_score  = sum(|pen_w_j| * bad_j)     / sum(|pen_w_j|)    # 0..1
        score          = clamp(reward_score * (1 - penalty_score), 0, 1) * 100

    - Each positive sub_i is better when higher (uptime, water, battery
      preservation, recovery speed).
    - Each bad_j is a normalized "badness" 0..1 for the penalized terms (load
      shed, shedding events, instability); 0 means no disruption.
    - A critical-service interruption floors the score to 0 because it is
      structurally disqualifying.

    REFERENCE BOUNDS (documented prototype choices, not physics):
      - load shed: worst 250 kWh, best 0 kWh
      - shedding events: worst 10, best 0
      - instability: worst 40 index points, best 0
      - battery preservation: min_battery / starting_battery (capped at 1)

    Returns a dict with the total score, per-term breakdown, and the raw
    metrics it was computed from.
    """
    breakdown = {}

    uptime = critical_service_uptime_pct(trace) / 100.0
    water = water_availability_pct(trace) / 100.0
    min_batt = minimum_battery_pct(trace) / 100.0
    start_batt = (trace[0]["batteryPct"] / 100.0) if trace else 1.0
    battery_preservation = clamp(min_batt / start_batt, 0.0, 1.0) if start_batt else 0.0

    shed_kwh = total_load_shed_kwh(trace)
    events = shedding_events(trace)
    instability = energy_balance_instability(trace)
    rec_time_s = recovery_time_seconds(trace)

    # Recovery speed sub-score: exponential decay, faster recovery -> near 1.
    TAU = 180.0  # seconds at which recovery-speed score halves (prototype bound)
    recovery_speed = math.exp(-rec_time_s / TAU)

    # Penalty sub-scores are "badness": 0 = no disruption, 1 = max disruption.
    # `_normalize` maps value -> 1 at `best`; pass (best, worst) so that value=best
    # (no disruption) yields 0 and value=worst (max disruption) yields 1.
    shed_norm = _normalize(shed_kwh, 0.0, 250.0)
    events_norm = _normalize(events, 0.0, 10.0)
    instab_norm = _normalize(instability, 0.0, 40.0)

    rewards = {
        "criticalUptime": (W_CRITICAL_UPTIME, uptime),
        "waterAvailability": (W_WATER, water),
        "batteryPreservation": (W_BATTERY, battery_preservation),
        "recoverySpeed": (W_RECOVERY, recovery_speed),
    }
    penalties = {
        "loadShedPenalty": (W_SHED, shed_norm),
        "sheddingEventsPenalty": (W_EVENTS, events_norm),
        "instabilityPenalty": (W_INSTABILITY, instab_norm),
    }

    def _record(group, name, weight, sub):
        contribution = weight * sub
        breakdown[name] = {
            "group": group,
            "weight": weight,
            "subScore": round_metric(sub),
            "contribution": round_metric(contribution),
        }
        return contribution

    reward_wsum = 0.0
    reward_wtotal = 0.0
    for name, (w, sub) in rewards.items():
        reward_wsum += _record("reward", name, w, sub)
        reward_wtotal += w
    penalty_wsum = 0.0
    penalty_wtotal = 0.0
    for name, (w, sub) in penalties.items():
        penalty_wsum += _record("penalty", name, abs(w), sub)
        penalty_wtotal += abs(w)

    reward_score = reward_wsum / reward_wtotal if reward_wtotal else 0.0
    penalty_score = penalty_wsum / penalty_wtotal if penalty_wtotal else 0.0

    interrupted, interrupted_ticks = critical_service_interruption(trace)
    score = clamp(reward_score * (1.0 - penalty_score), 0.0, 1.0) * 100.0
    if interrupted and INTERRUPTION_FLOORS_SCORE:
        score = 0.0

    return {
        "score": round_metric(score),
        "rewardScore": round_metric(reward_score),
        "penaltyScore": round_metric(penalty_score),
        "interrupted": interrupted,
        "interruptionPenaltyApplied": interrupted_ticks if interrupted else 0,
        "breakdown": breakdown,
        "metrics": {
            "criticalServiceUptimePct": critical_service_uptime_pct(trace),
            "waterAvailabilityPct": water_availability_pct(trace),
            "totalLoadShedKwh": shed_kwh,
            "sheddingEventCount": events,
            "recoveryTimeS": rec_time_s,
            "minBatteryPct": round_metric(min_batt * 100.0),
            "instabilityIndex": instability,
            "interrupted": interrupted,
        },
        "disclaimer": (
            "Prototype evaluation metric for demonstration only. The weighting is "
            "a team-chosen preference (see evaluation_config.py), not a "
            "scientifically optimal or universally applicable score."
        ),
    }


# ---------------------------------------------------------------------------
# Decision-quality checks
# ---------------------------------------------------------------------------

def hospital_never_shed(trace):
    """True if the hospital is always PROTECTED at >= operational level."""
    return all(_hospital_pct(s) >= HOSPITAL_OPERATIONAL_PCT for s in trace)


def resort_shed_before_residential(trace):
    """
    Check that any resort shed happens BEFORE any residential reduction.

    Returns (ok, resort_shed_tick, residential_reduce_tick). Ticks counted from
    the first occurrence; a missing event is +inf.
    """
    resort_shed_at = None
    residential_reduce_at = None
    for i, s in enumerate(trace):
        if resort_shed_at is None and _resource_state(s, "resort") == STATE_SHED:
            resort_shed_at = i
        if residential_reduce_at is None and _resource_state(s, "residential") == STATE_REDUCED:
            residential_reduce_at = i
    if residential_reduce_at is None:
        return True, resort_shed_at, residential_reduce_at
    if resort_shed_at is None:
        # Residential was reduced with resort never shed -> violates ordering.
        return False, resort_shed_at, residential_reduce_at
    return resort_shed_at <= residential_reduce_at, resort_shed_at, residential_reduce_at


def desalination_within_band(trace):
    """True if desalination operatingPct stays within its safe band every tick."""
    return all(
        DESALINATION_MIN_OPERATING_PCT - 1e-9 <= _resource_pct(s, "desalination") <= DESALINATION_MAX_OPERATING_PCT + 1e-9
        for s in trace
    )


def desalination_smooth(trace):
    """True if no single-tick desalination change exceeds the ramp limit."""
    pcts = [_resource_pct(s, "desalination") for s in trace]
    return all(
        abs(b - a) <= DESALINATION_MAX_STEP_PCT_PER_TICK + 1e-9
        for a, b in zip(pcts, pcts[1:])
    )


def no_rapid_flapping(trace, resource_id="resort", min_hold_ticks=3):
    """
    Check for rapid SHED -> NORMAL -> SHED flapping.

    Returns False if a resource returns to NORMAL after a shed and is then
    shed again within `min_hold_ticks`. This is the guarantee the cooldown is
    designed to provide.
    """
    states = [_resource_state(s, resource_id) for s in trace]
    last_shed = None
    for i, st in enumerate(states):
        if st == STATE_SHED:
            if last_shed is not None and (i - last_shed) > 1:
                # Check whether a NORMAL in between was too short-lived.
                in_between = states[last_shed:i]
                if any(x == STATE_NORMAL for x in in_between) and (i - last_shed) <= min_hold_ticks:
                    return False
            last_shed = i
    return True


def resource_restore_order(trace):
    """
    Check that lower-criticality flexible resources restore AFTER higher ones:
    residential (more critical) should reach NORMAL before resort.

    Restore is measured relative to the crisis: the first tick each resource is
    back at NORMAL (100%) AFTER the first disruption (the first tick either
    flexible resource leaves NORMAL). This avoids counting the pre-crisis
    NORMAL ticks.

    Returns (ok, residential_normal_at, resort_normal_at).
    """
    def _n(s, rid):
        return _resource_state(s, rid) == STATE_NORMAL and _resource_pct(s, rid) >= 99.9

    disruption_at = None
    for i, s in enumerate(trace):
        if not (_n(s, "residential") and _n(s, "resort")):
            disruption_at = i
            break
    start = disruption_at if disruption_at is not None else 0

    res_at = None
    resort_at = None
    for i in range(start, len(trace)):
        s = trace[i]
        if res_at is None and _n(s, "residential"):
            res_at = i
        if resort_at is None and _n(s, "resort"):
            resort_at = i
        if res_at is not None and resort_at is not None:
            break

    if resort_at is None:
        ok = res_at is not None
        return ok, res_at, resort_at
    if res_at is None:
        return False, res_at, resort_at
    return res_at <= resort_at, res_at, resort_at


def explanation_quality(decisions):
    """
    Verify Nimbus explanations carry the required content:
      - trigger/reason (the reason/event)
      - protected resource (hospital)
      - action taken
      - expected outcome
    Returns a dict of pass/fail counts over the given decisions.
    """
    required = {
        "reason": ("reasonCode" in d and bool(d.get("reasonCode")) for d in decisions),
        "explanation_nonempty": (bool(d.get("explanation")) for d in decisions),
        "expected_outcome": (bool(d.get("expectedOutcome")) for d in decisions),
        "action_present": (bool(d.get("action")) for d in decisions),
        "hospital_protected_text": (
            "hospital" in (d.get("explanation", "") + d.get("expectedOutcome", "")).lower()
            for d in decisions
        ),
        "no_forecast_claim": (
            "forecast" not in d.get("explanation", "").lower()
            and "predict" not in d.get("explanation", "").lower()
            for d in decisions
        ),
    }
    return {
        name: {"total": len(decisions), "pass": sum(1 for p in it if p)}
        for name, it in required.items()
    }


# ---------------------------------------------------------------------------
# Fair-comparison helpers
# ---------------------------------------------------------------------------

def run_scenario_for_controller(initial_state, generation_trace, demand_trace,
                                controller_mode, run_controller_fn, battery_model=None):
    """
    Drive a single controller through a scenario and record a tick series.

    `generation_trace` : list of (solarKw, windKw) per tick.
    `demand_trace`     : list of dicts mapping resourceId -> desired operatingPct
                         per tick (the fixed demand conditions). If None, demand
                         is whatever the controller's resourceUpdates set.
    `run_controller_fn`: callable(state) -> NimbusDecision (injects the engine).

    Returns a list of compact recorded tick dicts:
        {tick, batteryPct, netPowerKw, filteredNetPowerKw, velocityKwS,
         accelerationKwS2, severity, trajectory, action, reasonCode,
         resources: {id: {state, operatingPct, currentDemandKw}}}
    """
    battery_model = battery_model or BatteryModel(initial_state["batteryCapacityKwh"])
    state = dict(initial_state)
    state["controllerMode"] = controller_mode

    recorded = []
    for i in range(len(generation_trace)):
        solar, wind = generation_trace[i]
        state["tick"] = i
        state["solarKw"] = solar
        state["windKw"] = wind
        state["totalGenerationKw"] = round(solar + wind, 1)

        if demand_trace is not None and i < len(demand_trace):
            for rid, pct in demand_trace[i].items():
                res = state["resources"].get(rid)
                if res is not None:
                    res["operatingPct"] = pct
                    res["currentDemandKw"] = round(res["maxDemandKw"] * pct / 100.0, 1)

        state["totalDemandKw"] = round(
            sum(r["currentDemandKw"] for r in state["resources"].values()), 1
        )
        # Disturbance trace supplies raw demand that the controller then adjusts
        # via operatingPct. Baseline for load-shed is maxDemandKw.
        state["netPowerKw"] = round(solar + wind - state["totalDemandKw"], 1)

        decision = run_controller_fn(state)

        # Battery integrates the POST-decision net power.
        post_demand = round(
            sum(
                decision["resourceUpdates"].get(rid, {}).get("currentDemandKw", 0.0)
                for rid in ("hospital", "residential", "resort", "desalination")
            ),
            1,
        )
        post_net = round(solar + wind - post_demand, 1)
        battery_kwh, battery_pct = battery_model.step(
            state.get("batteryKwh", 0.0), post_net
        )

        state["batteryKwh"] = battery_kwh
        state["batteryPct"] = battery_pct
        state["filteredNetPowerKw"] = decision["metrics"]["filteredNetPowerKw"]
        state["velocityKwS"] = decision["metrics"]["velocityKwS"]
        state["accelerationKwS2"] = decision["metrics"]["accelerationKwS2"]

        resources_snap = {}
        for rid in ("hospital", "residential", "resort", "desalination"):
            upd = decision["resourceUpdates"].get(rid)
            snap = dict(upd) if upd else dict(state["resources"].get(rid, {}))
            resources_snap[rid] = snap
            if upd:
                state["resources"][rid] = snap

        recorded.append({
            "tick": i,
            "batteryPct": round_metric(battery_pct),
            "netPowerKw": round_metric(state["netPowerKw"]),
            "filteredNetPowerKw": round_metric(decision["metrics"]["filteredNetPowerKw"]),
            "velocityKwS": round_metric(decision["metrics"]["velocityKwS"]),
            "accelerationKwS2": round_metric(decision["metrics"]["accelerationKwS2"]),
            "severity": decision["severity"],
            "trajectory": decision["trajectory"],
            "action": decision["action"],
            "reasonCode": decision["reasonCode"],
            "explanation": decision.get("explanation", ""),
            "expectedOutcome": decision.get("expectedOutcome", ""),
            "resources": resources_snap,
        })
    return recorded


def evaluate_controller(recorded_trace, controller_mode):
    """Compute every metric for one recorded controller run."""
    interrupted, interrupted_ticks = critical_service_interruption(recorded_trace)
    return {
        "controllerMode": controller_mode,
        "metrics": {
            "criticalServiceUptimePct": critical_service_uptime_pct(recorded_trace),
            "waterAvailabilityPct": water_availability_pct(recorded_trace),
            "totalLoadShedKwh": total_load_shed_kwh(recorded_trace),
            "sheddingEventCount": shedding_events(recorded_trace),
            "recoveryTimeS": recovery_time_seconds(recorded_trace),
            "minBatteryPct": minimum_battery_pct(recorded_trace),
            "instabilityIndex": energy_balance_instability(recorded_trace),
            "interrupted": interrupted,
            "interruptedTicks": interrupted_ticks,
        },
        "score": nimbus_score(recorded_trace),
        "quality": {
            "hospitalNeverShed": hospital_never_shed(recorded_trace),
            "resortShedBeforeResidential": resort_shed_before_residential(recorded_trace)[0],
            "desalinationWithinBand": desalination_within_band(recorded_trace),
            "desalinationSmooth": desalination_smooth(recorded_trace),
        },
    }


def compare_controllers(results):
    """
    Compare recorded evaluation results across controllers.

    `results` is a dict {controller_mode: evaluate_controller(...) output}.
    Builds an honest side-by-side summary. It NEVER alters any controller's
    numbers: if Nimbus is worse on a metric, that actual number is preserved.

    Returns a dict with a table of metrics x controllers and a per-controller
    ranking on the prototype score.
    """
    metrics_keys = [
        "criticalServiceUptimePct",
        "waterAvailabilityPct",
        "totalLoadShedKwh",
        "sheddingEventCount",
        "recoveryTimeS",
        "minBatteryPct",
        "instabilityIndex",
        "interrupted",
    ]
    lower_is_better = {
        "totalLoadShedKwh": True,
        "sheddingEventCount": True,
        "recoveryTimeS": True,
        "instabilityIndex": True,
        "interrupted": True,
    }
    table = {}
    for key in metrics_keys:
        row = {}
        for mode, r in results.items():
            row[mode] = r["metrics"].get(key)
        table[key] = row

    scores = {mode: r["score"]["score"] for mode, r in results.items()}
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    ranking = [{"controllerMode": mode, "score": score} for mode, score in ranked]

    best = {}
    for key in metrics_keys:
        vals = {mode: r["metrics"].get(key) for mode, r in results.items()}
        present = {mode: v for mode, v in vals.items() if v is not None}
        if not present:
            continue
        if lower_is_better.get(key, False):
            best[key] = min(present, key=lambda m: present[m])
        else:
            best[key] = max(present, key=lambda m: present[m])

    return {
        "table": table,
        "scores": scores,
        "ranking": ranking,
        "bestPerMetric": best,
        "note": (
            "Fair comparison: all controllers received identical scenario inputs. "
            "Values are reported as recorded for each controller and are not "
            "adjusted to favor any controller."
        ),
    }
