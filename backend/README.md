# Nimbus Backend

FastAPI backend for the Nimbus simulated island energy-management system.

**Phase 2 status:** real-time orchestration — a single background loop drives a
simulation + decision-engine pipeline and publishes live telemetry over REST and
WebSocket. The simulation and controller are behind **adapters** that currently
use clearly-labeled temporary **mocks**. Lalith's real simulation and Ali's real
decision engine plug into the same seams (no backend changes needed when they
land). No database, no authentication.

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

Frontend and backend run side by side. CORS allows localhost:3000.

## Endpoints

| Route | Method | Description |
|---|---|---|
| `/health` | GET | Service health, loop/adapter status, active mode + event |
| `/api/state` | GET | Current island telemetry snapshot |
| `/api/history?limit=N` | GET | Bounded history, newest-first (`limit` 1–500, default 50) |
| `/api/event` | POST | Inject an island event (see below) |
| `/api/controller` | POST | Switch decision-engine mode: `naive` / `reactive` / `nimbus` |
| `/api/reset` | POST | Restart the island (controller mode preserved) |
| `/ws/telemetry` | WS | Live telemetry stream |

### Control-plane bodies

Events (`eventType` one of `storm`, `cloud_cover`, `wind_drop`, `tourist_surge`,
`water_emergency`, `compound_crisis`): unknown event types return **400**:

```json
{ "eventType": "storm", "params": { "durationTicks": 90 } }
```

Controller mode (invalid modes return **422** via schema validation):

```json
{ "mode": "reactive" }
```

`/api/reset` takes no body. It restarts the island at a fresh seeded state,
clears telemetry history and the active event, and preserves the current
controller mode. Assert errors: **400** unknown event, **422** invalid mode,
**503** runtime not initialized / loop down, **500** internal errors.

### WebSocket protocol

On connect the server immediately sends the current frame, then broadcasts a
fresh frame on every loop tick (200 ms by default). Every message is a
`TelemetryFrame` JSON object — the same shape as `/api/state`. Client text
messages are ignored; disconnects are handled gracefully.

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

each with `{ name, demandKw, maxDemandKw, operatingPct, state, shedable,
throttleable, minimumOperatingPct, criticality }`.

`trajectory` may be `deteriorating | stable | improving` (plus `critical` for the
real engine). `state` may be `normal | throttled | reduced | shed | cooldown |
restoring | protected`; the mock never reduces the hospital below 100% (it is
reported `protected` only when a controller tries). With the mock controller,
`latestDecision` carries the passthrough decision (`action: NONE`,
`reasonCode: MOCK_CONTROLLER`) so the dashboard can render the decision panel
against real shape.

## Architecture

```
backend/
├── main.py                 # FastAPI app: lifespan wires config->adapters->runtime
├── api_routes.py           # REST + WebSocket routes (runtime from app.state)
├── runtime.py              # single simulation loop + control plane (events, reset)
├── config.py               # tunables (tick, history size, adapters, seed, version)
├── models.py               # Pydantic schemas (camelCase contract + request bodies)
├── state_manager.py        # in-memory source of truth (current + bounded history)
├── integrations/
│   ├── simulation.py       # SimulationAdapter seam + TEMP mock + Lalith import point
│   └── controller.py       # ControllerAdapter seam + TEMP mock + Ali import point
├── telemetry.py            # Phase 1 mock helpers (kept for tests; not in the live path)
├── requirements.txt
├── pytest.ini
└── tests/                  # pytest suite (health, state, history, ws, control plane)
```

The realtime pipeline (**one** loop per process, started in the lifespan,
cancelled on shutdown):

```
simulation.get_state  ->  controller.decide(mode, snapshot)  ->  simulation.tick
                     ->  build TelemetryFrame  ->  state_manager.push  ->  broadcast
```

A per-tick adapter error is recorded as `health.lastError` and the loop keeps
running (it never kills the backend). WebSocket clients only read the shared
state manager — they never start their own producer loop. History is a bounded
deque (500 frames) so memory cannot grow unbounded.

## Adapter status (what's temporary vs real)

| Seam | Backend | Module the real adapter imports | Landing condition |
|---|---|---|---|
| Simulation | `mock` (**active**) | `backend/island_sim.py` (`create_initial_state`, `reset_simulation`, `tick_simulation`, `apply_event`, `get_state`) | Lalith's Python port |
| Controller | `mock` (**active**) | `backend/controller.py` (`run_controller(state, cfg=None)` + config/hysteresis/explainability) | Ali's engine on this branch |

Set the backends explicitly (defaults are `mock`):

```bash
NIMBUS_SIMULATION_BACKEND=lalith NIMBUS_CONTROLLER_BACKEND=nimbus uvicorn main:app --port 8000
```

Configured-but-missing real modules raise a clear startup error telling you to
fall back to `mock` — the backend never silently fakes a real integration.

## Configuration

`config.py` is the single tunable place:

| Env var | Default | Meaning |
|---|---|---|
| `NIMBUS_TICK_INTERVAL_S` | `0.2` | Loop cadence in seconds (target band 100–250 ms) |
| `NIMBUS_HISTORY_SIZE` | `500` | Bounded telemetry history length |
| `NIMBUS_DECISION_LOG_SIZE` | `1000` | Bounded decision log length |
| `NIMBUS_SEED` | `42` | Deterministic simulation seed |
| `NIMBUS_SIMULATION_BACKEND` | `mock` | `mock` or `lalith` |
| `NIMBUS_CONTROLLER_BACKEND` | `mock` | `mock` or `nimbus` |

No env vars are required to run.

## Tests

```bash
cd backend
source .venv/bin/activate
pytest
```

Verifies app startup, `/health`, `/api/state` (contract + field validity),
`/api/history` (limit/order/validation), `/ws/telemetry` (initial + update
frames, event/mode propagation), CORS for localhost:3000, the control-plane
endpoints (events, controller modes, reset, 4xx/5xx handling), the adapter
seams + temp mocks, and the runtime loop invariants (single loop, duplicate
start refused, reset semantics).