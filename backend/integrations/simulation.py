"""Simulation adapter seam + TEMPORARY mock implementation.

Interface (the seam the runtime loop calls):

    create_initial_state(seed: int) -> state
    reset(state) -> state
    get_state(state) -> dict            # flat camelCase island snapshot
    tick(state, dt_seconds, control_updates) -> state
    apply_event(state, event_type, params) -> state
    get_active_event(state) -> str | None
    validate_event(event_type) -> None

Lalith's real simulation is expected to provide a module exposing the same
surface (see LalithSimulationAdapter for the exact import point). Until that
module exists in this branch, MockSimulationAdapter supplies deterministic,
realistic-but-fake physics so the backend pipeline can be tested end-to-end.
The mock makes no claim to model the real island and is clearly labeled.
"""

from __future__ import annotations

import random
from abc import ABC, abstractmethod
from typing import Any

from config import ALLOWED_EVENTS
from telemetry import (
    BATTERY_CAPACITY_KWH,
    BATTERY_START_KWH,
    EMA_ALPHA,
    RESOURCE_BASELINE_KW,
    RESOURCE_SHEDABLE,
    SEED,
    _classify_severity,
    _classify_trajectory,
    _resource_demand,
    _solar_kw,
    _wind_kw,
)


class SimulationAdapterError(RuntimeError):
    """Raised when a real simulation backend is requested but unavailable."""


RESOURCE_CRITICALITY: dict[str, float] = {
    "hospital": 100.0,
    "desalination": 90.0,
    "residential": 70.0,
    "resort": 20.0,
}
RESOURCE_THROTTLEABLE: dict[str, bool] = {
    "hospital": False,
    "desalination": True,
    "residential": False,
    "resort": False,
}


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _round1(value: float) -> float:
    return round(value, 1)


def _round3(value: float) -> float:
    return round(value, 3)


# --------------------------------------------------------------------------- #
# Abstract adapter
# --------------------------------------------------------------------------- #
class SimulationAdapter(ABC):
    """Interface the runtime loop uses to talk to the island simulation."""

    name: str = "abstract"
    is_real: bool = False

    @abstractmethod
    def create_initial_state(self, seed: int) -> Any:
        raise NotImplementedError

    @abstractmethod
    def reset(self, state: Any) -> Any:
        raise NotImplementedError

    @abstractmethod
    def get_state(self, state: Any) -> dict:
        raise NotImplementedError

    @abstractmethod
    def tick(
        self, state: Any, dt_seconds: float, control_updates: dict | None
    ) -> Any:
        raise NotImplementedError

    @abstractmethod
    def apply_event(
        self, state: Any, event_type: str, params: dict | None
    ) -> Any:
        raise NotImplementedError

    @abstractmethod
    def get_active_event(self, state: Any) -> str | None:
        raise NotImplementedError

    def validate_event(self, event_type: str) -> None:
        if event_type not in ALLOWED_EVENTS:
            raise ValueError(f"unknown eventType {event_type!r}; allowed: {ALLOWED_EVENTS}")


# --------------------------------------------------------------------------- #
# TEMPORARY MOCK (clearly labeled, local testing only)
# --------------------------------------------------------------------------- #
# One tick = one simulated second of island time. dt is received in real
# seconds and used for battery integration + EMA derivatives, which keeps the
# values in the right units regardless of the loop's wall-clock cadence.
_TICK_DEFAULT_S = 0.2

# Event effects: multiplicative factors per resource channel + duration ticks.
EVENT_EFFECTS: dict[str, dict[str, float]] = {
    "storm": {"solar": 0.20, "wind": 0.40, "resort": 1.0, "residential": 1.0, "desal": 1.0, "ticks": 80},
    "cloud_cover": {"solar": 0.30, "wind": 1.0, "resort": 1.0, "residential": 1.0, "desal": 1.0, "ticks": 120},
    "wind_drop": {"solar": 1.0, "wind": 0.25, "resort": 1.0, "residential": 1.0, "desal": 1.0, "ticks": 100},
    "tourist_surge": {"solar": 1.0, "wind": 1.0, "resort": 1.6, "residential": 1.15, "desal": 1.0, "ticks": 90},
    "water_emergency": {"solar": 1.0, "wind": 1.0, "resort": 1.0, "residential": 1.0, "desal": 1.45, "ticks": 90},
    "compound_crisis": {"solar": 0.15, "wind": 0.35, "resort": 1.6, "residential": 1.1, "desal": 1.0, "ticks": 120},
}


