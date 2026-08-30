"""Unit tests for the adapter seams + mock adapters + factories."""

from __future__ import annotations

from integrations import (
    AliControllerAdapter,
    ControllerAdapterError,
    LalithSimulationAdapter,
    MockControllerAdapter,
    MockSimulationAdapter,
    SimulationAdapterError,
    build_controller_adapter,
    build_simulation_adapter,
)
from config import ALLOWED_EVENTS, Config

CONFIG = Config()


# --------------------------------------------------------------------------- #
# Simulation adapter
# --------------------------------------------------------------------------- #
def test_mock_simulation_factory_default() -> None:
    adapter = build_simulation_adapter(CONFIG)
    assert isinstance(adapter, MockSimulationAdapter)
    assert adapter.is_real is False


def test_mock_simulation_initial_state_has_snapshot() -> None:
    adapter = MockSimulationAdapter()
    state = adapter.create_initial_state(seed=42)
    snap = adapter.get_state(state)
    assert set(snap["resources"].keys()) == {
        "hospital",
        "desalination",
        "residential",
        "resort",
    }
    for name, res in snap["resources"].items():
        assert 0.0 <= res["operatingPct"] <= 100.0
        assert res["maxDemandKw"] > 0.0
    assert 0.0 <= snap["batteryPct"] <= 100.0
    assert snap["activeEvent"] is None


def test_mock_simulation_event_readiness() -> None:
    snap = MockSimulationAdapter().get_state(
        MockSimulationAdapter().create_initial_state(42)
    )
    assert snap["trajectory"] in {"deteriorating", "stable", "improving"}


def test_mock_simulation_apply_and_expire_event() -> None:
    adapter = MockSimulationAdapter()
    state = adapter.create_initial_state(seed=42)
    state = adapter.apply_event(state, "storm", None)
    assert adapter.get_active_event(state) == "storm"
    for _ in range(500):  # expiry well beyond storm's 80 ticks
        state = adapter.tick(state, 0.2, None)
    assert adapter.get_active_event(state) is None


def test_mock_simulation_event_multipliers_move_generation() -> None:
    adapter = MockSimulationAdapter()
    base = adapter.get_state(adapter.create_initial_state(seed=7))
    storm_state = adapter.apply_event(adapter.create_initial_state(seed=7), "storm", None)
    storm_state = adapter.tick(storm_state, 0.2, None)
    storm = adapter.get_state(storm_state)
    # Solar falls sharply during a storm.
    assert storm["solarKw"] < base["solarKw"] * 0.5


def test_mock_simulation_control_reduces_demand() -> None:
    adapter = MockSimulationAdapter()
    state = adapter.create_initial_state(seed=1)
    controls = {"resort": {"operatingPct": 50.0, "state": "reduced"}}
    before = adapter.get_state(state)
    state = adapter.tick(state, 0.2, controls)
    after = adapter.get_state(state)
    assert after["resources"]["resort"]["operatingPct"] == 50.0
    assert after["resources"]["resort"]["demandKw"] < before["resources"]["resort"]["demandKw"]


def test_mock_simulation_hospital_always_protected() -> None:
    adapter = MockSimulationAdapter()
    state = adapter.create_initial_state(seed=1)
    state = adapter.tick(state, 0.2, {"hospital": {"operatingPct": 10.0, "state": "shed"}})
    snap = adapter.get_state(state)
    assert snap["resources"]["hospital"]["operatingPct"] == 100.0


def test_mock_simulation_validate_event_rejects_unknown() -> None:
    adapter = MockSimulationAdapter()
    try:
        adapter.apply_event(adapter.create_initial_state(1), "meteor", None)
    except ValueError:
        return
    raise AssertionError("expected ValueError for unknown event")


def test_lalith_adapter_missing_module_raises_clear_error() -> None:
    """The real adapter is wired but the module is not in this branch yet."""
    try:
        LalithSimulationAdapter()
    except SimulationAdapterError as exc:
        assert "island_sim" in str(exc)
        return
    raise AssertionError("expected SimulationAdapterError")


# --------------------------------------------------------------------------- #
# Controller adapter
# --------------------------------------------------------------------------- #
def test_controller_factory_default() -> None:
    adapter = build_controller_adapter(CONFIG)
    assert isinstance(adapter, MockControllerAdapter)
    assert adapter.is_real is False


def test_mock_controller_passthrough_decision() -> None:
    sim = MockSimulationAdapter()
    snap = sim.get_state(sim.create_initial_state(seed=42))
    controller = MockControllerAdapter()
    decision = controller.decide("reactive", snap, {}, 0.2)
    assert decision["action"] == "NONE"
    assert decision["reasonCode"] == "MOCK_CONTROLLER"
    # Every resource present, at its current operating level.
    assert set(decision["resourceUpdates"].keys()) == set(snap["resources"].keys())
    for name, upd in decision["resourceUpdates"].items():
        assert upd["operatingPct"] == snap["resources"][name]["operatingPct"]


def test_ali_adapter_uses_real_engine_when_present() -> None:
    adapter = AliControllerAdapter()
    assert adapter.is_real is True
    decision = adapter.decide("reactive", {"batteryPct": 80.0, "resources": {}}, {}, 1.0)
    assert isinstance(decision, dict)
    assert "action" in decision and "severity" in decision


def test_ali_adapter_missing_module_raises_clear_error(monkeypatch) -> None:
    import sys

    monkeypatch.setitem(sys.modules, "controller", None)
    try:
        AliControllerAdapter()
    except ControllerAdapterError as exc:
        assert "controller" in str(exc)
        assert "mock" in str(exc)
        return
    raise AssertionError("expected ControllerAdapterError")


# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
def test_allowed_events_stable() -> None:
    assert set(ALLOWED_EVENTS) == {
        "storm",
        "cloud_cover",
        "wind_drop",
        "tourist_surge",
        "water_emergency",
        "compound_crisis",
    }


def test_config_rejects_unknown_backends() -> None:
    try:
        Config(simulation_backend="wat")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for unknown simulation backend")