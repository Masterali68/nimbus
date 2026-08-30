"""Real-time orchestration layer for the Nimbus backend.

This is the Phase 2 heart: a single background loop that drives the island
simulation, feeds island state to the active decision engine, and publishes
the resulting telemetry frames to REST readers + WebSocket subscribers.

Producers/consumers never touch adapters directly:

    SIGNAL CHAIN (once per tick, serialized on the loop):
        simulation.get_state(sim)              -- read island snapshot
        -> controller.decide(mode, snapshot)   -- decision engine output
        -> simulation.tick(sim, dt, controls)  -- apply control levels
        -> simulation.get_state(sim)           -- post-control snapshot
        -> build TelemetryFrame
        -> state_manager.push()                -- single source of truth
        -> broadcast to WS clients             -- outside the compute lock

Exactly ONE loop per process. ``start()`` refuses a second loop. A per-tick
controller/simulation error is recorded as ``last_error`` and the loop keeps
running with the previous healthy state rather than killing the backend.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections import deque
from typing import Any

from config import ALLOWED_EVENTS, Config
from integrations.controller import ControllerAdapter
from integrations.simulation import SimulationAdapter
from models import (
    ControllerMode,
    RESOURCE_NAMES,
    ResourceState,
    TelemetryFrame,
)
from state_manager import StateManager

logger = logging.getLogger("nimbus.runtime")


class TelemetryLoopError(RuntimeError):
    """Duplicate loop start, or a control action attempted while the loop is down."""


class BackendRuntime:
    """Owns adapters, controller mode, event state and the single sim loop."""

    def __init__(
        self,
        config: Config,
        state_manager: StateManager,
        simulation: SimulationAdapter,
        controller: ControllerAdapter,
    ) -> None:
        self.config = config
        self.state_manager = state_manager
        self.simulation = simulation
        self.controller = controller

        self.mode: ControllerMode = config.default_controller_mode
        self._sim_state: Any = None
        self._loop: asyncio.Task | None = None
        self._loop_lock = asyncio.Lock()
        self._loop_start_count = 0
        self._running = False
        self._episode = 0
        self._active_event: str | None = None
        self._last_error: str | None = None
        self._last_tick_ms: int | None = None
        self._started_at = time.monotonic()
        self._prev_tick_mono: float | None = None
        self._last_controller_state: dict | None = None
        self._decision_log: deque[dict] = deque(maxlen=config.decision_log_size)
        self._clients: set[Any] = set()

    # ------------------------------------------------------------------ #
    # Introspection
    # ------------------------------------------------------------------ #
    @property
    def loop_running(self) -> bool:
        return self._running and self._loop is not None and not self._loop.done()

    @property
    def loop_start_count(self) -> int:
        return self._loop_start_count

    @property
    def episode(self) -> int:
        return self._episode

    @property
    def active_event(self) -> str | None:
        return self._active_event

    @property
    def last_error(self) -> str | None:
        return self._last_error

    @property
    def last_tick_ms(self) -> int | None:
        return self._last_tick_ms or self.state_manager.last_tick_ms

    @property
    def uptime_s(self) -> float:
        return time.monotonic() - self._started_at

    @property
    def connected_clients(self) -> int:
        return len(self._clients)

    @staticmethod
    def config_allowed_events() -> tuple[str, ...]:
        return ALLOWED_EVENTS

    def status_dict(self) -> dict:
        return {
            "controller_mode": self.mode,
            "active_event": self.active_event,
            "loop_running": self.loop_running,
            "loop_start_count": self.loop_start_count,
            "episode": self.episode,
            "simulation_backend": self.simulation.name,
            "simulation_real": self.simulation.is_real,
            "controller_backend": self.controller.name,
            "controller_real": self.controller.is_real,
            "decision_log_size_max": self.config.decision_log_size,
            "decision_log_size_cur": len(self._decision_log),
            "connected_clients": self.connected_clients,
            "uptime_s": round(self.uptime_s, 3),
            "last_tick_ms": self.last_tick_ms,
            "last_error": self.last_error,
        }

    # ------------------------------------------------------------------ #
    # WebSocket client bookkeeping
    # ------------------------------------------------------------------ #
    def register_client(self, websocket: Any) -> None:
        self.state_manager.register_client(websocket)
        self._clients.add(websocket)

    def deregister_client(self, websocket: Any) -> None:
        self.state_manager.deregister_client(websocket)
        self._clients.discard(websocket)

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    async def start(self) -> None:
        """Create initial island state and start the single simulation loop."""
        async with self._loop_lock:
            if self._loop is not None and not self._loop.done():
                raise TelemetryLoopError(
                    "simulation loop already running (simulation loop must be unique)"
                )
            self._episode += 1
            self._sim_state = self.simulation.create_initial_state(self.config.seed)
            self._prev_tick_mono = None
            self._last_controller_state = None
            await self._step_once()  # seed a valid frame before serving anything
            self._loop_start_count += 1
            self._running = True
            self._loop = asyncio.create_task(
                self._run_loop(), name="nimbus-sim-loop"
            )

    async def stop(self) -> None:
        async with self._loop_lock:
            loop = self._loop
            self._loop = None
            self._running = False
            if loop is not None:
                loop.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await loop

    # ------------------------------------------------------------------ #
    # Control plane
    # ------------------------------------------------------------------ #
    async def set_controller_mode(self, mode: ControllerMode) -> ControllerMode:
        """Adopt a new controller mode; returns the previous mode."""
        previous = self.mode
        self.mode = mode
        logger.info("controller mode %s -> %s", previous, mode)
        return previous

    async def post_event(self, event_type: str, params: dict | None = None) -> None:
        """Inject an island event. Raises ValueError for unknown event types."""
        self.simulation.validate_event(event_type)
        self._ensure_loop_running()
        self._sim_state = self.simulation.apply_event(self._sim_state, event_type, params)
        self._active_event = self.simulation.get_active_event(self._sim_state)
        logger.info("event injected: %s (active=%s)", event_type, self._active_event)

    async def reset(self) -> None:
        """Restart the island. Controller mode is preserved; event state is cleared."""
        self._ensure_loop_running()
        self._sim_state = self.simulation.reset(self._sim_state)
        await self.state_manager.reset()
        self._episode += 1
        self._active_event = self.simulation.get_active_event(self._sim_state)
        self._decision_log.clear()
        logger.info("island reset (episode %d)", self._episode)

    # ------------------------------------------------------------------ #
    # Simulation loop
    # ------------------------------------------------------------------ #
    def _ensure_loop_running(self) -> None:
        if not self.loop_running:
            raise TelemetryLoopError(
                "simulation loop is not running; start the backend before control actions"
            )

    async def _run_loop(self) -> None:
        tick_interval = self.config.tick_interval_s
        while True:
            started = time.monotonic()
            try:
                await self._step_once()
                self._last_error = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # keep the loop alive, surface the error
                self._last_error = f"{type(exc).__name__}: {exc}"
                logger.exception("tick failed", exc_info=exc)
            elapsed = time.monotonic() - started
            await asyncio.sleep(max(tick_interval - elapsed, 0.005))

    async def _step_once(self) -> None:
        now = time.monotonic()
        dt = (
            self.config.tick_interval_s
            if self._prev_tick_mono is None
            else now - self._prev_tick_mono
        )
        self._prev_tick_mono = now

        island_before = self.simulation.get_state(self._sim_state)
        decision = self.controller.decide(
            self.mode, island_before, self._last_controller_state, dt
        )
        self._last_controller_state = decision.get("controllerState")

        self._sim_state = self.simulation.tick(
            self._sim_state, dt, decision.get("resourceUpdates")
        )
        island_after = self.simulation.get_state(self._sim_state)

        frame = self._build_frame(island_after, decision)
        await self.state_manager.push(frame)
        self._last_tick_ms = frame.timestamp_ms
        self._active_event = island_after.get("activeEvent") or self._active_event
        self._log_decision(frame, decision)
        await self._broadcast(frame)

    def _build_frame(self, snapshot: dict, decision: dict) -> TelemetryFrame:
        resources_raw = snapshot["resources"]
        resources: dict[str, ResourceState] = {}
        for name in RESOURCE_NAMES:
            res = resources_raw[name]
            resources[name] = ResourceState(
                name=name,
                demand_kw=float(res["demandKw"]),
                operating_pct=float(res["operatingPct"]),
                state=str(res.get("state", "normal")),
                shedable=bool(res.get("shedable", False)),
                max_demand_kw=float(res.get("maxDemandKw"))
                if res.get("maxDemandKw") is not None
                else None,
                minimum_operating_pct=float(res.get("minimumOperatingPct"))
                if res.get("minimumOperatingPct") is not None
                else None,
                criticality=float(res.get("criticality"))
                if res.get("criticality") is not None
                else None,
                throttleable=bool(res.get("throttleable", False)),
            )
        solar = float(snapshot["solarKw"])
        wind = float(snapshot["windKw"])
        total_demand = round(
            sum(res.demand_kw for res in resources.values()), 3
        )
        return TelemetryFrame(
            timestamp_ms=int(snapshot["timestampMs"]),
            sequence=self.state_manager.next_sequence(),
            controller_mode=self.mode,
            active_event=self._active_event,
            solar_kw=solar,
            wind_kw=wind,
            total_generation_kw=round(solar + wind, 3),
            battery_kwh=float(snapshot["batteryKwh"]),
            battery_capacity_kwh=float(snapshot["batteryCapacityKwh"]),
            battery_pct=float(snapshot["batteryPct"]),
            battery_charge_rate_kw=float(snapshot["batteryChargeRateKw"]),
            battery_discharge_rate_kw=float(snapshot["batteryDischargeRateKw"]),
            total_demand_kw=total_demand,
            net_power_kw=float(snapshot["netPowerKw"]),
            filtered_net_power_kw=float(snapshot["filteredNetPowerKw"]),
            velocity_kw_s=float(snapshot["velocityKwS"]),
            acceleration_kw_s2=float(snapshot["accelerationKwS2"]),
            severity=decision.get("severity", "stable"),
            trajectory=decision.get("trajectory", "stable"),
            resources=resources,
            latest_decision=decision,
            explanation=decision.get("explanation") or decision.get("expectedOutcome"),
        )

    def _log_decision(self, frame: TelemetryFrame, decision: dict) -> None:
        self._decision_log.append(
            {
                "timestampMs": frame.timestamp_ms,
                "sequence": frame.sequence,
                "controllerMode": frame.controller_mode,
                "severity": decision.get("severity"),
                "trajectory": decision.get("trajectory"),
                "action": decision.get("action"),
                "reasonCode": decision.get("reasonCode"),
            }
        )

    async def _broadcast(self, frame: TelemetryFrame) -> None:
        if not self._clients:
            return
        payload = frame.model_dump(by_alias=True)
        stale: list[Any] = []
        for websocket in list(self._clients):
            try:
                await websocket.send_json(payload)
            except Exception as exc:  # dead socket; drop it
                stale.append(websocket)
                logger.debug("dropping dead WS client: %s", exc)
        for websocket in stale:
            self.deregister_client(websocket)