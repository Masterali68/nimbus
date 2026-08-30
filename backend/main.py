"""Nimbus FastAPI backend - Phase 2 real-time orchestration.

Runs from backend/ on port 8000:
    uvicorn main:app --reload --port 8000

Provides:
    GET  /health                 service health + adapter status
    GET  /api/state              current island telemetry
    GET  /api/history            bounded telemetry history
    POST /api/event              inject an island event (storm, cloud_cover,
                                 wind_drop, tourist_surge, water_emergency,
                                 compound_crisis)
    POST /api/controller         switch decision engine mode (naive/reactive/nimbus)
    POST /api/reset              restart the island
    WS   /ws/telemetry           live telemetry stream

The lifespan wires config -> adapters -> runtime and starts the single
simulation loop. Simulation + controller adapters default to clearly-labeled
temporary mocks; set NIMBUS_SIMULATION_BACKEND / NIMBUS_CONTROLLER_BACKEND to
connect Lalith's / Ali's real modules once they land in this branch.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api_routes import router
from config import NIMBUS_VERSION, load_config
from integrations import build_controller_adapter, build_simulation_adapter
from runtime import BackendRuntime
from state_manager import state_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = load_config()
    simulation = build_simulation_adapter(config)
    controller = build_controller_adapter(config)
    runtime = BackendRuntime(config, state_manager, simulation, controller)
    app.state.runtime = runtime
    state_manager.mark_running(True)
    await runtime.start()
    try:
        yield
    finally:
        state_manager.mark_running(False)
        await runtime.stop()


app = FastAPI(
    title="Nimbus Backend",
    description=(
        "Simulated autonomous energy-management backend for an isolated island. "
        "Phase 2: real-time simulation loop with controller + simulation "
        "adapters, REST control plane and live telemetry stream."
    ),
    version=NIMBUS_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(router)