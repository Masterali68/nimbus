"""Mock telemetry for the Nimbus backend foundation.

CLEARLY MOCK DATA. Phase 1 stand-in only: produces realistic-but-fake
stable-island telemetry so the dashboard/API/WebSocket pipes can be built
and tested before Lalith's real simulation and Ali's decision engine exist.
In Phase 2 this module is replaced by the real simulation; the seam is
``state_manager.push(frame)`` with a ``TelemetryFrame``.

Generation is deterministic for a fixed tick time + seed (seeded RNG for
jitter), so tests can assert invariants without flakiness.
"""

from __future__ import annotations

import asyncio
import math
import random
import time

from models import Resources, ResourceState, TelemetryFrame
from state_manager import StateManager

NIMBUS_VERSION = "0.1.0"
TICK_INTERVAL_S = 0.5  # 500 ms telemetry cadence (REST + WebSocket share this)

# Generation configuration
SOLAR_PEAK_KW = 120.0
WIND_BASE_KW = 36.0
WIND_AMP_KW = 18.0
DAY_SECONDS = 86400.0

# Battery configuration
BATTERY_CAPACITY_KWH = 200.0
BATTERY_START_KWH = 130.0

# Demand baselines (kW per resource) - stable island
RESOURCE_BASELINE_KW: dict[str, float] = {
    "hospital": 25.0,
    "desalination": 42.0,
    "residential": 95.0,
    "resort": 38.0,
}
RESOURCE_SHEDABLE: dict[str, bool] = {
    "hospital": False,
    "desalination": False,
    "residential": False,
    "resort": True,
}

# Filter / trajectory configuration
EMA_ALPHA = 0.30
IMPROVING_VELOCITY_KWS = 0.50
DETERIORATING_VELOCITY_KWS = -0.50

# Severity thresholds (battery %, low = more critical)
WATCH_BATTERY_PCT = 45.0
WARNING_BATTERY_PCT = 25.0
CRITICAL_BATTERY_PCT = 10.0

SEED = 42

STABLE_EXPLANATION = (
    "Island conditions are stable. Generation is meeting demand and battery "
    "reserves are healthy."
)


def _solar_kw(now: float, rng: random.Random) -> float:
    raw = SOLAR_PEAK_KW * max(math.sin(2 * math.pi * ((now % DAY_SECONDS) / DAY_SECONDS) - 0.35), 0.0)
    return max(0.0, raw * rng.uniform(0.97, 1.03))


def _wind_kw(now: float, rng: random.Random) -> float:
    base = WIND_BASE_KW + WIND_AMP_KW * math.sin(2 * math.pi * now / 170.0)
    return max(0.0, base + rng.uniform(-3.0, 3.0))


def _resource_demand(now: float) -> dict[str, float]:
    return {
        "hospital": RESOURCE_BASELINE_KW["hospital"],
        "desalination": RESOURCE_BASELINE_KW["desalination"] + 1.5 * math.sin(2 * math.pi * now / 600.0),
        "residential": RESOURCE_BASELINE_KW["residential"] + 4.0 * math.sin(2 * math.pi * now / 90.0),
        "resort": RESOURCE_BASELINE_KW["resort"] + 2.5 * math.sin(2 * math.pi * now / 240.0),
    }


def _build_resources(now: float) -> Resources:
    demands = _resource_demand(now)
    resources: Resources = {}
    for name, demand_kw in demands.items():
        resources[name] = ResourceState(
            name=name,
            demand_kw=max(0.0, demand_kw),
            operating_pct=100.0,
            state="normal",
            shedable=RESOURCE_SHEDABLE[name],
        )
    return resources


def _classify_severity(battery_pct: float) -> str:
    if battery_pct <= CRITICAL_BATTERY_PCT:
        return "critical"
    if battery_pct <= WARNING_BATTERY_PCT:
        return "warning"
    if battery_pct <= WATCH_BATTERY_PCT:
        return "watch"
    return "stable"


