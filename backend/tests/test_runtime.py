"""Unit tests for the runtime orchestration layer (single loop, events, reset)."""

from __future__ import annotations

import asyncio

from config import Config
from integrations import MockControllerAdapter, MockSimulationAdapter
from models import TelemetryFrame
from runtime import BackendRuntime, TelemetryLoopError
from state_manager import StateManager


def _make_runtime(timeout_s: float = 0.6) -> BackendRuntime:
    runtime = BackendRuntime(
        Config(),
        StateManager(history_size=200),
        MockSimulationAdapter(),
        MockControllerAdapter(),
    )
    return runtime


def test_start_seeds_frame_and_starts_loop() -> None:
    async def run() -> None:
        runtime = _make_runtime()
        await runtime.start()
        state = runtime.state_manager.get_state()
        assert state is not None
        assert isinstance(state, TelemetryFrame)
        assert state.sequence >= 1
        assert runtime.loop_start_count == 1
        assert runtime.loop_running is True
        await runtime.stop()
        assert runtime.loop_running is False

    asyncio.run(run())


def test_duplicate_start_refused() -> None:
    async def run() -> None:
        runtime = _make_runtime()
        await runtime.start()
        try:
            await runtime.start()
        except TelemetryLoopError as exc:
            assert "already running" in str(exc)
        else:
            raise AssertionError("expected TelemetryLoopError on duplicate start")
        finally:
            await runtime.stop()

    asyncio.run(run())


def test_loop_advances_frames() -> None:
    async def run() -> None:
        runtime = _make_runtime()
        await runtime.start()
        first = runtime.state_manager.get_state()
        await asyncio.sleep(0.5)  # ~2 ticks at 0.2s
        second = runtime.state_manager.get_state()
        assert second is not None and first is not None
        assert second.sequence > first.sequence
        frame = TelemetryFrame.model_validate(second.model_dump(by_alias=True))
        assert frame.sequence == second.sequence
        await runtime.stop()

    asyncio.run(run())


def test_mode_change_persists() -> None:
    async def run() -> None:
        runtime = _make_runtime()
        await runtime.start()
        previous = await runtime.set_controller_mode("nimbus")
        assert previous == "reactive"
        assert runtime.mode == "nimbus"
        await runtime.stop()

    asyncio.run(run())


def test_event_injection_and_health_state() -> None:
    async def run() -> None:
        runtime = _make_runtime()
        await runtime.start()
        await runtime.post_event("storm")
        state = runtime.state_manager.get_state()
        assert state is not None
        assert state.active_event is None or state.active_event == "storm"
        await asyncio.sleep(0.5)
        # Event should be visible in the newest frame within a tick or two.
        newest = runtime.state_manager.get_state()
        assert newest is not None
        assert newest.active_event == "storm"
        await runtime.stop()

    asyncio.run(run())


def test_unknown_event_rejected() -> None:
    async def run() -> None:
        runtime = _make_runtime()
        await runtime.start()
        try:
            await runtime.post_event("meteor")
        except ValueError:
            pass
        else:
            raise AssertionError("expected ValueError for unknown event")
        finally:
            await runtime.stop()

    asyncio.run(run())


def test_reset_clears_history_keeps_mode() -> None:
    async def run() -> None:
        runtime = _make_runtime()
        await runtime.start()
        await runtime.post_event("storm")
        await asyncio.sleep(0.5)
        assert len(runtime.state_manager.get_history()) >= 1
        assert runtime.mode == "reactive"
        await runtime.set_controller_mode("nimbus")
        await runtime.reset()
        assert len(runtime.state_manager.get_history()) == 0
        assert runtime.state_manager.get_state() is None
        assert runtime.active_event is None
        assert runtime.mode == "nimbus"  # mode preserved across reset
        assert runtime.episode >= 2
        await runtime.stop()

    asyncio.run(run())


def test_reset_then_loop_resumes() -> None:
    async def run() -> None:
        runtime = _make_runtime()
        await runtime.start()
        await runtime.reset()
        await asyncio.sleep(0.5)
        frame = runtime.state_manager.get_state()
        assert frame is not None
        assert frame.sequence >= 1
        await runtime.stop()

    asyncio.run(run())


def test_control_action_while_loop_down_503_style_error() -> None:
    async def run() -> None:
        runtime = _make_runtime()
        # never started: loop down
        try:
            await runtime.post_event("storm")
        except TelemetryLoopError as exc:
            assert "not running" in str(exc)
        else:
            raise AssertionError("expected TelemetryLoopError when loop is down")

    asyncio.run(run())


def test_unknown_controller_backend_rejected_by_config() -> None:
    try:
        Config(controller_backend="wat")
    except ValueError:
        return
    raise AssertionError("expected ValueError for unknown controller backend")