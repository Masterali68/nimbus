"""Tests for GET /api/state, GET /api/history, /ws/telemetry and CORS."""

from __future__ import annotations

from fastapi.testclient import TestClient

from models import TelemetryFrame


# --------------------------------------------------------------------------- #
# /api/state
# --------------------------------------------------------------------------- #
def test_state_returns_valid_json(client: TestClient) -> None:
    resp = client.get("/api/state")
    assert resp.status_code == 200
    body = resp.json()
    # Must parse as the canonical TelemetryFrame schema (camelCase aliases).
    frame = TelemetryFrame.model_validate(body)
    assert frame.sequence >= 0


def test_state_contract_keys_present(client: TestClient, contract_keys: list[str]) -> None:
    body = client.get("/api/state").json()
    missing = [k for k in contract_keys if k not in body]
    assert not missing, f"missing contract fields: {missing}"


def test_state_fields_valid(client: TestClient) -> None:
    body = client.get("/api/state").json()
    assert 0.0 <= body["batteryPct"] <= 100.0
    assert 0.0 <= body["batteryKwh"] <= body["batteryCapacityKwh"]
    assert body["solarKw"] >= 0.0
    assert body["windKw"] >= 0.0
    assert abs(body["totalGenerationKw"] - (body["solarKw"] + body["windKw"])) < 0.01
    assert body["totalDemandKw"] >= 0.0
    assert abs(body["netPowerKw"] - (body["totalGenerationKw"] - body["totalDemandKw"])) < 0.01
    assert body["controllerMode"] in {"naive", "reactive", "nimbus"}
    assert body["severity"] in {"stable", "watch", "warning", "critical"}
    assert body["trajectory"] in {"deteriorating", "stable", "improving"}


def test_state_resources_exist(client: TestClient, expected_resource_names: list[str]) -> None:
    body = client.get("/api/state").json()
    resources = body["resources"]
    assert set(resources.keys()) == set(expected_resource_names)
    for name in expected_resource_names:
        res = resources[name]
        assert 0.0 <= res["operatingPct"] <= 100.0
        assert res["demandKw"] >= 0.0
        assert res["state"] in {"normal", "throttled", "restoring", "shed"}


def test_state_hospital_shedable_false(client: TestClient) -> None:
    body = client.get("/api/state").json()
    assert body["resources"]["hospital"]["shedable"] is False


# --------------------------------------------------------------------------- #
# /api/history
# --------------------------------------------------------------------------- #
def test_history_returns_list(client: TestClient) -> None:
    resp = client.get("/api/history")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["items"], list)
    assert len(body["items"]) >= 1
    assert body["count"] == len(body["items"])


def test_history_respects_limit(client: TestClient) -> None:
    limit = 3
    body = client.get(f"/api/history?limit={limit}").json()
    assert body["count"] <= limit
    assert len(body["items"]) <= limit


def test_history_newest_first(client: TestClient) -> None:
    items = client.get("/api/history?limit=5").json()["items"]
    timestamps = [item["timestampMs"] for item in items]
    assert timestamps == sorted(timestamps, reverse=True)


def test_history_invalid_limit_422(client: TestClient) -> None:
    assert client.get("/api/history?limit=0").status_code == 422
    assert client.get("/api/history?limit=5000").status_code == 422


# --------------------------------------------------------------------------- #
# /ws/telemetry
# --------------------------------------------------------------------------- #
def test_ws_sends_initial_and_updates(client: TestClient) -> None:
    with client.websocket_connect("/ws/telemetry") as ws:
        first = ws.receive_json()
        assert isinstance(first["timestampMs"], int)
        assert first["sequence"] >= 0
        # Next frame arrives on the following tick.
        second = ws.receive_json()
        assert second["sequence"] > first["sequence"]


def test_ws_frame_matches_schema(client: TestClient) -> None:
    with client.websocket_connect("/ws/telemetry") as ws:
        frame = ws.receive_json()
        TelemetryFrame.model_validate(frame)


def test_ws_multiple_clients(client: TestClient) -> None:
    with client.websocket_connect("/ws/telemetry") as ws_a, client.websocket_connect(
        "/ws/telemetry"
    ) as ws_b:
        frame_a = ws_a.receive_json()
        frame_b = ws_b.receive_json()
        assert isinstance(frame_a["timestampMs"], int)
        assert isinstance(frame_b["timestampMs"], int)


# --------------------------------------------------------------------------- #
# CORS
# --------------------------------------------------------------------------- #
def test_cors_allows_localhost_3000(client: TestClient) -> None:
    resp = client.get("/api/state", headers={"Origin": "http://localhost:3000"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_cors_allows_127_0_0_1_3000(client: TestClient) -> None:
    resp = client.get("/api/state", headers={"Origin": "http://127.0.0.1:3000"})
    assert resp.headers.get("access-control-allow-origin") == "http://127.0.0.1:3000"