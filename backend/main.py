"""Nimbus FastAPI backend - Phase 1 foundation.

Runs from backend/ on port 8000:
    uvicorn main:app --reload --port 8000

Provides:
    GET  /health        service health
    GET  /api/state     current mock telemetry
    GET  /api/history   bounded mock telemetry history
    WS   /ws/telemetry  live mock telemetry stream

Phase 1 serves clearly-labeled mock telemetry only. Lalith's real
simulation and Ali's decision engine integrate in Phase 2 at the
state-manager push seam (telemetry.telemetry_loop -> state_manager.push).
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from models import HealthResponse, HistoryResponse, TelemetryFrame
from state_manager import state_manager
from telemetry import NIMBUS_VERSION, TICK_INTERVAL_S, seed_state, telemetry_loop

CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    state_manager.mark_running(True)
    await seed_state(state_manager)
    task = asyncio.create_task(telemetry_loop(state_manager, TICK_INTERVAL_S))
    try:
        yield
    finally:
        state_manager.mark_running(False)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="Nimbus Backend",
    description=(
        "Simulated autonomous energy-management backend for an isolated island. "
        "Phase 1 provides mock telemetry foundation only."
    ),
    version=NIMBUS_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse, tags=["health"])
async def health() -> HealthResponse:
    state = state_manager.get_state()
    return HealthResponse(
        status="ok" if state_manager.is_running else "degraded",
        service="nimbus-backend",
        version=NIMBUS_VERSION,
        timestamp_ms=int(time.time() * 1000),
        uptime_s=round(state_manager.uptime_s, 3),
        last_tick_ms=state_manager.last_tick_ms,
        connected_clients=state_manager.connected_clients,
        telemetry_running=state_manager.is_running,
    )


@app.get("/api/state", response_model=TelemetryFrame, tags=["api"])
async def get_state() -> TelemetryFrame:
    frame = state_manager.get_state()
    if frame is None:
        raise RuntimeError("telemetry has not been seeded yet")
    return frame


@app.get("/api/history", response_model=HistoryResponse, tags=["api"])
async def get_history(
    limit: int = Query(default=50, ge=1, le=500),
) -> HistoryResponse:
    items = state_manager.get_history(limit)
    return HistoryResponse(items=items, count=len(items), limit=limit)


@app.websocket("/ws/telemetry")
async def ws_telemetry(websocket: WebSocket) -> None:
    """Stream mock telemetry frames.

    On connect: sends the current frame immediately, then a fresh frame on
    every telemetry tick. Clients never get a duplicate producer loop - they
    only read the shared, single source of truth in the state manager.
    """
    await websocket.accept()
    state_manager.register_client(websocket)
    try:
        while True:
            frame = state_manager.get_state()
            if frame is not None:
                await websocket.send_json(frame.model_dump(by_alias=True))
            await asyncio.sleep(TICK_INTERVAL_S)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        state_manager.deregister_client(websocket)