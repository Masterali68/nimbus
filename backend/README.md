# Nimbus Backend

FastAPI foundation for the Nimbus simulated island energy-management system.

**Phase 1 status:** mock telemetry only. There is no real simulation, no decision
engine, no database, and no authentication. Real simulation (Lalith) and the
controllers/decision engine (Ali) integrate in **Phase 2**; this foundation
provides the API surface and the single-source-of-truth state manager they plug into.

## Quick start (macOS)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

> A `.venv` may already exist in `backend/`; `pip install -r requirements.txt`
> will bring it up to date. Python 3.12+ recommended (3.13 verified).

## URLs

| Thing | URL |
|---|---|
| Backend | http://localhost:8000 |
| Interactive API docs (OpenAPI) | http://localhost:8000/docs |
| Alternate docs | http://localhost:8000/redoc |
| Frontend (Next.js, from repo root) | http://localhost:3000 |

Frontend and backend run side by side. CORS already allows localhost:3000.

## Endpoints

| Route | Method | Description |
|---|---|---|
| `/health` | GET | Service health / uptime / telemetry-loop status |
| `/api/state` | GET | Current mock telemetry snapshot |
| `/api/history?limit=N` | GET | Bounded history, newest-first (`limit` 1–500, default 50) |
| `/ws/telemetry` | WS | Live mock telemetry stream |

### WebSocket protocol

On connect the server immediately sends the current frame, then a fresh frame
on every telemetry tick (500 ms). Every message is a `TelemetryFrame` JSON
object — the same shape as `/api/state`. Client text messages are ignored in
Phase 1; disconnects are handled gracefully.

## Telemetry contract

All JSON uses **camelCase** to match the frontend. These exact fields are the
canonical contract (enforced by `tests/test_state.py`):

```
timestampMs, sequence, controllerMode, activeEvent,
solarKw, windKw, totalGenerationKw,
batteryKwh, batteryCapacityKwh, batteryPct,
batteryChargeRateKw, batteryDischargeRateKw,
totalDemandKw, netPowerKw, filteredNetPowerKw,
velocityKwS, accelerationKwS2, severity, trajectory,
resources, latestDecision, explanation
```

`resources` always contains exactly four entries, keyed by name:

```
hospital, desalination, residential, resort
```

each with `{ name, demandKw, operatingPct, state, shedable }`.

Phase 1 values: `controllerMode` is `"reactive"`, `activeEvent` / `latestDecision`
are `null`, and `explanation` is a static "stable island" message. Phase 2 replaces
these with real values.

## Architecture

```
backend/
├── main.py            # FastAPI app: lifespan, CORS, REST + WebSocket routes
├── models.py          # Pydantic schemas (camelCase contract)
├── state_manager.py   # single in-memory source of truth (current + bounded history)
├── telemetry.py       # CLEARLY-MOCK telemetry generator + background loop
├── requirements.txt
├── pytest.ini
└── tests/             # pytest suite (health, state, history, ws, cors, internals)
```

There is exactly **one** background telemetry loop (started in the FastAPI
lifespan, cancelled on shutdown). WebSocket clients only read the shared state
manager — they never start their own producer loop. History is a bounded deque
(500 frames) so memory cannot grow unbounded. In Phase 2, Lalith's simulation
replaces `telemetry.telemetry_loop`; the seam is `state_manager.push(frame)`.

## Configuration

Tunables live at the top of `telemetry.py` (generation/battery/demand constants,
EMA alpha, severity/trajectory thresholds, tick interval, seed). No env vars are
required to run.

## Tests

```bash
cd backend
source .venv/bin/activate
pytest
```

Verifies app startup, `/health`, `/api/state` (contract + field validity),
`/api/history` (limit/order/validation), `/ws/telemetry` (initial + update frames),
CORS headers for localhost:3000, and mock-generator invariants.