"""Unit tests for the mock telemetry generator + state manager invariants."""

from __future__ import annotations

import asyncio
import math
import random

from models import TelemetryFrame
from state_manager import StateManager
from telemetry import BATTERY_CAPACITY_KWH, SEED, generate_frame


def _gen_series(n: int, start_time: float = 1_700_000_000.0, dt: float = 0.5) -> list[TelemetryFrame]:
    rng = random.Random(SEED)
    frames: list[TelemetryFrame] = []
    prev: TelemetryFrame | None = None
    now = start_time
    for i in range(n):
        prev = generate_frame(prev, now, dt, rng, i)
        frames.append(prev)
        now += dt
    return frames


def test_generation_is_deterministic_for_same_seed() -> None:
    a = _gen_series(5)
    b = _gen_series(5)
    assert [f.timestamp_ms for f in a] == [f.timestamp_ms for f in b]
    assert all(x.sequence == y.sequence for x, y in zip(a, b))
    assert [f.solar_kw for f in a] == [f.solar_kw for f in b]


def test_battery_bounds_never_violated() -> None:
    for _ in range(5):
        for frame in _gen_series(50):
            assert 0.0 <= frame.battery_kwh <= BATTERY_CAPACITY_KWH
            assert 0.0 <= frame.battery_pct <= 100.0


def test_resource_invariants() -> None:
    frame = _gen_series(1)[0]
    assert set(frame.resources.keys()) == {"hospital", "desalination", "residential", "resort"}
    for res in frame.resources.values():
        assert res.demand_kw >= 0.0
        assert 0.0 <= res.operating_pct <= 100.0
        assert res.state == "normal"


def test_derived_values_finite() -> None:
    for frame in _gen_series(20):
        for value in (frame.filtered_net_power_kw, frame.velocity_kw_s, frame.acceleration_kw_s2):
            assert math.isfinite(value)


def test_state_manager_push_get_roundtrip() -> None:
    async def run() -> None:
        manager = StateManager(history_size=10)
        frame = _gen_series(1)[0]
        await manager.push(frame)
        assert manager.get_state() is frame
        assert manager.last_tick_ms == frame.timestamp_ms

    asyncio.run(run())


def test_state_manager_history_bounded() -> None:
    async def run() -> None:
        manager = StateManager(history_size=10)
        frames = _gen_series(25)
        for f in frames:
            await manager.push(f)
        history = manager.get_history()
        assert len(history) == 10  # bounded
        assert history[0].sequence == 24  # newest first

    asyncio.run(run())


def test_state_manager_sequence_monotonic() -> None:
    manager = StateManager()
    seen = [manager.next_sequence() for _ in range(5)]
    assert seen == [1, 2, 3, 4, 5]


def test_generate_frame_handles_prev_none() -> None:
    rng = random.Random(SEED)
    frame = generate_frame(None, 1_700_000_000.0, 0.5, rng, 0)
    assert frame.filtered_net_power_kw == frame.net_power_kw
    assert frame.velocity_kw_s == 0.0
    assert frame.acceleration_kw_s2 == 0.0