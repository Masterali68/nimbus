"""Phase 2 WebSocket tests: events + mode changes propagate on the live stream."""

from __future__ import annotations

from fastapi.testclient import TestClient

from models import TelemetryFrame


def test_ws_initial_sequence_then_growing(client: TestClient) -> None:
    with client.websocket_connect("/ws/telemetry") as ws:
        first = ws.receive_json()
        second = ws.receive_json()
        assert second["sequence"] > first["sequence"]
        for _ in range(3):
            nxt = ws.receive_json()
            assert nxt["sequence"] > second["sequence"]
            second = nxt


def test_ws_event_propagates_to_stream(client: TestClient) -> None:
    client.post("/api/event", json={"eventType": "cloud_cover"})
    with client.websocket_connect("/ws/telemetry") as ws:
        seen = set()
        for _ in range(15):
            frame = ws.receive_json()
            seen.add(frame["activeEvent"])
            if frame["activeEvent"] == "cloud_cover":
                break
    assert "cloud_cover" in seen


def test_ws_controller_mode_propagates(client: TestClient) -> None:
    client.post("/api/controller", json={"mode": "nimbus"})
    with client.websocket_connect("/ws/telemetry") as ws:
        mode = None
        for _ in range(15):
            frame = ws.receive_json()
            TelemetryFrame.model_validate(frame)
            mode = frame["controllerMode"]
            if mode == "nimbus":
                break
    assert mode == "nimbus"
    client.post("/api/controller", json={"mode": "reactive"})


def test_ws_frames_valid_schema(client: TestClient) -> None:
    with client.websocket_connect("/ws/telemetry") as ws:
        for _ in range(4):
            TelemetryFrame.model_validate(ws.receive_json())