def _new_state(seed: int) -> dict:
    # Start the island just after dawn (solar ~peak) so the initial snapshots
    # carry meaningful generation numbers, not 0 kW from a midnight start.
    now = 1_700_000_000.0 + 26_412.0
    return {
        "seed": seed,
        "now": now,
        "tick": 0,
        "rng": random.Random(seed),
        "event": None,
        "resources": {
            name: {
                "maxDemandKw": RESOURCE_BASELINE_KW[name],
                "operatingPct": 100.0,
                "state": "normal",
                "shedable": RESOURCE_SHEDABLE[name],
                "throttleable": RESOURCE_THROTTLEABLE[name],
                "minimumOperatingPct": 0.0 if name == "resort" else 30.0 if name == "desalination" else 100.0,
                "criticality": RESOURCE_CRITICALITY[name],
            }
            for name in RESOURCE_BASELINE_KW
        },
        "prev": {"battery_kwh": BATTERY_START_KWH, "filtered": 0.0, "velocity": 0.0, "accel": 0.0},
        "solarKw": 0.0,
        "windKw": 0.0,
        "baselineDemandKw": {},
    }


def _apply_control_updates(state: dict, control_updates: dict | None) -> None:
    if not control_updates:
        return
    for name, update in control_updates.items():
        if name not in state["resources"]:
            continue
        res = state["resources"][name]
        pct = float(update.get("operatingPct", res["operatingPct"]))
        res["operatingPct"] = _round1(_clamp(pct, 0.0, 100.0))
        new_state = str(update.get("state", res["state"]))
        if name == "hospital":
            # Hospital is sacred: any attempt to run it below max is refused.
            res["operatingPct"] = 100.0
            if pct < 100.0 or new_state in {"shed", "reduced", "cooldown"}:
                res["state"] = "protected"
            else:
                res["state"] = new_state
        else:
            res["state"] = new_state


def _event_multipliers(state: dict) -> tuple[dict[str, float], bool]:
    """Return (multiplier_map, event_active)."""
    ev = state["event"]
    if ev is None:
        return {"solar": 1.0, "wind": 1.0, "resort": 1.0, "residential": 1.0, "desal": 1.0}, False
    fx = EVENT_EFFECTS[ev["type"]]
    return dict(fx), True


class MockSimulationAdapter(SimulationAdapter):
    """TEMPORARY MOCK simulation. Deterministic given seed + tick/event script.

    Reuses the Phase 1 physics helpers (telemetry.py) and adds event effects
    and controller control-level application on top. Replace with Lalith's real
    simulation through the same interface — nothing in the runtime changes.
    """

    name = "mock"
    is_real = False

    def create_initial_state(self, seed: int = SEED) -> dict:
        state = _new_state(seed)
        return self.tick(state, _TICK_DEFAULT_S, None)

    def reset(self, state: Any) -> dict:
        seed = state["seed"] if isinstance(state, dict) else SEED
        return self.create_initial_state(seed)

    def get_state(self, state: Any) -> dict:
        if not isinstance(state, dict):
            raise SimulationAdapterError("mock simulation state is not a dict")
        resources = {}
        for name, res in state["resources"].items():
            resources[name] = {
                "name": name,
                "demandKw": _round3(
                    res["maxDemandKw"] * res["operatingPct"] / 100.0
                ),
                "maxDemandKw": _round3(res["maxDemandKw"]),
                "operatingPct": _round1(res["operatingPct"]),
                "state": res["state"],
                "shedable": res["shedable"],
                "throttleable": res["throttleable"],
                "minimumOperatingPct": res["minimumOperatingPct"],
                "criticality": res["criticality"],
            }
        total_demand = sum(r["demandKw"] for r in resources.values())
        return {
            "timestampMs": int(state["now"] * 1000),
            "tick": state["tick"],
            "activeEvent": self.get_active_event(state),
            "solarKw": _round3(state["solarKw"]),
            "windKw": _round3(state["windKw"]),
            "totalGenerationKw": _round3(state["solarKw"] + state["windKw"]),
            "batteryKwh": _round3(state["prev"]["battery_kwh"]),
            "batteryCapacityKwh": BATTERY_CAPACITY_KWH,
            "batteryPct": _round1(state["prev"]["battery_kwh"] / BATTERY_CAPACITY_KWH * 100.0),
            "batteryChargeRateKw": _round3(max(state["netPowerKw"], 0.0)),
            "batteryDischargeRateKw": _round3(max(-state["netPowerKw"], 0.0)),
            "totalDemandKw": _round3(total_demand),
            "netPowerKw": _round3(state["netPowerKw"]),
            "filteredNetPowerKw": _round3(state["prev"]["filtered"]),
            "velocityKwS": _round3(state["prev"]["velocity"]),
            "accelerationKwS2": _round3(state["prev"]["accel"]),
            "severity": _classify_severity(state["prev"]["battery_kwh"] / BATTERY_CAPACITY_KWH * 100.0),
            "trajectory": _classify_trajectory(state["prev"]["velocity"]),
            "resources": resources,
        }

    def get_active_event(self, state: Any) -> str | None:
        if not isinstance(state, dict):
            return None
        ev = state["event"]
        return ev["type"] if ev else None

    def tick(
        self, state: Any, dt_seconds: float, control_updates: dict | None
    ) -> dict:
        dt = max(dt_seconds, 1e-3)
        state["now"] += dt
        state["tick"] += 1

        if state["event"] is not None:
            state["event"]["remaining_ticks"] -= 1
            if state["event"]["remaining_ticks"] <= 0:
                state["event"] = None

        mult, _ = _event_multipliers(state)
        rng = state["rng"]

        solar = _solar_kw(state["now"], rng) * mult["solar"]
        wind = _wind_kw(state["now"], rng) * mult["wind"]

        baseline = _resource_demand(state["now"])
        baseline["resort"] *= mult["resort"]
        baseline["residential"] *= mult["residential"]
        baseline["desalination"] *= mult["desal"]

        for name, res in state["resources"].items():
            res["maxDemandKw"] = max(0.0, baseline[name])

        _apply_control_updates(state, control_updates)

        total_demand = sum(
            res["maxDemandKw"] * res["operatingPct"] / 100.0
            for res in state["resources"].values()
        )
        net = solar + wind - total_demand

        prev_b = state["prev"]["battery_kwh"]
        battery = _clamp(prev_b + net * dt / 3600.0, 0.0, BATTERY_CAPACITY_KWH)
        state["prev"]["battery_kwh"] = battery

        prev_filtered = state["prev"]["filtered"]
        prev_velocity = state["prev"]["velocity"]
        filtered = prev_filtered + EMA_ALPHA * (net - prev_filtered)
        velocity = (filtered - prev_filtered) / dt if prev_filtered else 0.0
        acceleration = (velocity - prev_velocity) / dt if prev_velocity else 0.0
        state["prev"]["filtered"] = filtered
        state["prev"]["velocity"] = velocity
        state["prev"]["accel"] = acceleration

        state["solarKw"] = solar
        state["windKw"] = wind
        state["netPowerKw"] = net
        state["baselineDemandKw"] = baseline
        return state

    def apply_event(
        self, state: Any, event_type: str, params: dict | None
    ) -> dict:
        self.validate_event(event_type)
        params = params or {}
        fx = EVENT_EFFECTS[event_type]
        duration = int(fx.get("ticks", 90))
        state["event"] = {"type": event_type, "remaining_ticks": duration}
        return state


