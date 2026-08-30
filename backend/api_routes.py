"""HTTP + WebSocket routes for the Nimbus backend.

All stateful routes read the shared runtime from ``request.app.state.runtime``
(created by the app lifespan). A route that finds no runtime returns 503 so a
misconfigured or half-started backend degrades cleanly instead of 500ing.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from models import (
    ControllerRequest,
    ControllerResponse,
    EventRequest,
    EventResponse,
    HealthResponse,
    HistoryResponse,
    ResetResponse,
    TelemetryFrame,
)
from runtime import BackendRuntime, TelemetryLoopError

router = APIRouter()

WAIT_FOR_WS_MESSAGE_S = 5.0


def _runtime(request: Request) -> BackendRuntime:
    runtime = getattr(request.app.state, "runtime", None)
    if runtime is None:
        raise HTTPException(status_code=503, detail="runtime not initialized")
    return runtime


def _extract_event_type(body: EventRequest) -> str:
    value = body.event_type
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(status_code=400, detail="eventType is required")
    return value.strip()


@router.get("/health", response_model=HealthResponse, tags=["health"])
async def health(request: Request) -> HealthResponse:
    runtime = getattr(request.app.state, "runtime", None)
    if runtime is None:
        return HealthResponse(
            status="degraded",
            version="0.2.0",
            timestamp_ms=int(time.time() * 1000),
            telemetry_running=False,
            simulation_ok=False,
            controller_ok=False,
            last_error="runtime not initialized",
        )
    info = runtime.status_dict()
    return HealthResponse(
        status="ok" if info["loop_running"] else "degraded",
        version=runtime.config.version,
        timestamp_ms=int(time.time() * 1000),
        uptime_s=round(runtime.uptime_s, 3),
        last_tick_ms=runtime.last_tick_ms,
        connected_clients=runtime.connected_clients,
        telemetry_running=info["loop_running"],
        controller_mode=runtime.mode,
        active_event=runtime.active_event,
        simulation_backend=info["simulation_backend"],
        controller_backend=info["controller_backend"],
        simulation_ok=True,
        controller_ok=True,
        last_error=runtime.last_error,
    )


@router.get("/api/state", response_model=TelemetryFrame, tags=["api"])
async def get_state(request: Request) -> TelemetryFrame:
    runtime = _runtime(request)
    frame = runtime.state_manager.get_state()
    if frame is None:
        raise HTTPException(status_code=503, detail="telemetry not ready yet")
    return frame


@router.get("/api/history", response_model=HistoryResponse, tags=["api"])
async def get_history(
    request: Request, limit: int = Query(default=50, ge=1, le=500)
) -> HistoryResponse:
    runtime = _runtime(request)
    items = runtime.state_manager.get_history(limit)
    return HistoryResponse(items=items, count=len(items), limit=limit)


@router.post("/api/event", response_model=EventResponse, tags=["api"])
async def post_event(request: Request, body: EventRequest) -> EventResponse:
    runtime = _runtime(request)
    event_type = _extract_event_type(body)
    if event_type not in runtime.config_allowed_events():
        raise HTTPException(status_code=400, detail=f"unknown eventType: {event_type!r}")
    try:
        await runtime.post_event(event_type, body.params)
    except TelemetryLoopError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return EventResponse(
        accepted=True,
        event_type=event_type,
        active_event=runtime.active_event,
        timestamp_ms=int(time.time() * 1000),
    )


@router.post("/api/controller", response_model=ControllerResponse, tags=["api"])
async def post_controller(
    request: Request, body: ControllerRequest
) -> ControllerResponse:
    runtime = _runtime(request)
    previous = await runtime.set_controller_mode(body.mode)
    return ControllerResponse(
        mode=runtime.mode,
        previous_mode=previous,
        adopted=True,
        adopted_at_ms=int(time.time() * 1000),
    )


@router.post("/api/reset", response_model=ResetResponse, tags=["api"])
async def post_reset(request: Request) -> ResetResponse:
    runtime = _runtime(request)
    try:
        await runtime.reset()
    except TelemetryLoopError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ResetResponse(
        reset=True,
        timestamp_ms=int(time.time() * 1000),
        sequence=0,
        controller_mode=runtime.mode,
        active_event=runtime.active_event,
    )


@router.websocket("/ws/telemetry")
async def ws_telemetry(websocket: WebSocket) -> None:
    """Live telemetry stream.

    On connect: accept -> send the current frame immediately -> register for
    loop broadcasts (register-after-initial guarantees every frame a client
    receives is newer than its first). The handler then idles on receive so
    disconnects are detected; the simulation loop does the actual streaming.
    """
    await websocket.accept()
    try:
        frame = websocket.app.state.runtime.state_manager.get_state()
        if frame is not None:
            await websocket.send_json(frame.model_dump(by_alias=True))
        websocket.app.state.runtime.register_client(websocket)
        while True:
            message = await websocket.receive_text()
            if message is None:
                break
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        runtime = getattr(websocket.app.state, "runtime", None)
        if runtime is not None:
            runtime.deregister_client(websocket)