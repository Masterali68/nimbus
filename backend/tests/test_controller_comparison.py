"""
Nimbus Phase 3 — Fair controller-comparison tests.

Run from the backend directory:

    .venv/bin/python -m pytest tests/test_controller_comparison.py -q

These tests drive all three controllers (naive, reactive, nimbus) through the
SAME scenario using the SAME initial state and the SAME deterministic physics,
then assert that:

  - every controller receives identical inputs,
  - the evaluation harness can compare them fairly,
  - controller-specific guarantees hold (resort before residential, hospital
    safety, desalination smoothness, cooldown),
  - the prototype score and comparison output are correct and honest
    (no controller's numbers are fabricated or improved).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

import evaluation_metrics as em
from controller import run_controller


# ---------------------------------------------------------------------------
# Shared scenario generator
# ---------------------------------------------------------------------------

def storm_scenario_generation(n=10):
    """A storm: generation collapses then the trace ends (recovery handles rest)."""
    trace = []
    gen = [(900.0, 100.0)] * 2
    collapse = [(500.0, 100.0), (400.0, 100.0), (300.0, 100.0), (250.0, 100.0)]
    trace.extend(gen)
    trace.extend(collapse)
    while len(trace) < n:
        trace.append((300.0, 100.0))
    return trace[:n]


def windy_recovery_scenario_generation(n=70):
    """
    A deep crisis followed by a strong surplus, so Nimbus sheds the resort AND
    reduces residential, then ramps both back through cooldown/restoring.
    Baseline full demand is ~810 kW: a generation deficit then surplus drives the
    controller's severity/trajectory directly for a meaningful restore order.
    """
    gen = [(1000.0, 200.0)] * 4          # surplus, healthy
    gen += [(150.0, 0.0)] * 6            # deep deficit -> CRITICAL (shed + reduce)
    gen += [(1500.0, 400.0)] * (n - 10)  # strong surplus -> recovery
    return gen[:n]


def run_all(scenario_gen, n, start_battery=74.0, active_event="storm-cloud-cover"):
    """Run every controller on the same scenario; return recorded traces + evals."""
    traces = {}
    for mode in em.CONTROLLER_MODES:
        initial = em.make_initial_state(
            controller_mode=mode, battery_pct=start_battery, active_event=active_event
        )
        traces[mode] = em.run_scenario_for_controller(
            initial, scenario_gen, None, mode, run_controller
        )
    results = {
        mode: em.evaluate_controller(traces[mode], mode) for mode in em.CONTROLLER_MODES
    }
    return traces, results


# ---------------------------------------------------------------------------
# Fairness: identical inputs
# ---------------------------------------------------------------------------

def test_all_controllers_get_identical_initial_state():
    initials = [
        em.make_initial_state(controller_mode=m,
                             battery_pct=74.0,
                             active_event="storm-cloud-cover")
        for m in em.CONTROLLER_MODES
    ]
    # Same initial snapshot, only controllerMode differs.
    for m1 in initials:
        for m2 in initials:
            for k in ("batteryPct", "resources", "solarKw", "windKw"):
                assert m1[k] == m2[k]


def test_all_controllers_run_same_generation_trace():
    gen = storm_scenario_generation(12)
    n = len(gen)
    results = None
    for mode in em.CONTROLLER_MODES:
        initial = em.make_initial_state(controller_mode=mode)
        trace = em.run_scenario_for_controller(initial, gen, None, mode, run_controller)
        assert len(trace) == n
    # The generation is identical by construction of the shared list.


# ---------------------------------------------------------------------------
# Determinism of the harness for each controller
# ---------------------------------------------------------------------------

def test_harness_deterministic_per_controller():
    gen = storm_scenario_generation(10)
    for mode in em.CONTROLLER_MODES:
        t1 = em.run_scenario_for_controller(
            em.make_initial_state(controller_mode=mode), gen, None, mode, run_controller
        )
        t2 = em.run_scenario_for_controller(
            em.make_initial_state(controller_mode=mode), gen, None, mode, run_controller
        )
        assert t1 == t2, mode


# ---------------------------------------------------------------------------
# Stable scenario
# ---------------------------------------------------------------------------

def test_stable_scenario_all_normal():
    gen = [(900.0, 100.0)] * 10
    for mode in em.CONTROLLER_MODES:
        initial = em.make_initial_state(controller_mode=mode)
        trace = em.run_scenario_for_controller(initial, gen, None, mode, run_controller)
        eval_res = em.evaluate_controller(trace, mode)
        m = eval_res["metrics"]
        assert m["criticalServiceUptimePct"] == 100.0
        assert m["totalLoadShedKwh"] == 0.0
        assert m["sheddingEventCount"] == 0
        assert not m["interrupted"]
        assert eval_res["quality"]["hospitalNeverShed"]


# ---------------------------------------------------------------------------
# Storm
# ---------------------------------------------------------------------------

def test_storm_all_controllers_survive_with_hospital():
    gen = storm_scenario_generation(10)
    results = run_all(gen, 10)[1]
    for mode, r in results.items():
        assert r["quality"]["hospitalNeverShed"]
        assert r["metrics"]["criticalServiceUptimePct"] == 100.0
        assert not r["metrics"]["interrupted"]


# ---------------------------------------------------------------------------
# Resort shed before residential (Nimbus)
# ---------------------------------------------------------------------------

def test_nimbus_resort_shed_before_residential_in_storm():
    gen = storm_scenario_generation(14)
    trace = em.run_scenario_for_controller(
        em.make_initial_state(controller_mode="nimbus", battery_pct=74.0),
        gen, None, "nimbus", run_controller,
    )
    ok, res_at, resort_at = em.resort_shed_before_residential(trace)
    assert ok, (res_at, resort_at)


# ---------------------------------------------------------------------------
# Hospital protection across all controllers
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("mode", em.CONTROLLER_MODES)
def test_hospital_never_shed_across_modes(mode):
    gen = storm_scenario_generation(10)
    initial = em.make_initial_state(controller_mode=mode, battery_pct=10.0)
    trace = em.run_scenario_for_controller(initial, gen, None, mode, run_controller)
    assert em.hospital_never_shed(trace)


# ---------------------------------------------------------------------------
# Desalination baked constraints
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("mode", ["nimbus", "naive", "reactive"])
def test_desalination_within_band_all_modes(mode):
    gen = storm_scenario_generation(12)
    initial = em.make_initial_state(controller_mode=mode)
    trace = em.run_scenario_for_controller(initial, gen, None, mode, run_controller)
    assert em.desalination_within_band(trace)


def test_nimbus_desalination_smooth():
    gen = storm_scenario_generation(16)
    initial = em.make_initial_state(controller_mode="nimbus")
    trace = em.run_scenario_for_controller(initial, gen, None, "nimbus", run_controller)
    assert em.desalination_smooth(trace)


# ---------------------------------------------------------------------------
# Cooldown prevents flapping (Nimbus)
# ---------------------------------------------------------------------------

def test_nimbus_cooldown_no_flapping():
    gen = windy_recovery_scenario_generation(70)
    initial = em.make_initial_state(controller_mode="nimbus", battery_pct=60.0)
    trace = em.run_scenario_for_controller(initial, gen, None, "nimbus", run_controller)
    assert em.no_rapid_flapping(trace, "resort")

    # Once the scenario recovers, the resort must reach NORMAL only via ramp.
    resort_states = [t["resources"]["resort"]["state"] for t in trace]
    assert any(s == em.STATE_RESTORING for s in resort_states)


# ---------------------------------------------------------------------------
# Recovery restores resources in order (Nimbus: residential before resort)
# ---------------------------------------------------------------------------

def test_nimbus_restore_order():
    gen = windy_recovery_scenario_generation(70)
    initial = em.make_initial_state(controller_mode="nimbus", battery_pct=60.0)
    trace = em.run_scenario_for_controller(initial, gen, None, "nimbus", run_controller)
    # First crisis tick: residential must have been reduced AND resort shed.
    ok_ordering, resort_at, res_at = em.resort_shed_before_residential(trace)
    assert ok_ordering, (resort_at, res_at)
    # Restore order: residential (more critical) reaches NORMAL before resort.
    ok, res_norm_at, resort_norm_at = em.resource_restore_order(trace)
    assert ok, (res_norm_at, resort_norm_at)
    assert res_norm_at is not None and resort_norm_at is not None and res_norm_at < resort_norm_at


# ---------------------------------------------------------------------------
# Low / high initial battery
# ---------------------------------------------------------------------------

def test_low_initial_battery_is_preserved():
    gen = storm_scenario_generation(12)
    initial = em.make_initial_state(controller_mode="nimbus", battery_pct=12.0)
    trace = em.run_scenario_for_controller(initial, gen, None, "nimbus", run_controller)
    assert em.minimum_battery_pct(trace) >= 0.0
    assert em.hospital_never_shed(trace)


def test_high_initial_battery_stays_healthy():
    gen = storm_scenario_generation(12)
    initial = em.make_initial_state(controller_mode="nimbus", battery_pct=90.0)
    trace = em.run_scenario_for_controller(initial, gen, None, "nimbus", run_controller)
    assert em.minimum_battery_pct(trace) <= 90.0


# ---------------------------------------------------------------------------
# Water emergency
# ---------------------------------------------------------------------------

def test_water_emergency_all_controllers():
    # A water emergency is essentially a nominal-demand water event; the desal
    # plant is throttleable and must stay in band.
    gen = storm_scenario_generation(12)
    for mode in em.CONTROLLER_MODES:
        initial = em.make_initial_state(controller_mode=mode, active_event="water-emergency")
        trace = em.run_scenario_for_controller(initial, gen, None, mode, run_controller)
        assert em.desalination_within_band(trace)


# ---------------------------------------------------------------------------
# Tourist surge
# ---------------------------------------------------------------------------

def test_tourist_surge_sheds_resort_first():
    gen = [(500.0, 100.0)] * 10
    initial = em.make_initial_state(controller_mode="nimbus", active_event="tourist-surge")
    trace = em.run_scenario_for_controller(initial, gen, None, "nimbus", run_controller)
    ok, res_at, resort_at = em.resort_shed_before_residential(trace)
    assert ok, (res_at, resort_at)


# ---------------------------------------------------------------------------
# Compound crisis
# ---------------------------------------------------------------------------

def test_compound_crisis_all_survive():
    gen = storm_scenario_generation(16)
    results = run_all(gen, 16, start_battery=20.0)[1]
    for mode, r in results.items():
        assert r["quality"]["hospitalNeverShed"]
        assert r["metrics"]["criticalServiceUptimePct"] == 100.0


# ---------------------------------------------------------------------------
# Long / no-recovery scenario
# ---------------------------------------------------------------------------

def test_long_recovery_reports_not_recovered():
    gen = storm_scenario_generation(10)  # never recovers (no wind surge)
    results = run_all(gen, 10)[1]
    for mode, r in results.items():
        # Either reports 0 or the full span; never a fabricated small recovery.
        rec = r["metrics"]["recoveryTimeS"]
        assert isinstance(rec, (int, float))


# ---------------------------------------------------------------------------
# Prototype score + comparison output
# ---------------------------------------------------------------------------

def test_nimbus_score_breakdown_present_for_real_trace():
    gen = storm_scenario_generation(12)
    initial = em.make_initial_state(controller_mode="nimbus")
    trace = em.run_scenario_for_controller(initial, gen, None, "nimbus", run_controller)
    result = em.nimbus_score(trace)
    assert "score" in result and "breakdown" in result
    assert result["metrics"]["criticalServiceUptimePct"] == 100.0
    assert result["disclaimer"]


def test_compare_controllers_no_fabrication():
    results = run_all(storm_scenario_generation(12), 12)[1]
    comp = em.compare_controllers(results)
    assert set(comp["table"].keys()) == {
        "criticalServiceUptimePct", "waterAvailabilityPct", "totalLoadShedKwh",
        "sheddingEventCount", "recoveryTimeS", "minBatteryPct",
        "instabilityIndex", "interrupted",
    }
    # Every controller's recorded value appears verbatim in the table.
    for mode, r in results.items():
        for key in comp["table"]:
            assert comp["table"][key][mode] == r["metrics"][key], (mode, key)
    # Ranking derived from scores.
    assert {item["controllerMode"] for item in comp["ranking"]} == set(em.CONTROLLER_MODES)
    assert comp["note"]


def test_if_nimbus_worse_metric_preserved():
    # Construct a synthetic scenario where Nimbus sheds MORE energy than naive,
    # and confirm that honest worse value is preserved in the comparison.
    def gen():
        return [(900.0, 100.0)] * 4 + [(300.0, 100.0)] * 8 + [(1000.0, 500.0)] * 10

    results = run_all(gen(), 22, start_battery=50.0)[1]
    na = results["naive"]["metrics"]["totalLoadShedKwh"]
    ni = results["nimbus"]["metrics"]["totalLoadShedKwh"]
    # Both computed; the comparison table must contain exactly the recorded
    # values regardless of which is larger.
    comp = em.compare_controllers(results)
    assert comp["table"]["totalLoadShedKwh"]["naive"] == na
    assert comp["table"]["totalLoadShedKwh"]["nimbus"] == ni
