"""Controller adapter seam + TEMPORARY mock implementation.

Interface the runtime loop calls:

    decide(controller_mode, island_state, previous_controller_state, dt_seconds)
        -> decision dict with keys:
             severity, trajectory, action, reasonCode,
             explanation, expectedOutcome,
             resourceUpdates ({resource: {"operatingPct", "state"}}),
             controllerState (opaque memory for the next tick)

Ali's real decision engine plugs in via AliControllerAdapter (import point
below). Until backend/controller.py exists in this branch, the runtime uses
MockControllerAdapter — a no-op passthrough that holds current resource levels
and is honest about being a placeholder. The mock never fabricates credit for
real control logic.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from models import ControllerMode


class ControllerAdapterError(RuntimeError):
    """Raised when a real controller backend is requested but unavailable."""

    pass


MOCK_CONTROLLER_EXPLANATION = (
    "Temporary mock controller active (no real decision engine connected yet). "
    "Holding current resource levels."
)
MOCK_CONTROLLER_EXPECTED = "No load changes this tick."


def _passthrough_updates(island_state: dict) -> dict:
    resources = island_state.get("resources", {})
    updates = {}
    for name, res in resources.items():
        updates[str(name)] = {
            "operatingPct": float(res.get("operatingPct", 100.0)),
            "state": str(res.get("state", "normal")),
        }
    return updates


class ControllerAdapter(ABC):
    name: str = "abstract"
    is_real: bool = False

    @abstractmethod
    def decide(
        self,
        controller_mode: ControllerMode,
        island_state: dict,
        previous_controller_state: dict | None,
        dt_seconds: float,
    ) -> dict:
        raise NotImplementedError


class MockControllerAdapter(ControllerAdapter):
    """TEMPORARY MOCK controller (local backend testing only). No control logic."""

    name = "mock"
    is_real = False

    def decide(
        self,
        controller_mode: ControllerMode,
        island_state: dict,
        previous_controller_state: dict | None,
        dt_seconds: float,
    ) -> dict:
        return {
            "severity": island_state.get("severity", "stable"),
            "trajectory": island_state.get("trajectory", "stable"),
            "action": "NONE",
            "reasonCode": "MOCK_CONTROLLER",
            "explanation": MOCK_CONTROLLER_EXPLANATION,
            "expectedOutcome": MOCK_CONTROLLER_EXPECTED,
            "resourceUpdates": _passthrough_updates(island_state),
            "controllerState": dict(previous_controller_state or {}),
        }


class AliControllerAdapter(ControllerAdapter):
    """Adapter for Ali's real decision engine.

    Expected module: ``backend/controller.py`` (module name ``controller``),
    imported lazily so the backend still boots without it. Expected entry point:

        run_controller(state: dict, cfg=None) -> dict
            state:  flat camelCase island snapshot with controllerMode embedded
            output: {severity, trajectory, action, reasonCode, explanation,
                     expectedOutcome, resourceUpdates, metrics}

    See docs/contracts/telemetry-contract.md + docs/controller-behavior.md
    (feat/nimbus-engine) for the exact shape. The engine is stateless: its
    memory (resource states, cooldowns, write-back metrics) rides inside the
    island state the runtime owns.
    """

    name = "nimbus"
    is_real = True

    def __init__(self) -> None:
        self._engine = self._import_engine()

    def _import_engine(self):
        try:
            import controller  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - depends on teammate code
            raise ControllerAdapterError(
                "Ali's decision engine (module `controller`) is not present in this "
                "branch yet. Set NIMBUS_CONTROLLER_BACKEND=mock to run the backend "
                "with the temporary mock adapter until it lands."
            ) from exc
        if not hasattr(controller, "run_controller"):
            raise ControllerAdapterError(
                "module `controller` does not expose run_controller(state, cfg=None)"
            )
        return controller

    @staticmethod
    def _lower(value: str | None, fallback: str) -> str:
        if not value:
            return fallback
        return str(value).lower()

    def decide(
        self,
        controller_mode: ControllerMode,
        island_state: dict,
        previous_controller_state: dict | None,
        dt_seconds: float,
    ) -> dict:
        state = dict(island_state)
        state["controllerMode"] = controller_mode
        state.setdefault("tick", island_state.get("tick", 0))
        decision = self._engine.run_controller(state)
        metrics = (decision.get("metrics") or {}).copy() if isinstance(decision, dict) else {}
        resource_updates = {
            str(name): {
                "operatingPct": float(upd.get("operatingPct", 100.0)),
                "state": str(upd.get("state", "normal")).lower(),
            }
            for name, upd in (decision.get("resourceUpdates") or {}).items()
        }
        return {
            "severity": self._lower(decision.get("severity"), island_state.get("severity", "stable")),
            "trajectory": self._lower(decision.get("trajectory"), island_state.get("trajectory", "stable")),
            "action": str(decision.get("action") or "NONE").lower(),
            "reasonCode": str(decision.get("reasonCode") or "OK_STABLE"),
            "explanation": str(decision.get("explanation") or ""),
            "expectedOutcome": str(decision.get("expectedOutcome") or ""),
            "resourceUpdates": resource_updates,
            "controllerState": metrics,
        }


def build_controller_adapter(config) -> ControllerAdapter:
    backend = getattr(config, "controller_backend", "mock").lower()
    if backend == "mock":
        return MockControllerAdapter()
    if backend == "nimbus":
        return AliControllerAdapter()
    raise ControllerAdapterError(f"unknown controller_backend: {backend!r}")