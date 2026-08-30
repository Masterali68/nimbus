"""Deterministic scenario generation for the Nimbus evaluation subsystem.

Lalith owns scenario generation, seeds and randomized scenarios. His real
Python module is not yet present in this branch; this module defines the
*expected* import point and a clearly-labeled local deterministic factory so
Phase 3 can run and be tested before his code lands.

No framework here: the factory just yields ordered, deterministic
``ScenarioConfig`` objects. Each scenario's seed is derived deterministically
from a base seed + index, so re-runs are reproducible and each controller on
the same scenario index receives the identical config.
"""

from __future__ import annotations

import logging

from config import ALLOWED_EVENTS
from evaluation_models import ScenarioConfig

logger = logging.getLogger("nimbus.evaluation.scenarios")

# Lalith's expected scenario-generation module. It is imported lazily so the
# backend still boots without it; when present it must expose
# ``generate_scenarios(count, base_seed, selected_events=None) -> list[ScenarioConfig]``
# (see REQUIRED_FUNCTIONS below).
LAILITH_SCENARIO_MODULE = "island_sim"


class ScenarioGeneratorError(RuntimeError):
    """Raised when a real scenario generator is requested but unavailable."""


REQUIRED_FUNCTIONS = ("generate_scenarios",)


def scenario_module_available() -> bool:
    """True if Lalith's scenario module is importable on this machine."""
    try:
        __import__(LAILITH_SCENARIO_MODULE)
        return True
    except ImportError:
        return False


def _load_scenario_module():
    """Import Lalith's module or raise a clear integration error."""
    try:
        module = __import__(LAILITH_SCENARIO_MODULE)
    except ImportError as exc:  # pragma: no cover - depends on teammate code
        raise ScenarioGeneratorError(
            f"Lalith's scenario generator (module `{LAILITH_SCENARIO_MODULE}`) is not "
            f"available in this branch. Add it, or run evaluation with the local "
            f"fallback pipeline (require_real=False), which uses clearly-labeled "
            f"deterministic scenarios."
        ) from exc
    missing = [fn for fn in REQUIRED_FUNCTIONS if not hasattr(module, fn)]
    if missing:
        raise ScenarioGeneratorError(
            f"`{LAILITH_SCENARIO_MODULE}` is missing required functions: "
            f"{missing!r}. Expected {REQUIRED_FUNCTIONS!r}."
        )
    return module


# --------------------------------------------------------------------------- #
# Local deterministic fallback (clearly labeled, used until Lalith's module lands)
# --------------------------------------------------------------------------- #
# Ticks per scenario for the labeled fallback. Kept modest so a multi-scenario
# run completes quickly; real evaluations can raise this via ScenarioConfig.
LOCAL_SCENARIO_MAX_TICKS = 600


def _default_scenario_config(seed: int, event_type: str | None) -> ScenarioConfig:
    return ScenarioConfig(
        seed=seed, event_type=event_type, max_ticks=LOCAL_SCENARIO_MAX_TICKS
    )


def generate_local_scenarios(
    count: int,
    base_seed: int,
    selected_events: list[str] | None = None,
    options: dict | None = None,
) -> list[ScenarioConfig]:
    """Deterministic fallback scenarios: one per index, cycling event types.

    The event type cycles through the allowed disturbances so the same
    controller types are exercised across weather/demand events, but the seed
    (which drives solar/wind/baseline in the mock sim) is unique per scenario.
    ``options`` may carry ``max_ticks`` / ``timestep_s`` / ``duration_ticks``
    overrides applied to every scenario (used for fast test runs).
    """
    options = options or {}
    max_ticks = options.get("max_ticks") or options.get("maxTicks")
    timestep_s = options.get("timestep_s") or options.get("timestepS")
    duration_ticks = options.get("duration_ticks") or options.get("durationTicks")
    events = selected_events or list(ALLOWED_EVENTS)
    out: list[ScenarioConfig] = []
    for i in range(count):
        seed = base_seed + i
        event_type = events[i % len(events)] if events else None
        cfg = _default_scenario_config(seed, event_type)
        if max_ticks is not None:
            cfg.max_ticks = int(max_ticks)
        if timestep_s is not None:
            cfg.timestep_s = float(timestep_s)
        if duration_ticks is not None:
            cfg.duration_ticks = int(duration_ticks)
        out.append(cfg)
    return out


# --------------------------------------------------------------------------- #
# Unified entry point
# --------------------------------------------------------------------------- #
def build_scenarios(
    count: int,
    base_seed: int,
    selected_events: list[str] | None = None,
    use_real: bool = False,
) -> list[ScenarioConfig]:
    """Return the scenario list for an evaluation.

    When ``use_real`` and Lalith's module is available, delegate to it.
    Otherwise raise a clear integration error (so nobody silently falls back
    when the caller explicitly requested the real generator); when ``use_real``
    is False, use the local deterministic fallback and log it.
    """
    if use_real:
        module = _load_scenario_module()
        scenarios = module.generate_scenarios(count, base_seed, selected_events)
        result = []
        for i, sc in enumerate(scenarios):
            if isinstance(sc, ScenarioConfig):
                result.append(sc)
            elif isinstance(sc, dict):
                result.append(ScenarioConfig.model_validate(sc))
            else:
                # Duck-type: accept any object with the same fields.
                fields = {f: getattr(sc, f) for f in ScenarioConfig.model_fields if hasattr(sc, f)}
                result.append(ScenarioConfig(**fields))
        logger.info("using Lalith's scenario generator (%d scenarios)", count)
        return result
    logger.info("using labeled local scenario fallback (Lalith module not enabled)")
    return generate_local_scenarios(count, base_seed, selected_events)


def validate_selected_events(event_types: list[str] | None) -> None:
    """Raise ValueError on any unknown event type."""
    if not event_types:
        return
    for event in event_types:
        if event not in ALLOWED_EVENTS:
            raise ValueError(
                f"unknown eventType {event!r}; allowed: {sorted(ALLOWED_EVENTS)}"
            )
