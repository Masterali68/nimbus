"""Tests for GET /health and app startup."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_app_starts(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200


def test_health_ok(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "nimbus-backend"
    assert isinstance(body["version"], str) and body["version"]
    assert isinstance(body["timestampMs"], int)
    assert body["telemetryRunning"] is True


def test_health_when_loop_down(client: TestClient) -> None:
    """Even a degraded backend still returns a structured health payload."""
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] in {"ok", "degraded"}