"""Central in-memory state manager for the Nimbus backend.

Single source of truth for:
  - the current mock island telemetry frame
  - bounded telemetry history (prevents unbounded memory growth)
  - the background-telemetry-loop running flag
  - connected WebSocket clients (for observability / health)
  - monotonic frame sequence numbers

No database. No persistence. The mock telemetry loop (and, later,
Lalith's simulation) is the only writer; REST / WebSocket handlers are
readers.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque

from models import TelemetryFrame

DEFAULT_HISTORY_SIZE = 500


class StateManager:
    """In-memory holder of current telemetry + history.

    One process-wide instance lives at module scope (``state_manager``) and is
    the single source of truth for the running app. Tests may construct their
    own instances for isolated unit tests.
    """

    def __init__(self, history_size: int = DEFAULT_HISTORY_SIZE) -> None:
        self._history_size = history_size
        self._lock = asyncio.Lock()
        self._current: TelemetryFrame | None = None
        self._history: deque[TelemetryFrame] = deque(maxlen=history_size)
        self._sequence = 0
        self._started_at = time.monotonic()
        self._running = False
        self._last_tick_ms: int | None = None
        self._connected_clients: set[object] = set()

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    @property
    def started_at(self) -> float:
        return self._started_at

    @property
    def uptime_s(self) -> float:
        return time.monotonic() - self._started_at

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def last_tick_ms(self) -> int | None:
        return self._last_tick_ms

    def mark_running(self, running: bool) -> None:
        self._running = running

    @property
    def connected_clients(self) -> int:
        return len(self._connected_clients)

    def register_client(self, client: object) -> None:
        self._connected_clients.add(client)

    def deregister_client(self, client: object) -> None:
        self._connected_clients.discard(client)

    # ------------------------------------------------------------------ #
    # Frames
    # ------------------------------------------------------------------ #
    def next_sequence(self) -> int:
        self._sequence += 1
        return self._sequence

    async def push(self, frame: TelemetryFrame) -> None:
        """Record a new telemetry frame as current + append to history."""
        async with self._lock:
            self._current = frame
            self._history.append(frame)
            self._last_tick_ms = frame.timestamp_ms

    def get_state(self) -> TelemetryFrame | None:
        return self._current

    def get_history(self, limit: int | None = None) -> list[TelemetryFrame]:
        """Return history newest-first, capped at ``limit`` (default: full)."""
        items = list(self._history)
        items.reverse()
        if limit is not None:
            items = items[:limit]
        return items


# Module-level singleton: one source of truth for the whole process.
state_manager = StateManager()