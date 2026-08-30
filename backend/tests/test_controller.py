"""
Nimbus Phase 2 — decision-engine tests.

Run from the backend directory:

    .venv/bin/python -m pytest tests -q
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from controller import (
    calculate_energy_metrics,
    classify_severity,
    compute_desalination,
    detect_trajectory,
    run_controller,
)


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def make_resource(rid, name, criticality, max_kw, min_pct, pct, state, throttleable, shed_capable):
    return {
        "id": rid,
        "name": name,
        "criticality": criticality,
        "maxDemandKw": max_kw,
        "minimumOperatingPct": min_pct,
        "operatingPct": pct,
        "currentDemandKw": round(max_kw * pct / 100.0, 1),
        "state": state,
        "throttleable": throttleable,
        "shedCapable": shed_capable,
    }


def make_resources():
    return {
        "hospital": make_resource("hospital", "Hospital", 100, 40, 100, 100, "PROTECTED", False, False),
        "desalination": make_resource("desalination", "Desalination", 90, 120, 30, 100, "NORMAL", True, False),
        "residential": make_resource("residential", "Residential", 70, 400, 20, 100, "NORMAL", False, True),
        "resort": make_resource("resort", "Resort", 20, 250, 0, 100, "NORMAL", False, True),
    }


def make_state(**over):
    state = {
        "timestampMs": 0,
        "tick": 60,
        "activeEvent": "clear-sky-noon",
        "controllerMode": "nimbus",
        "solarKw": 900.0,
        "windKw": 100.0,
        "totalDemandKw": 810.0,
        "batteryKwh": 740.0,
        "batteryCapacityKwh": 1000.0,
        "batteryPct": 74.0,
        "batteryChargeRateKw": 0.0,
        "batteryDischargeRateKw": 0.0,
        "netPowerKw": 190.0,
        "filteredNetPowerKw": None,
        "velocityKwS": None,
        "accelerationKwS2": None,
        "resources": make_resources(),
    }
    state.update(over)
    return state


def total_demand(state):
    return round(sum(r["currentDemandKw"] for r in state["resources"].values()), 1)


def advance(state, decision):
    """Simulate the backend write-back loop: apply metrics + resource updates."""
    nxt = dict(state)
    nxt["filteredNetPowerKw"] = decision["metrics"]["filteredNetPowerKw"]
    nxt["velocityKwS"] = decision["metrics"]["velocityKwS"]
    nxt["accelerationKwS2"] = decision["metrics"]["accelerationKwS2"]
    resources = {}
    for rid, r in state["resources"].items():
        upd = decision["resourceUpdates"].get(rid)
        resources[rid] = dict(upd) if upd else dict(r)
    nxt["resources"] = resources
    nxt["tick"] = state["tick"] + 1
    return nxt


def simulate(steps, controller_mode="nimbus", active_event="storm-cloud-cover", start_battery=74.0):
    """Drive a multi-tick scenario. `steps` is a list of {solar, wind, battery}."""
    state = make_state(
        controllerMode=controller_mode,
        activeEvent=active_event,
        tick=0,
        batteryPct=start_battery,
    )
    decisions = []
    for i, step in enumerate(steps):
        state["tick"] = i
        state["solarKw"] = step["solar"]
        state["windKw"] = step["wind"]
        state["batteryPct"] = step["battery"]
        state["totalDemandKw"] = total_demand(state)
        state["netPowerKw"] = round(step["solar"] + step["wind"] - state["totalDemandKw"], 1)
        state["batteryKwh"] = state["batteryCapacityKwh"] * step["battery"] / 100.0
        decision = run_controller(state)
        decisions.append(decision)
        state = advance(state, decision)
    return decisions


def resource_snapshots(decisions, rid):
    return [d["resourceUpdates"][rid] for d in decisions]


def operating_pcts(decisions, rid):
    return [d["resourceUpdates"][rid]["operatingPct"] for d in decisions]


def assert_valid_percentages(decisions):
    for d in decisions:
        for rid, res in d["resourceUpdates"].items():
            assert 0.0 <= res["operatingPct"] <= 100.0, (rid, res["operatingPct"])


def assert_hospital_protected(decisions):
    for d in decisions:
        hospital = d["resourceUpdates"]["hospital"]
        assert hospital["state"] == "PROTECTED"
        assert hospital["operatingPct"] == 100.0


def assert_decision_shape(decision):
    for key in (
        "timestampMs",
        "controllerMode",
        "severity",
        "trajectory",
        "action",
        "reasonCode",
        "explanation",
        "expectedOutcome",
        "resourceUpdates",
        "metrics",
    ):
        assert key in decision, key
    for key in ("netPowerKw", "filteredNetPowerKw", "velocityKwS", "accelerationKwS2", "warmupComplete"):
        assert key in decision["metrics"], key
    assert decision["severity"] in ("STABLE", "WATCH", "WARNING", "CRITICAL")
    assert decision["trajectory"] in ("STABLE", "IMPROVING", "DETERIORATING", "CRITICAL")
    assert isinstance(decision["explanation"], str) and decision["explanation"]
    assert isinstance(decision["expectedOutcome"], str) and decision["expectedOutcome"]


# ---------------------------------------------------------------------------
# 1. Stable island
# ---------------------------------------------------------------------------

def test_stable_island_nimbus():
    state = make_state(controllerMode="nimbus", tick=60)
    decision = run_controller(state)

    assert_decision_shape(decision)
    assert decision["severity"] == "STABLE"
    assert decision["trajectory"] in ("STABLE", "IMPROVING")
    assert decision["action"] == "NONE"
    assert decision["reasonCode"] in ("OK_STABLE", "OK_IMPROVING")
    assert_hospital_protected([decision])
    assert decision["resourceUpdates"]["resort"]["operatingPct"] == 100.0
    assert decision["resourceUpdates"]["residential"]["operatingPct"] == 100.0
    assert decision["resourceUpdates"]["desalination"]["operatingPct"] == 100.0
    assert_valid_percentages([decision])


# ---------------------------------------------------------------------------
# 2. Storm causing generation loss
# ---------------------------------------------------------------------------

STORM = [
    {"solar": 810, "wind": 100, "battery": 32},
    {"solar": 806, "wind": 100, "battery": 31},
    {"solar": 798, "wind": 100, "battery": 30},
    {"solar": 786, "wind": 100, "battery": 29},
    {"solar": 770, "wind": 100, "battery": 28},
    {"solar": 750, "wind": 100, "battery": 26},
    {"solar": 700, "wind": 100, "battery": 23},
    {"solar": 620, "wind": 100, "battery": 19},
    {"solar": 500, "wind": 100, "battery": 15},
    {"solar": 350, "wind": 100, "battery": 12},
]


def test_storm_generation_loss():
    decisions = simulate(STORM)

    assert_hospital_protected(decisions)
    assert_valid_percentages(decisions)

    # Nimbus must have intervened (shed, throttle, or reduce) at some point.
    assert any(
        d["action"] in ("SHED", "THROTTLE", "REDUCE", "COOLDOWN") for d in decisions
    )

    # Desalination is throttled smoothly and never shed.
    for res in resource_snapshots(decisions, "desalination"):
        assert res["state"] != "SHED"
        assert 30.0 <= res["operatingPct"] <= 100.0

    # At least one shed of the resort happened before residential was reduced.
    resort_states = [d["resourceUpdates"]["resort"]["state"] for d in decisions]
    residential_states = [d["resourceUpdates"]["residential"]["state"] for d in decisions]
    assert "SHED" in resort_states

    first_shed = resort_states.index("SHED")
    first_reduce = residential_states.index("REDUCED") if "REDUCED" in residential_states else float("inf")
    assert first_shed <= first_reduce


# ---------------------------------------------------------------------------
# 3. Tourist surge
# ---------------------------------------------------------------------------

def test_tourist_surge_sheds_resort_first():
    # High demand from the resort, generation flat, battery drifting down.
    surge = [
        {"solar": 500, "wind": 100, "battery": 36},
        {"solar": 490, "wind": 100, "battery": 32},
        {"solar": 480, "wind": 100, "battery": 28},
        {"solar": 470, "wind": 100, "battery": 26},
        {"solar": 460, "wind": 100, "battery": 24},
        {"solar": 450, "wind": 100, "battery": 22},
    ]
    decisions = simulate(surge, active_event="tourist-surge")

    assert_hospital_protected(decisions)
    resort_states = [d["resourceUpdates"]["resort"]["state"] for d in decisions]
    residential_states = [d["resourceUpdates"]["residential"]["state"] for d in decisions]

    assert "SHED" in resort_states
    first_shed = resort_states.index("SHED")
    first_reduce = residential_states.index("REDUCED") if "REDUCED" in residential_states else float("inf")
    assert first_shed <= first_reduce


# ---------------------------------------------------------------------------
# 4. Water emergency
# ---------------------------------------------------------------------------

def test_water_emergency_desalination_never_abruptly_off():
    decisions = simulate(STORM, active_event="water-emergency")

    for res in resource_snapshots(decisions, "desalination"):
        assert res["state"] in ("NORMAL", "THROTTLED")
        assert res["operatingPct"] >= 30.0

    assert_hospital_protected(decisions)


# ---------------------------------------------------------------------------
# 5. Compound crisis
# ---------------------------------------------------------------------------

def test_compound_crisis():
    decisions = simulate(STORM)

    final = decisions[-1]
    assert final["severity"] == "CRITICAL"
    assert final["resourceUpdates"]["resort"]["state"] == "SHED"
    assert final["resourceUpdates"]["residential"]["state"] == "REDUCED"
    # Desalination never leaves its safe band, and it is never shed.
    desal = final["resourceUpdates"]["desalination"]
    assert desal["state"] != "SHED"
    assert 30.0 <= desal["operatingPct"] <= 100.0
    assert_hospital_protected(decisions)


# ---------------------------------------------------------------------------
# 6. Resort shed strictly before residential reduction (battery margin)
# ---------------------------------------------------------------------------

def test_resort_shed_before_residential_reduction():
    # Battery in (25, 30]: WARNING severity with the resort shed, residential intact.
    state = make_state(
        controllerMode="nimbus",
        activeEvent="storm-cloud-cover",
        tick=60,
        solarKw=500,
        windKw=100,
        totalDemandKw=810,
        netPowerKw=-210,
        batteryPct=27,
    )
    decision = run_controller(state)
    assert decision["resourceUpdates"]["resort"]["state"] == "SHED"
    assert decision["resourceUpdates"]["resort"]["operatingPct"] == 0.0
    assert decision["resourceUpdates"]["residential"]["state"] == "NORMAL"
    assert decision["resourceUpdates"]["residential"]["operatingPct"] == 100.0

    # Battery at or below 25: residential is then reduced as a last resort.
    state["batteryPct"] = 24
    decision = run_controller(state)
    assert decision["resourceUpdates"]["residential"]["state"] == "REDUCED"
    assert decision["resourceUpdates"]["residential"]["operatingPct"] == 80.0


# ---------------------------------------------------------------------------
# 7. Hospital is never automatically shed
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("mode", ["naive", "reactive", "nimbus"])
def test_hospital_never_shed(mode):
    decisions = simulate(STORM, controller_mode=mode)
    assert_hospital_protected(decisions)
    for d in decisions:
        assert d["resourceUpdates"]["hospital"]["state"] == "PROTECTED"


# ---------------------------------------------------------------------------
# 8. Desalination output is clamped safely and transitions smoothly
# ---------------------------------------------------------------------------

def test_desalination_clamped_safely():
    decisions = simulate(STORM, controller_mode="nimbus")

    pcts = operating_pcts(decisions, "desalination")
    for pct in pcts:
        assert 30.0 <= pct <= 100.0

    # No single-tick jump larger than the configured ramp step.
    for a, b in zip(pcts, pcts[1:]):
        assert abs(b - a) <= 5.0 + 1e-9, (a, b)


# ---------------------------------------------------------------------------
# 9. Cooldown prevents rapid shed/restore switching
# ---------------------------------------------------------------------------

def test_cooldown_prevents_flapping():
    steps = [{"solar": 900, "wind": 100, "battery": 60}]          # tick 0: stable
    steps += [{"solar": 400, "wind": 100, "battery": 28}]         # tick 1: shed
    steps += [{"solar": 1000, "wind": 300, "battery": 70}] * 70   # ticks 2..: recovery

    decisions = simulate(steps)
    resort_states = [d["resourceUpdates"]["resort"]["state"] for d in decisions]
    resort_pcts = operating_pcts(decisions, "resort")

    # Shed happened at tick 1.
    assert resort_states[1] == "SHED"
    assert resort_pcts[1] == 0.0

    # It must NOT reconnect immediately despite the huge surplus at tick 2.
    assert resort_states[2] != "NORMAL"
    assert resort_pcts[2] == 0.0

    # Through the cooldown window it stays off.
    for i in range(2, 10):
        assert resort_states[i] != "NORMAL", i
        assert resort_pcts[i] == 0.0, i

    # Restoration is a gradual ramp: RESTORING appears, increases by the ramp
    # limit per tick, and reaches NORMAL only at 100%.
    restoring = [p for s, p in zip(resort_states, resort_pcts) if s == "RESTORING"]
    assert restoring, "resort never entered RESTORING"
    for a, b in zip(restoring, restoring[1:]):
        assert 0.0 <= b - a <= 5.0 + 1e-9, (a, b)
    assert resort_states[-1] == "NORMAL"
    assert resort_pcts[-1] == 100.0

    # Cooldown counter was actually tracked.
    assert any(d["resourceUpdates"]["resort"].get("cooldownTicksRemaining", 0) > 0 for d in decisions)


def test_cooldown_aborts_on_redeterioration():
    steps = [{"solar": 900, "wind": 100, "battery": 60}]   # stable
    steps += [{"solar": 400, "wind": 100, "battery": 28}]  # shed
    steps += [{"solar": 1000, "wind": 300, "battery": 70}] # recovery -> cooldown
    steps += [{"solar": 300, "wind": 100, "battery": 22}]  # re-deterioration -> back to SHED
    steps += [{"solar": 1000, "wind": 300, "battery": 70}] # recovery again

    decisions = simulate(steps)
    resort_states = [d["resourceUpdates"]["resort"]["state"] for d in decisions]

    assert resort_states[0] == "NORMAL"
    assert resort_states[1] == "SHED"
    assert resort_states[2] != "NORMAL"          # cooldown, not restored
    assert resort_states[3] == "SHED"            # re-shed, no premature restore
    assert resort_states[4] != "NORMAL"          # still held off
    assert len([s for s in resort_states if s == "NORMAL"]) == 1  # never flapped back


# ---------------------------------------------------------------------------
# 10. Gradual recovery / restoration
# ---------------------------------------------------------------------------

def test_gradual_restoration():
    steps = [{"solar": 900, "wind": 100, "battery": 74}]                 # stable
    steps += [{"solar": 400, "wind": 100, "battery": 28}]                # shed / crisis
    steps += [{"solar": 1100, "wind": 400, "battery": 75}] * 70          # full recovery

    decisions = simulate(steps)

    # Ignore the pre-crisis tick where everything was already normal.
    shed_index = next(i for i, d in enumerate(decisions)
                      if d["resourceUpdates"]["resort"]["state"] == "SHED")
    start = shed_index + 1

    # Residential returns to normal before the resort does.
    residential_normal_at = next(
        (i for i, d in enumerate(decisions[start:], start=start)
         if d["resourceUpdates"]["residential"]["state"] == "NORMAL" and d["resourceUpdates"]["residential"]["operatingPct"] == 100.0),
        float("inf"),
    )
    resort_normal_at = next(
        (i for i, d in enumerate(decisions[start:], start=start)
         if d["resourceUpdates"]["resort"]["state"] == "NORMAL" and d["resourceUpdates"]["resort"]["operatingPct"] == 100.0),
        float("inf"),
    )
    assert residential_normal_at < resort_normal_at

    # Desalination recovery is gradual (bounded per-tick steps), never a jump.
    recovery_slice = decisions[start:]
    desal_pcts = operating_pcts(recovery_slice, "desalination")
    for a, b in zip(desal_pcts, desal_pcts[1:]):
        assert abs(b - a) <= 5.0 + 1e-9

    assert decisions[-1]["resourceUpdates"]["resort"]["state"] == "NORMAL"
    assert decisions[-1]["resourceUpdates"]["resort"]["operatingPct"] == 100.0


# ---------------------------------------------------------------------------
# 11. All controllers produce valid decisions over a storm
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("mode", ["naive", "reactive", "nimbus"])
def test_all_controllers_valid_over_storm(mode):
    decisions = simulate(STORM, controller_mode=mode)
    for d in decisions:
        assert_decision_shape(d)
    assert_valid_percentages(decisions)
    assert_hospital_protected(decisions)
    # Every decision has a readable, real explanation.
    for d in decisions:
        assert d["explanation"]
        assert d["expectedOutcome"]
        assert len(d["explanation"]) > 20


# ---------------------------------------------------------------------------
# 12. Naive controller: battery-only thresholds
# ---------------------------------------------------------------------------

def test_naive_battery_thresholds():
    state = make_state(controllerMode="naive", batteryPct=25, tick=60)
    decision = run_controller(state)
    assert decision["resourceUpdates"]["resort"]["state"] == "SHED"
    assert decision["resourceUpdates"]["residential"]["state"] == "NORMAL"

    state = make_state(controllerMode="naive", batteryPct=15, tick=60)
    decision = run_controller(state)
    assert decision["resourceUpdates"]["resort"]["state"] == "SHED"
    assert decision["resourceUpdates"]["residential"]["state"] == "REDUCED"

    state = make_state(controllerMode="naive", batteryPct=50, tick=60)
    decision = run_controller(state)
    assert decision["action"] == "NONE"
    assert decision["resourceUpdates"]["resort"]["state"] == "NORMAL"


# ---------------------------------------------------------------------------
# 13. Reactive controller: battery + net power, basic hysteresis
# ---------------------------------------------------------------------------

def test_reactive_uses_net_power_and_hysteresis():
    state = make_state(
        controllerMode="reactive",
        batteryPct=22,
        netPowerKw=-60,
        batteryDischargeRateKw=40,
        tick=60,
    )
    decision = run_controller(state)
    assert decision["resourceUpdates"]["resort"]["state"] == "SHED"

    # Restore only above the higher restore line with a positive net power.
    state = make_state(
        controllerMode="reactive",
        batteryPct=45,
        netPowerKw=30,
        batteryDischargeRateKw=0,
        tick=61,
    )
    decision = run_controller(state)
    assert decision["resourceUpdates"]["resort"]["state"] == "NORMAL"

    # Just above the shed line it does NOT shed (hysteresis).
    state = make_state(
        controllerMode="reactive",
        batteryPct=26,
        netPowerKw=10,
        batteryDischargeRateKw=0,
        tick=62,
    )
    decision = run_controller(state)
    assert decision["resourceUpdates"]["resort"]["state"] == "NORMAL"


# ---------------------------------------------------------------------------
# 14. Energy-balance math
# ---------------------------------------------------------------------------

def test_energy_metrics_ema_persistence():
    metrics = calculate_energy_metrics(
        400,
        100,
        410,
        previous={"filteredNetPowerKw": 80.0, "velocityKwS": 1.0, "accelerationKwS2": 0.1},
        tick=60,
    )
    assert metrics["netPowerKw"] == pytest.approx(90.0)
    assert metrics["filteredNetPowerKw"] == pytest.approx(83.0)
    assert metrics["velocityKwS"] == pytest.approx(1.4)
    assert metrics["accelerationKwS2"] == pytest.approx(0.1)  # round(0.145, 1)
    assert metrics["warmupComplete"] is True
    assert all(math.isfinite(v) for v in metrics.values() if isinstance(v, (int, float)))


def test_energy_metrics_tolerates_non_finite_input():
    metrics = calculate_energy_metrics(
        float("nan"),
        100,
        410,
        previous={"filteredNetPowerKw": 42.0, "velocityKwS": -1.5, "accelerationKwS2": 0.0},
        tick=60,
    )
    assert metrics["filteredNetPowerKw"] == 42.0
    assert metrics["velocityKwS"] == -1.5
    assert metrics["warmupComplete"] is False
    assert all(math.isfinite(v) for v in metrics.values() if isinstance(v, (int, float)))


def test_non_finite_state_does_not_crash():
    state = make_state(controllerMode="nimbus", solarKw=float("nan"), tick=60)
    decision = run_controller(state)
    assert_decision_shape(decision)


def test_trajectory_and_severity_labels():
    cfg = None
    metrics = {
        "filteredNetPowerKw": 40.0,
        "netPowerKw": 40.0,
        "velocityKwS": -4.0,
        "accelerationKwS2": 0.0,
        "warmupComplete": True,
    }
    assert detect_trajectory(metrics, 50, cfg) == "DETERIORATING"
    assert classify_severity("DETERIORATING", metrics, 50, cfg) == "WARNING"

    # A steep decline only becomes CRITICAL once the island is in deficit.
    metrics["velocityKwS"] = -12.0
    assert detect_trajectory(metrics, 50, cfg) == "DETERIORATING"

    metrics["netPowerKw"] = -10.0
    assert detect_trajectory(metrics, 50, cfg) == "CRITICAL"
    assert classify_severity("CRITICAL", metrics, 50, cfg) == "CRITICAL"


# ---------------------------------------------------------------------------
# 15. PD desalination smoothness
# ---------------------------------------------------------------------------

def test_pd_desalination_is_smooth_not_abrupt():
    desal = make_resource("desalination", "Desalination", 90, 120, 30, 100, "NORMAL", True, False)
    assert compute_desalination(desal, {"filteredNetPowerKw": -150.0}, 10.0)["operatingPct"] == 95.0

    desal["operatingPct"] = 95.0
    assert compute_desalination(desal, {"filteredNetPowerKw": -200.0}, -150.0)["operatingPct"] == 90.0

    # Repeated severe deficits settle at the PD's characteristic floor (bounded
    # above the absolute clamp by PD_MAX_CURTAIL_KW) and never go below 30%.
    for _ in range(50):
        previous = desal["operatingPct"]
        desal = compute_desalination(desal, {"filteredNetPowerKw": -200.0}, -200.0)
        assert desal["operatingPct"] >= 30.0
        assert abs(desal["operatingPct"] - previous) <= 5.0
    assert 30.0 <= desal["operatingPct"] <= 40.0
    assert desal["state"] == "THROTTLED"


# ---------------------------------------------------------------------------
# 16. Hospital protection is unconditional across every decision path
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("mode", ["naive", "reactive", "nimbus"])
def test_hospital_always_present_and_protected(mode):
    state = make_state(controllerMode=mode, batteryPct=10, tick=60)
    decision = run_controller(state)
    hospital = decision["resourceUpdates"]["hospital"]
    assert hospital["state"] == "PROTECTED"
    assert hospital["operatingPct"] == 100.0
    assert decision["explanation"]