# --------------------------------------------------------------------------- #
# Lalith's real simulation import point (not yet present in this branch)
# --------------------------------------------------------------------------- #
class LalithSimulationAdapter(SimulationAdapter):
    """Adapter for Lalith's real Python simulation.

    Expected module: ``backend/island_sim.py`` (module name ``island_sim``),
    imported lazily so the backend still boots without it. Expected surface:

        create_initial_state(seed: int)      -> island_state
        reset_simulation(state)              -> island_state
        tick_simulation(state, dt_seconds, control_updates) -> island_state
        apply_event(state, event_request)    -> island_state
        get_state(state)                     -> dict   (flat camelCase snapshot)

    All control updates arrive as ``{resource_name: {"operatingPct": float,
    "state": str}}``; standalone (persistent) semantics. The simulation must
    guarantee the hospital resource is never reduced below 100%.
    """

    name = "lalith"
    is_real = True

    def __init__(self) -> None:
        self._module = self._import_module()

    def _import_module(self):
        try:
            import island_sim  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - depends on teammate code
            raise SimulationAdapterError(
                "Lalith's simulation (module `island_sim`) is not present in this "
                "branch yet. Set NIMBUS_SIMULATION_BACKEND=mock to run the backend "
                "with the temporary mock adapter until it lands."
            ) from exc
        for required in (
            "create_initial_state",
            "reset_simulation",
            "tick_simulation",
            "apply_event",
            "get_state",
        ):
            if not hasattr(self._module, required):
                raise SimulationAdapterError(
                    f"island_sim is missing required function {required!r}"
                )
        return self._module

    def create_initial_state(self, seed: int) -> Any:
        return self._module.create_initial_state(seed)

    def reset(self, state: Any) -> Any:
        return self._module.reset_simulation(state)

    def get_state(self, state: Any) -> dict:
        return self._module.get_state(state)

    def tick(self, state: Any, dt_seconds: float, control_updates: dict | None) -> Any:
        return self._module.tick_simulation(state, dt_seconds, control_updates)

    def apply_event(self, state: Any, event_type: str, params: dict | None) -> Any:
        return self._module.apply_event(state, {"eventType": event_type, "params": params})

    def get_active_event(self, state: Any) -> str | None:
        snap = self._module.get_state(state)
        return snap.get("activeEvent")


def build_simulation_adapter(config) -> SimulationAdapter:
    backend = getattr(config, "simulation_backend", "mock").lower()
    if backend == "mock":
        return MockSimulationAdapter()
    if backend == "lalith":
        return LalithSimulationAdapter()
    raise SimulationAdapterError(f"unknown simulation_backend: {backend!r}")