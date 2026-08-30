"""Nimbus FastAPI backend - Phase 2 real-time orchestration + Phase 3 evaluation.

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
    POST /api/evaluate           start an evaluation run (see Phase 3 below)
    GET  /api/evaluate/{run_id}  result + progress for a run
    GET  /api/evaluate/latest    latest completed result
    GET  /api/evaluate           list runs
    GET  /api/evaluate/aggregate/{run_id}  aggregated per-controller summary
    POST /api/evaluate/cancel/{run_id}     cancel a queued/running run

The lifespan wires config -> adapters -> runtime + evaluation runner and starts
the single simulation loop. Simulation + controller adapters default to
clearly-labeled temporary mocks; set NIMBUS_SIMULATION_BACKEND /
NIMBUS_CONTROLLER_BACKEND to connect Lalith's / Ali's real modules once they
land in this branch.

Phase 3 (evaluation): an isolated EvaluationRunner on its own loop executes a
deterministic set of scenarios (naive/reactive/nimbus per scenario), computes
real metrics (prefers Ali's evaluation_metrics when importable, falls back to
documented formulas — never fabricated), and keeps full results for REST
polling. Evaluation runs on a separate worker loop and never disturbs the live
demo telemetry loop.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api_routes import router
from config import NIMBUS_VERSION, load_config
from evaluation_runner import EvaluationRunner
from evaluation_routes import router as evaluation_router
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
    evaluation = EvaluationRunner(config)
    app.state.evaluation = evaluation
    state_manager.mark_running(True)
    await runtime.start()
    try:
        yield
    finally:
        state_manager.mark_running(False)
        await runtime.stop()
        evaluation.close()


app = FastAPI(
    title="Nimbus Backend",
    description=(
        "Simulated autonomous energy-management backend for an isolated island. "
        "Phase 2: real-time simulation loop with controller + simulation "
        "adapters, REST control plane and live telemetry stream. Phase 3: "
        "isolated head-to-head evaluation of naive/reactive/nimbus controllers "
        "across deterministic scenarios with honest per-controller metrics."
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
app.include_router(evaluation_router)