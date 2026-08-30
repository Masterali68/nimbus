"""Runtime configuration for the Nimbus backend.

Single tunable place for the Phase 2 real-time integration layer. Everything
the runtime loop, adapters and API surface need is read from here so tuning
(and demo playback) is one-file and deterministic.

Environment overrides (all optional):

    NIMBUS_TICK_INTERVAL_S     loop tick interval in seconds (default 0.2 -> 200 ms)
    NIMBUS_HISTORY_SIZE        bounded telemetry history length (default 500)
    NIMBUS_DECISION_LOG_SIZE   bounded decision log length (default 1000)
    NIMBUS_SEED                simulation seed for deterministic live runs (default 42)
    NIMBUS_SIMULATION_BACKEND  "mock" (default) or "lalith" real sim when it lands
    NIMBUS_CONTROLLER_BACKEND  "mock" (default) or "nimbus" Ali's engine when it lands
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

NIMBUS_VERSION = "0.2.0"

DEFAULT_TICK_INTERVAL_S = 0.2  # required band: 100–250 ms
MIN_TICK_INTERVAL_S = 0.1
MAX_TICK_INTERVAL_S = 0.25
DEFAULT_HISTORY_SIZE = 500
DEFAULT_DECISION_LOG_SIZE = 1000
DEFAULT_SEED = 42

ALLOWED_EVENTS: tuple[str, ...] = (
    "storm",
    "cloud_cover",
    "wind_drop",
    "tourist_surge",
    "water_emergency",
    "compound_crisis",
)

ALLOWED_CONTROLLERS: tuple[str, ...] = ("naive", "reactive", "nimbus")
DEFAULT_CONTROLLER_MODE = "reactive"

DEFAULT_CORS_ORIGINS: list[str] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


@dataclass(frozen=True)
class Config:
    tick_interval_s: float = DEFAULT_TICK_INTERVAL_S
    history_size: int = DEFAULT_HISTORY_SIZE
    decision_log_size: int = DEFAULT_DECISION_LOG_SIZE
    seed: int = DEFAULT_SEED
    cors_origins: list[str] = field(default_factory=lambda: list(DEFAULT_CORS_ORIGINS))
    simulation_backend: str = "mock"
    controller_backend: str = "mock"
    default_controller_mode: str = DEFAULT_CONTROLLER_MODE
    version: str = NIMBUS_VERSION

    def __post_init__(self):
        if self.tick_interval_s <= 0:
            raise ValueError("tick_interval_s must be > 0")
        if self.history_size < 1:
            raise ValueError("history_size must be >= 1")
        if self.simulation_backend not in ("mock", "lalith"):
            raise ValueError(f"unknown simulation_backend: {self.simulation_backend!r}")
        if self.controller_backend not in ("mock", "nimbus"):
            raise ValueError(f"unknown controller_backend: {self.controller_backend!r}")
        if self.default_controller_mode not in ALLOWED_CONTROLLERS:
            raise ValueError(
                f"default_controller_mode must be one of {ALLOWED_CONTROLLERS!r}"
            )


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return float(raw)


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return int(raw)


def _env_str(name: str, default: str) -> str:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw


def load_config() -> Config:
    """Build a Config from environment variables (all optional)."""
    return Config(
        tick_interval_s=_env_float(
            "NIMBUS_TICK_INTERVAL_S", DEFAULT_TICK_INTERVAL_S
        ),
        history_size=_env_int("NIMBUS_HISTORY_SIZE", DEFAULT_HISTORY_SIZE),
        decision_log_size=_env_int(
            "NIMBUS_DECISION_LOG_SIZE", DEFAULT_DECISION_LOG_SIZE
        ),
        seed=_env_int("NIMBUS_SEED", DEFAULT_SEED),
        simulation_backend=_env_str("NIMBUS_SIMULATION_BACKEND", "mock"),
        controller_backend=_env_str("NIMBUS_CONTROLLER_BACKEND", "mock"),
    )