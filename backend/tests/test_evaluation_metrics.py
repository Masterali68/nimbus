"""
Nimbus Phase 3 — Evaluation-metric tests.

Run from the backend directory:

    .venv/bin/python -m pytest tests/test_evaluation_metrics.py -q

Covers every metric function in evaluation_metrics.py, the prototype Nimbus
score, decision-quality checks, and determinism of controller output for
identical input.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

import evaluation_metrics as em
from controller import run_controller


# ---------------------------------------------------------------------------
# Helpers to build recorded traces
# ---------------------------------------------------------------------------

def make_trace(ticks, battery=74.0, desal_pct=100.0, resort_state="NORMAL",
               resort_pct=100.0, residential_state="NORMAL", residential_pct=100.0,
               hospital_pct=100.0, filtered=20.0, trajectory="STABLE",
               severity="STABLE", action="NONE"):
    """Build a synthetic recorded trace (like run_scenario_for_controller output)."""
    trace = []
    for i in range(ticks):
        trace.append({
            "tick": i,
            "batteryPct": battery,
            "netPowerKw": filtered,
            "filteredNetPowerKw": filtered,
            "velocityKwS": 0.0,
            "accelerationKwS2": 0.0,
            "severity": severity,
            "trajectory": trajectory,
            "action": action,
            "reasonCode": "OK_STABLE",
            "resources": {
                "hospital": {"state": "PROTECTED", "operatingPct": hospital_pct, "currentDemandKw": 40, "maxDemandKw": 40},
                "desalination": {"state": "NORMAL", "operatingPct": desal_pct, "currentDemandKw": 120, "maxDemandKw": 120},
                "residential": {"state": residential_state, "operatingPct": residential_pct,
                                "currentDemandKw": residential_pct / 100.0 * 400, "maxDemandKw": 400},
                "resort": {"state": resort_state, "operatingPct": resort_pct,
                           "currentDemandKw": resort_pct / 100.0 * 250, "maxDemandKw": 250},
            },
        })
    return trace


def parked(resort_pct=100.0, residential_pct=100.0, desal_pct=100.0, **kw):
    return make_trace(
        ticks=10, resort_pct=resort_pct, residential_pct=residential_pct,
        desal_pct=desal_pct, **kw
    )


# ---------------------------------------------------------------------------
# Critical-service uptime
# ---------------------------------------------------------------------------

def test_critical_uptime_full():
    assert em.critical_service_uptime_pct(make_trace(10)) == 100.0


def test_critical_uptime_half_degraded():
    trace = make_trace(10)
    trace[5]["resources"]["hospital"]["operatingPct"] = 90.0
    trace[6]["resources"]["hospital"]["operatingPct"] = 90.0
    # 8 of 10 ticks operational -> 80%.
    assert em.critical_service_uptime_pct(trace) == pytest.approx(80.0)


# ---------------------------------------------------------------------------
# Water availability
# ---------------------------------------------------------------------------

def test_water_availability_average():
    trace = make_trace(10, desal_pct=100.0)
    assert em.water_availability_pct(trace) == 100.0
    trace2 = make_trace(10, desal_pct=60.0)
    assert em.water_availability_pct(trace2) == 60.0


# ---------------------------------------------------------------------------
# Total load shed
# ---------------------------------------------------------------------------

def test_total_load_shed_zero_when_normal():
    trace = parked()
    # residential 400 max & resort 250 max all at 100% -> no shed.
    assert em.total_load_shed_kwh(trace) == 0.0


def test_total_load_shed_kwh_shed_resort():
    # 10 ticks, resort at 0% for 5 ticks (freed 250 kW), rest 100%.
    trace = parked(resort_pct=0.0)
    for i in range(5, 10):
        trace[i]["resources"]["resort"]["operatingPct"] = 100.0
        trace[i]["resources"]["resort"]["currentDemandKw"] = 250.0
    # 5 ticks * 250 kW * (1s / 3600) = 0.3472 kWh.
    assert em.total_load_shed_kwh(trace) == pytest.approx(5 * 250 / 3600.0, abs=0.001)


# ---------------------------------------------------------------------------
# Shedding events
# ---------------------------------------------------------------------------

def test_shedding_events_single_shed_not_per_tick():
    # Resort enters SHED once and stays shed for 10 ticks.
    trace = made_shed_trace()
    assert em.shedding_events(trace) == 1


def made_shed_trace():
    trace = parked(resort_pct=100.0)
    for i in range(1, len(trace)):
        trace[i]["resources"]["resort"]["state"] = "SHED"
        trace[i]["resources"]["resort"]["operatingPct"] = 0.0
        trace[i]["resources"]["resort"]["currentDemandKw"] = 0.0
    return trace


def test_shedding_events_counts_residential_big_reduce():
    trace = parked(residential_pct=100.0)
    for i in range(1, len(trace)):
        trace[i]["resources"]["residential"]["state"] = "REDUCED"
        trace[i]["resources"]["residential"]["operatingPct"] = 80.0
        trace[i]["resources"]["residential"]["currentDemandKw"] = 0.8 * 400
    # 100 -> 80 is a 20pt drop -> counts as one event.
    assert em.shedding_events(trace) == 1


def test_shedding_events_ignores_tiny_reduction():
    trace = parked(residential_pct=100.0)
    for i in range(1, len(trace)):
        trace[i]["resources"]["residential"]["state"] = "REDUCED"
        trace[i]["resources"]["residential"]["operatingPct"] = 98.0
        trace[i]["resources"]["residential"]["currentDemandKw"] = 0.98 * 400
    # 2pt drop < 10pt threshold -> not counted.
    assert em.shedding_events(trace) == 0


# ---------------------------------------------------------------------------
# Recovery time
# ---------------------------------------------------------------------------

def test_recovery_time_ticks():
    # t0 = tick where resort first shed (tick 1). Recovery when all restored.
    trace = parked(resort_pct=0.0)
    trace[1]["resources"]["resort"]["state"] = "SHED"
    trace[1]["resources"]["resort"]["operatingPct"] = 0.0
    # Stable recovery at tick 6.
    for i in range(6, len(trace)):
        trace[i]["resources"]["resort"]["state"] = "NORMAL"
        trace[i]["resources"]["resort"]["operatingPct"] = 100.0
    assert em.recovery_time_ticks(trace) == 5  # tick6 - tick1


def test_recovery_time_not_recovered():
    trace = parked(resort_pct=0.0)
    for i in range(1, len(trace)):
        trace[i]["resources"]["resort"]["state"] = "SHED"
        trace[i]["resources"]["resort"]["operatingPct"] = 0.0
        trace[i]["severity"] = "WARNING"
    # Never recovers: returns total ticks - t0.
    assert em.recovery_time_ticks(trace) == len(trace) - 1


# ---------------------------------------------------------------------------
# Minimum battery
# ---------------------------------------------------------------------------

def test_minimum_battery():
    trace = make_trace(10, battery=74.0)
    trace[4]["batteryPct"] = 22.0
    trace[5]["batteryPct"] = 18.0
    trace[6]["batteryPct"] = 25.0
    assert em.minimum_battery_pct(trace) == 18.0


# ---------------------------------------------------------------------------
# Instability / oscillation
# ---------------------------------------------------------------------------

def test_instability_zero_when_stable():
    trace = parked()
    assert em.energy_balance_instability(trace) == 0.0


def test_instability_counts_state_changes():
    # A single resort shed then restore = 2 state changes.
    trace = parked(resort_pct=100.0)
    trace[1]["resources"]["resort"]["state"] = "SHED"
    trace[1]["resources"]["resort"]["operatingPct"] = 0.0
    trace[9]["resources"]["resort"]["state"] = "NORMAL"
    trace[9]["resources"]["resort"]["operatingPct"] = 100.0
    assert em.energy_balance_instability(trace) >= 2.0


def test_output_oscillation_counts_direction_flips():
    trace = parked(desal_pct=100.0)
    # 100 -> 90 -> 95 -> 80 -> 85 (three direction flips among meaningful deltas).
    vals = [100.0, 90.0, 95.0, 80.0, 85.0, 85.0, 85.0, 85.0, 85.0, 85.0]
    for i, v in enumerate(vals):
        trace[i]["resources"]["desalination"]["operatingPct"] = v
    assert em.resource_output_oscillation(trace, "desalination") == 3


def test_net_power_crossings():
    trace = parked(filtered=-5.0)
    vals = [10.0, -5.0, 10.0, -5.0, 10.0, -5.0, 10.0, -5.0, 10.0, -5.0]
    for i, v in enumerate(vals):
        trace[i]["filteredNetPowerKw"] = v
        trace[i]["netPowerKw"] = v
    assert em.net_power_oscillation(trace) == 9


# ---------------------------------------------------------------------------
# Critical-service interruption
# ---------------------------------------------------------------------------

def test_interruption_flag():
    trace = parked()
    assert em.critical_service_interruption(trace) == (False, 0)
    trace[3]["resources"]["hospital"]["operatingPct"] = 80.0
    assert em.critical_service_interruption(trace) == (True, 1)


# ---------------------------------------------------------------------------
# Prototype Nimbus Score
# ---------------------------------------------------------------------------

def test_score_perfect_is_100():
    result = em.nimbus_score(parked())
    assert result["score"] == pytest.approx(100.0, abs=0.01)
    assert result["interrupted"] is False


def test_score_interruption_floors_to_zero():
    trace = parked()
    trace[4]["resources"]["hospital"]["operatingPct"] = 50.0
    result = em.nimbus_score(trace)
    assert result["score"] == 0.0
    assert result["interrupted"] is True


def test_score_returns_breakdown():
    result = em.nimbus_score(parked())
    assert "breakdown" in result
    assert "criticalUptime" in result["breakdown"]
    assert "metrics" in result
    assert "disclaimer" in result
    assert "scientifically" in result["disclaimer"]


def test_score_penalizes_shedding():
    good = em.nimbus_score(parked())["score"]
    shed_trace = made_shed_trace()
    for i in range(1, len(shed_trace)):
        shed_trace[i]["severity"] = "WARNING"
    bad = em.nimbus_score(shed_trace)["score"]
    assert bad < good


def test_score_degraded_water_is_lower():
    good = em.nimbus_score(parked())["score"]
    bad = em.nimbus_score(parked(desal_pct=40.0))["score"]
    assert bad < good


# ---------------------------------------------------------------------------
# Decision-quality checks
# ---------------------------------------------------------------------------

def test_hospital_never_shed_check():
    assert em.hospital_never_shed(parked())
    trace = parked()
    trace[0]["resources"]["hospital"]["operatingPct"] = 90.0
    assert not em.hospital_never_shed(trace)


def test_resort_shed_before_residential_ok():
    trace = parked(resort_pct=0.0)
    trace[1]["resources"]["resort"]["state"] = "SHED"
    trace[3]["resources"]["residential"]["state"] = "REDUCED"
    trace[3]["resources"]["residential"]["operatingPct"] = 80.0
    ok, resort_at, res_at = em.resort_shed_before_residential(trace)
    assert ok
    assert resort_at == 1 and res_at == 3


def test_resort_shed_before_residential_violated():
    trace = parked()
    trace[1]["resources"]["residential"]["state"] = "REDUCED"
    trace[1]["resources"]["residential"]["operatingPct"] = 80.0
    trace[3]["resources"]["resort"]["state"] = "SHED"
    ok, resort_at, res_at = em.resort_shed_before_residential(trace)
    assert not ok
    assert resort_at == 3 and res_at == 1


def test_desalination_within_band_and_smooth():
    trace = parked(desal_pct=100.0)
    assert em.desalination_within_band(trace)
    assert em.desalination_smooth(trace)
    trace[0]["resources"]["desalination"]["operatingPct"] = 10.0
    assert not em.desalination_within_band(trace)
    trace[0]["resources"]["desalination"]["operatingPct"] = 100.0
    trace[1]["resources"]["desalination"]["operatingPct"] = 0.0
    assert not em.desalination_smooth(trace)


def test_no_rapid_flapping():
    # Rapid shed->normal->shed in 2 ticks -> flapping.
    trace = parked(resort_pct=0.0)
    trace[1]["resources"]["resort"]["state"] = "SHED"
    trace[2]["resources"]["resort"]["state"] = "NORMAL"
    trace[2]["resources"]["resort"]["operatingPct"] = 100.0
    trace[3]["resources"]["resort"]["state"] = "SHED"
    trace[3]["resources"]["resort"]["operatingPct"] = 0.0
    assert not em.no_rapid_flapping(trace)
    # Separated sufficiently -> ok.
    trace2 = parked(resort_pct=0.0)
    trace2[1]["resources"]["resort"]["state"] = "SHED"
    trace2[8]["resources"]["resort"]["state"] = "NORMAL"
    trace2[8]["resources"]["resort"]["operatingPct"] = 100.0
    trace2[9]["resources"]["resort"]["state"] = "SHED"
    trace2[9]["resources"]["resort"]["operatingPct"] = 0.0
    assert em.no_rapid_flapping(trace2)


def test_explanation_quality():
    state = em.make_initial_state()
    decisions = [run_controller(state)]
    report = em.explanation_quality(decisions)
    for name, r in report.items():
        assert r["pass"] == r["total"], name


# ---------------------------------------------------------------------------
# Determinism: identical input -> identical controller output
# ---------------------------------------------------------------------------

def test_controller_deterministic_identical_input():
    states = [em.make_initial_state(controller_mode="nimbus") for _ in range(3)]
    out1 = run_controller(states[0])
    out2 = run_controller(states[1])
    out3 = run_controller(states[2])
    assert out1 == out2 == out3
    assert out1["controllerMode"] == "nimbus"


def test_controller_deterministic_identical_trace():
    gen = [(900.0, 100.0)] * 5 + [(400.0, 100.0)] * 5
    t1 = em.run_scenario_for_controller(
        em.make_initial_state(), gen, None, "nimbus", run_controller
    )
    t2 = em.run_scenario_for_controller(
        em.make_initial_state(), gen, None, "nimbus", run_controller
    )
    assert t1 == t2


# ---------------------------------------------------------------------------
# No fake metric values
# ---------------------------------------------------------------------------

def test_metrics_use_recorded_values_no_fabrication():
    # A trace where battery never changes and everything is normal must yield
    # exactly the expected real numbers (no invented smoothing).
    trace = parked()
    assert em.minimum_battery_pct(trace) == 74.0
    assert em.critical_service_uptime_pct(trace) == 100.0
    assert em.total_load_shed_kwh(trace) == 0.0