def _classify_trajectory(velocity_kw_s: float) -> str:
    if velocity_kw_s <= DETERIORATING_VELOCITY_KWS:
        return "deteriorating"
    if velocity_kw_s >= IMPROVING_VELOCITY_KWS:
        return "improving"
    return "stable"


def generate_frame(
    prev: TelemetryFrame | None,
    now: float,
    dt: float,
    rng: random.Random,
    sequence: int,
) -> TelemetryFrame:
    """Generate one mock telemetry frame.

    ``now`` is an absolute epoch seconds, ``dt`` is the elapsed seconds since
    the previous frame (used for battery integration + velocity/acceleration).
    """
    dt = max(dt, 1e-3)

    solar = _solar_kw(now, rng)
    wind = _wind_kw(now, rng)
    total_generation = solar + wind

    resources = _build_resources(now)
    total_demand = sum(r.demand_kw for r in resources.values())

    net_power = total_generation - total_demand

    # Battery energy integration (same formula the reference simulation used)
    battery = BATTERY_START_KWH if prev is None else prev.battery_kwh
    energy_delta = net_power * dt / 3600.0
    battery_kwh = min(max(battery + energy_delta, 0.0), BATTERY_CAPACITY_KWH)
    battery_pct = battery_kwh / BATTERY_CAPACITY_KWH * 100.0

    # Filtered net power + first/second derivatives (EMA)
    if prev is None:
        filtered_net = net_power
        velocity = 0.0
        acceleration = 0.0
    else:
        filtered_net = prev.filtered_net_power_kw + EMA_ALPHA * (net_power - prev.filtered_net_power_kw)
        velocity = (filtered_net - prev.filtered_net_power_kw) / dt
        acceleration = (velocity - prev.velocity_kw_s) / dt

    severity = _classify_severity(battery_pct)
    trajectory = _classify_trajectory(velocity)

    return TelemetryFrame(
        timestamp_ms=int(now * 1000),
        sequence=sequence,
        controller_mode="reactive",
        active_event=None,
        solar_kw=round(solar, 3),
        wind_kw=round(wind, 3),
        total_generation_kw=round(total_generation, 3),
        battery_kwh=round(battery_kwh, 3),
        battery_capacity_kwh=BATTERY_CAPACITY_KWH,
        battery_pct=round(battery_pct, 3),
        battery_charge_rate_kw=round(max(net_power, 0.0), 3),
        battery_discharge_rate_kw=round(max(-net_power, 0.0), 3),
        total_demand_kw=round(total_demand, 3),
        net_power_kw=round(net_power, 3),
        filtered_net_power_kw=round(filtered_net, 3),
        velocity_kw_s=round(velocity, 3),
        acceleration_kw_s2=round(acceleration, 3),
        severity=severity,
        trajectory=trajectory,
        resources=resources,
        latest_decision=None,
        explanation=STABLE_EXPLANATION,
    )


async def seed_state(state: StateManager) -> None:
    """Seed the state manager with an initial frame so REST endpoints are
    immediately valid even before the first background tick."""
    rng = random.Random(SEED)
    frame = generate_frame(None, time.time(), TICK_INTERVAL_S, rng, state.next_sequence())
    await state.push(frame)


async def telemetry_loop(state: StateManager, interval_s: float = TICK_INTERVAL_S) -> None:
    """Single background producer loop. Runs for the process lifetime; cancelled
    by the FastAPI lifespan on shutdown. There is exactly ONE of these.""" 
    rng = random.Random(SEED)
    prev: TelemetryFrame | None = None
    last_time = time.time()
    while True:
        now = time.time()
        dt = now - last_time
        last_time = now
        frame = generate_frame(prev, now, dt, rng, state.next_sequence())
        await state.push(frame)
        prev = frame
        await asyncio.sleep(interval_s)