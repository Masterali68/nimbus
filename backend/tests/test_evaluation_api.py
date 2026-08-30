"""HTTP tests for the evaluation endpoints via the FastAPI TestClient.

Uses a fresh eval-only app (evaluation router + a fresh EvaluationRunner) per
test so background runs from one test never hold the single evaluation slot
into the next test, and so the process-global StateManager ``telemetryRunning``
flag is never toggled (the live demo app's health checks depend on it).
Evaluation/live isolation is asserted at the runner level instead.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from config import Config
from evaluation_runner import EvaluationRunner
from evaluation_routes import router


def _run_started(eval_client: TestClient, n: int = 3, **extra) -> dict:
    body = {"scenarioCount": n, **extra}
    resp = eval_client.post("/api/evaluate", json=body)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    data["run_id"] = data["runId"]  # convenience alias
    return data


@pytest.fixture
def eval_client() -> TestClient:
    """Minimal eval-only app: evaluation router + a fresh EvaluationRunner."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        runner = EvaluationRunner(Config())
        app.state.evaluation = runner
        try:
            yield
        finally:
            runner.close()

    app = FastAPI(lifespan=lifespan)
    app.include_router(router)
    with TestClient(app) as c:
        yield c


def _wait_for_status(eval_client: TestClient, run_id: str, status: str,
                     attempts: int = 600) -> dict:
    body = {}
    for _ in range(attempts):
        body = eval_client.get(f"/api/evaluate/{run_id}").json()
        if body["status"] == status:
            return body
        time.sleep(0.05)
    raise AssertionError(f"run {run_id} did not reach {status!r}; last={body}")


def test_start_evaluation_returns_created(eval_client: TestClient):
    data = _run_started(eval_client, n=2)
    assert data["status"] in ("queued", "running")
    assert data["scenarioCount"] == 2
    assert eval_client.get("/api/evaluate").status_code == 200


def test_invalid_scenario_count_rejected(eval_client: TestClient):
    resp = eval_client.post("/api/evaluate", json={"scenarioCount": 0})
    assert resp.status_code in (400, 422)
    resp = eval_client.post("/api/evaluate", json={"scenarioCount": 5000})
    assert resp.status_code in (400, 422)


def test_invalid_event_rejected(eval_client: TestClient):
    resp = eval_client.post(
        "/api/evaluate", json={"scenarioCount": 2, "selectedEvents": ["meteor"]}
    )
    assert resp.status_code in (400, 422)


def test_invalid_controller_rejected(eval_client: TestClient):
    resp = eval_client.post(
        "/api/evaluate", json={"scenarioCount": 2, "controllers": ["quantum"]}
    )
    assert resp.status_code in (400, 422)


def test_duplicate_concurrent_run_rejected(eval_client: TestClient):
    _run_started(eval_client, n=60)
    resp = eval_client.post("/api/evaluate", json={"scenarioCount": 1})
    assert resp.status_code == 409, resp.text


def test_live_state_unchanged_during_evaluation(eval_client: TestClient):
    from state_manager import state_manager as sm
    prior = sm.get_state()
    _run_started(eval_client, n=2)
    # Evaluation runs on its own runner and must never start or mutate the
    # live demo StateManager (still None/untouched in this isolated app).
    assert sm.get_state() == prior


def test_progress_updates_and_completes(eval_client: TestClient):
    data = _run_started(eval_client, n=2)
    body = _wait_for_status(eval_client, data["run_id"], "completed")
    assert body["status"] == "completed"
    assert body["progressPct"] == 100.0
    assert body["scenarioCount"] == 2


def test_completed_result_valid_schema(eval_client: TestClient):
    data = _run_started(eval_client, n=2)
    result = _wait_for_status(eval_client, data["run_id"], "completed")
    assert len(result["controllerResults"]) == 2
    first = result["controllerResults"][0]
    # Each scenario contains naive + reactive + nimbus
    assert set(first["controllers"].keys()) == {"naive", "reactive", "nimbus"}
    for mode, cm in first["controllers"].items():
        assert cm["criticalServiceUptimePct"] is not None
        assert cm["minimumBatteryPct"] is not None
    # The flat frontend summary is present and honest.
    assert set(result["controllers"].keys()) == {"naive", "reactive", "nimbus"}
    assert result["controllers"]["naive"]["sampleCount"] == 2
    assert result["scenario"]["scenarioCount"] == 2


def test_latest_endpoint_no_result_is_404(eval_client: TestClient):
    resp = eval_client.get("/api/evaluate/latest")
    assert resp.status_code == 404


def test_latest_returns_completed_result(eval_client: TestClient):
    data = _run_started(eval_client, n=2)
    _wait_for_status(eval_client, data["run_id"], "completed")
    resp = eval_client.get("/api/evaluate/latest")
    assert resp.status_code == 200
    body = resp.json()
    assert body["runId"] == data["run_id"]
    assert set(body["controllers"].keys()) == {"naive", "reactive", "nimbus"}


def test_unknown_run_id_404(eval_client: TestClient):
    assert eval_client.get("/api/evaluate/nope/progress").status_code == 404
    assert eval_client.get("/api/evaluate/nope").status_code == 404


def test_aggregate_requires_completed(eval_client: TestClient):
    data = _run_started(eval_client, n=2)
    _wait_for_status(eval_client, data["run_id"], "completed")
    agg = eval_client.get(f"/api/evaluate/aggregate/{data['run_id']}").json()
    assert "controllers" in agg
    assert set(agg["controllers"].keys()) == {"naive", "reactive", "nimbus"}


def test_aggregate_unknown_run_404(eval_client: TestClient):
    assert eval_client.get("/api/evaluate/aggregate/doesnotexist").status_code == 404


def test_no_lifespan_returns_503():
    from fastapi import FastAPI

    from evaluation_routes import router

    bare = FastAPI()
    bare.include_router(router)
    with TestClient(bare) as c:
        assert c.post("/api/evaluate", json={"scenarioCount": 1}).status_code == 503


def test_require_real_gives_clear_integration_error(eval_client: TestClient):
    resp = eval_client.post(
        "/api/evaluate", json={"scenarioCount": 1, "requireReal": True}
    )
    if resp.status_code == 503:
        assert "not" in resp.json()["detail"].lower()
    else:
        assert resp.status_code in (201, 200)


def test_cancel_unknown_run_is_404(eval_client: TestClient):
    assert eval_client.post("/api/evaluate/cancel/doesnotexist").status_code == 404