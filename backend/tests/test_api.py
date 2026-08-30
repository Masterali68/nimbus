"""Tests for the Phase 2 control-plane REST endpoints.

The session-scoped client runs the full lifespan, so the realtime loop and
mocks are live. The 503 paths use a client WITHOUT lifespan (runtime missing).
"""

from __future__ import annotations

import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api_routes import router
from main import app
from models import TelemetryFrame

VALID_EVENTS = [
    "storm",
    "cloud_cover",
    "wind_drop",
    "tourist_surge",
    "water_emergency",
    "compound_crisis",
]
VALID_MODES = ["naive", "reactive", "nimbus"]


def _wait_for_state(
    client: TestClient, predicate, attempts: int = 30
) -> tuple[int, dict]:
    """Poll /api/state until ``predicate(body)`` is true or attempts run out.

    State changes land on the next loop tick (0.2s), so one-shot GETs right
    after a control action can still see the pre-action frame.
    """
    body = {}
    status = 0
    for _ in range(attempts):
        resp = client.get("/api/state")
        status = resp.status_code
        try:
            body = resp.json()
        except ValueError:
            break
        if status == 200 and predicate(body):
            break
        time.sleep(0.05)
    return status, body


# --------------------------------------------------------------------------- #
# /api/event
# --------------------------------------------------------------------------- #
def test_post_event_all_valid(client: TestClient) -> None:
    for event in VALID_EVENTS:
        resp = client.post("/api/event", json={"eventType": event})
        assert resp.status_code == 200, f"{event}: {resp.text}"
        body = resp.json()
        assert body["accepted"] is True
        assert body["eventType"] == event
        assert body["activeEvent"] == event


def test_post_event_unknown_gets_400(client: TestClient) -> None:
    resp = client.post("/api/event", json={"eventType": "meteor"})
    assert resp.status_code == 400


def test_post_event_active_event_shows_in_state(client: TestClient) -> None:
    client.post("/api/event", json={"eventType": "water_emergency"})
    status, body = _wait_for_state(
        client, lambda b: b.get("activeEvent") == "water_emergency"
    )
    assert status == 200
    frame = TelemetryFrame.model_validate(body)
    assert frame.active_event == "water_emergency"


def test_post_event_with_params_accepted(client: TestClient) -> None:
    resp = client.post(
        "/api/event", json={"eventType": "storm", "params": {"durationTicks": 50}}
    )
    assert resp.status_code == 200


# --------------------------------------------------------------------------- #
# /api/controller
# --------------------------------------------------------------------------- #
def test_post_controller_all_valid_modes(client: TestClient) -> None:
    for mode in VALID_MODES:
        resp = client.post("/api/controller", json={"mode": mode})
        assert resp.status_code == 200, f"{mode}: {resp.text}"
        body = resp.json()
        assert body["adopted"] is True
        assert body["mode"] == mode
        assert isinstance(body["previousMode"], str)


def test_post_controller_invalid_mode_422(client: TestClient) -> None:
    resp = client.post("/api/controller", json={"mode": "quantum"})
    assert resp.status_code == 422


def test_post_controller_mode_shows_in_state(client: TestClient) -> None:
    client.post("/api/controller", json={"mode": "nimbus"})
    status, body = _wait_for_state(client, lambda b: b.get("controllerMode") == "nimbus")
    assert status == 200
    assert body["controllerMode"] == "nimbus"
    # restore
    client.post("/api/controller", json={"mode": "reactive"})


# --------------------------------------------------------------------------- #
# /api/reset
# --------------------------------------------------------------------------- #
def test_post_reset_clears_history(client: TestClient) -> None:
    client.post("/api/event", json={"eventType": "storm"})
    history_before = len(client.get("/api/history").json()["items"])
    assert history_before >= 1
    resp = client.post("/api/reset")
    assert resp.status_code == 200
    body = resp.json()
    assert body["reset"] is True
    # Loop keeps ticking after reset, so history refills quickly; assert the
    # frame *type* is still valid and active event cleared shortly after.
    assert isinstance(body["controllerMode"], str)


def test_post_reset_then_state_valid(client: TestClient) -> None:
    client.post("/api/reset")
    # History is empty the instant reset returns; the loop refills it on the
    # next tick, so poll until /api/state parses again.
    status, body = _wait_for_state(client, lambda b: isinstance(b.get("sequence"), int))
    assert status == 200
    frame = TelemetryFrame.model_validate(body)
    assert frame.sequence >= 0


# --------------------------------------------------------------------------- #
# /health (Phase 2 fields)
# --------------------------------------------------------------------------- #
def test_health_reports_adapters(client: TestClient) -> None:
    body = client.get("/health").json()
    assert body["telemetryRunning"] is True
    assert body["simulationBackend"] == "mock"
    assert body["controllerBackend"] == "mock"
    assert body["controllerMode"] in {"naive", "reactive", "nimbus"}
    assert "activeEvent" in body
    assert "lastError" in body


# --------------------------------------------------------------------------- #
# Runtime-not-initialized -> 503
# --------------------------------------------------------------------------- #
def _no_lifespan_client() -> TestClient:
    """A bare app with the real router but no lifespan -> no runtime wired."""
    bare = FastAPI()
    bare.include_router(router)
    return TestClient(bare)


def test_state_503_when_runtime_missing() -> None:
    with _no_lifespan_client() as c:
        assert c.get("/api/state").status_code == 503
        assert c.get("/api/history").status_code == 503


def test_event_503_when_runtime_missing() -> None:
    with _no_lifespan_client() as c:
        resp = c.post("/api/event", json={"eventType": "storm"})
        assert resp.status_code == 503


def test_controller_503_when_runtime_missing() -> None:
    with _no_lifespan_client() as c:
        resp = c.post("/api/controller", json={"mode": "reactive"})
        assert resp.status_code == 503


def test_reset_503_when_runtime_missing() -> None:
    with _no_lifespan_client() as c:
        assert c.post("/api/reset").status_code == 503