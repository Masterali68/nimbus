# Nimbus Shared Telemetry Contract

Status: **Phase 1 — source of truth for wire-facing data.**

Single source of truth (TypeScript):
`src/types/nimbus.ts`

All frontend, simulation, decision-engine, and backend work must import types from this file. Renaming a field here requires team agreement and a coordinated update across branches (`feat/island-simulation`, `feat/nimbus-engine`, `feat/backend-realtime`, `feat/ui-dashboard`).

---

## Rules

- **camelCase** for every field name.
- **Explicit units in field names** wherever it matters: `solarKw`, `batteryPct`, `velocityKwS`, `timestampMs`, `accelerationKwS2`.
- Values are plain JSON-serializable (numbers, strings, booleans). No classes, no functions.
- Never rename or remove a field without team agreement.
- The `id` field of a resource is a stable key; arrays are never used for resources — always the map keyed by `ResourceId`.

---

## Unit conventions

| Suffix | Meaning |
|---|---|
| `Kw` / `KwS` / `KwS2` | kilowatts, kilowatts/second, kilowatts/second-squared |
| `Kwh` | kilowatt-hours (battery energy) |
| `Pct` | percentage 0–100 |
| `Ms` | epoch milliseconds |

`velocityKwS` and `accelerationKwS2` describe the trajectory of the live energy balance (measured over the simulation tick interval). They are **not** weather forecasts.

---

## Types

### `ControllerMode`

`"naive" | "reactive" | "nimbus"`

The controller the decision engine should use for a tick. Global per island state.

### `ResourceId`

`"hospital" | "desalination" | "residential" | "resort"`

### `ResourceState`

| Value | Meaning |
|---|---|
| `PROTECTED` | Never dispatched or shed (hospital). |
| `NORMAL` | Operating at nominal levels. |
| `THROTTLED` | Smoothly reduced, still fully functional (desalination). |
| `REDUCED` | Stepped-down demand (residential). |
| `SHED` | Disconnected (resort). |
| `COOLDOWN` | Recently shed, held before reconnection. |

### `Severity`

`"STABLE" | "WATCH" | "WARNING" | "CRITICAL"`

### `Trajectory`

`"STABLE" | "IMPROVING" | "DETERIORATING" | "CRITICAL"`

Short-term trajectory of the filtered energy balance.

### `IslandResource`

| Field | Units | Meaning |
|---|---|---|
| `id` | — | Stable resource key (see `ResourceId`). |
| `name` | — | Human label for dashboards. |
| `criticality` | 0–100 | Priority score; higher = more critical. |
| `maxDemandKw` | kW | Demand at 100% operating level. |
| `minimumOperatingPct` | % | Safe lower operating bound (desalination floor, etc.). |
| `operatingPct` | % | Current operating level 0–100. |
| `currentDemandKw` | kW | Actual draw = `maxDemandKw * operatingPct / 100`. |
| `state` | — | See `ResourceState`. |
| `throttleable` | bool | Can be continuously trimmed rather than switched. |
| `shedCapable` | bool | Allowed to be fully disconnected. |

### `ResourceMap`

`Record<ResourceId, IslandResource>` — map, never an array.

### `IslandState`

| Field | Units | Meaning |
|---|---|---|
| `timestampMs` | ms | Epoch time for this sample. |
| `tick` | int | Monotonic tick counter. |
| `activeEvent` | — | Human-readable scenario label (e.g. `"storm-cloud-cover"`). |
| `controllerMode` | — | Requested controller for this tick. |
| `solarKw` | kW | Instantaneous solar generation. |
| `windKw` | kW | Instantaneous wind generation. |
| `totalGenerationKw` | kW | `solarKw + windKw`. |
| `batteryKwh` | kWh | Stored energy right now. |
| `batteryCapacityKwh` | kWh | Battery size. |
| `batteryPct` | % | `batteryKwh / batteryCapacityKwh * 100`. |
| `batteryChargeRateKw` | kW | Current charging rate (>0 while charging). |
| `batteryDischargeRateKw` | kW | Current discharging rate (>0 while draining). |
| `totalDemandKw` | kW | Sum of current demand across all four resources. |
| `netPowerKw` | kW | `totalGenerationKw - totalDemandKw` (>0 = surplus). |
| `filteredNetPowerKw` | kW | EMA-filtered net power (previous tick's value when the engine runs; updated by the engine contract in later phases). |
| `velocityKwS` | kW/s | Change rate of filtered net power (previous tick when engine runs). |
| `accelerationKwS2` | kW/s² | Change rate of velocity (previous tick when engine runs). |
| `resources` | — | `ResourceMap` snapshot. |

Phase 1 note: `filteredNetPowerKw`, `velocityKwS`, `accelerationKwS2` are seeded by the simulation and used by the Nimbus controller as the EMA recursion base. The full write-back loop (engine → state) is a Phase 2 explicit integration task.

### `NimbusDecision`

| Field | Meaning |
|---|---|
| `timestampMs` | Epoch time the decision was made. |
| `controllerMode` | Which controller made the decision. |
| `severity` | Crisis level at decision time. |
| `trajectory` | Trajectory at decision time. |
| `action` | Primary action: `NONE/PROTECT/THROTTLE/REDUCE/SHED/RESTORE/COOLDOWN`. |
| `reasonCode` | Machine-readable reason bucket (stable key for charts/filters). |
| `explanation` | Plain-English, human-readable explanation. |
| `expectedOutcome` | Plain-English statement of the expected result. |
| `resourceUpdates` | `Partial<ResourceMap>` — post-decision state of the resources the controller affected. Controllers that do not manage a resource (e.g. Naive never touches desalination) simply omit it. Hospital is always present and always `PROTECTED`. |

### `TelemetryPoint`

Compact trace point for dashboards: `timestampMs`, `solarKw`, `windKw`, `totalDemandKw`, `netPowerKw`, `batteryPct`.

---

## Example `IslandState` JSON

```json
{
  "timestampMs": 1700000100000,
  "tick": 60,
  "activeEvent": "storm-cloud-cover",
  "controllerMode": "nimbus",
  "solarKw": 120,
  "windKw": 150,
  "totalGenerationKw": 270,
  "batteryKwh": 560,
  "batteryCapacityKwh": 1000,
  "batteryPct": 56,
  "batteryChargeRateKw": 0,
  "batteryDischargeRateKw": 70,
  "totalDemandKw": 400,
  "netPowerKw": -130,
  "filteredNetPowerKw": -64,
  "velocityKwS": -6.4,
  "accelerationKwS2": -1.8,
  "resources": {
    "hospital": {
      "id": "hospital",
      "name": "Hospital",
      "criticality": 100,
      "maxDemandKw": 40,
      "minimumOperatingPct": 100,
      "operatingPct": 100,
      "currentDemandKw": 40,
      "state": "PROTECTED",
      "throttleable": false,
      "shedCapable": false
    },
    "desalination": {
      "id": "desalination",
      "name": "Desalination",
      "criticality": 90,
      "maxDemandKw": 120,
      "minimumOperatingPct": 30,
      "operatingPct": 100,
      "currentDemandKw": 120,
      "state": "NORMAL",
      "throttleable": true,
      "shedCapable": false
    },
    "residential": {
      "id": "residential",
      "name": "Residential",
      "criticality": 70,
      "maxDemandKw": 400,
      "minimumOperatingPct": 20,
      "operatingPct": 100,
      "currentDemandKw": 400,
      "state": "NORMAL",
      "throttleable": false,
      "shedCapable": true
    },
    "resort": {
      "id": "resort",
      "name": "Resort",
      "criticality": 20,
      "maxDemandKw": 250,
      "minimumOperatingPct": 0,
      "operatingPct": 100,
      "currentDemandKw": 250,
      "state": "NORMAL",
      "throttleable": false,
      "shedCapable": true
    }
  }
}
```

---

## Example `NimbusDecision` JSON

```json
{
  "timestampMs": 1700000100000,
  "controllerMode": "nimbus",
  "severity": "WARNING",
  "trajectory": "DETERIORATING",
  "action": "SHED",
  "reasonCode": "WARNING_SHED_RESORT",
  "explanation": "Resort was shed: it has the lowest criticality (20), and the island entered a warning state with battery at 56%.",
  "expectedOutcome": "Freeing up 250 kW of load protects the hospital and slows battery drawdown.",
  "resourceUpdates": {
    "hospital": {
      "id": "hospital",
      "name": "Hospital",
      "criticality": 100,
      "maxDemandKw": 40,
      "minimumOperatingPct": 100,
      "operatingPct": 100,
      "currentDemandKw": 40,
      "state": "PROTECTED",
      "throttleable": false,
      "shedCapable": false
    },
    "resort": {
      "id": "resort",
      "name": "Resort",
      "criticality": 20,
      "maxDemandKw": 250,
      "minimumOperatingPct": 0,
      "operatingPct": 0,
      "currentDemandKw": 0,
      "state": "SHED",
      "throttleable": false,
      "shedCapable": true
    },
    "residential": {
      "id": "residential",
      "name": "Residential",
      "criticality": 70,
      "maxDemandKw": 400,
      "minimumOperatingPct": 20,
      "operatingPct": 100,
      "currentDemandKw": 400,
      "state": "NORMAL",
      "throttleable": false,
      "shedCapable": true
    },
    "desalination": {
      "id": "desalination",
      "name": "Desalination",
      "criticality": 90,
      "maxDemandKw": 120,
      "minimumOperatingPct": 30,
      "operatingPct": 100,
      "currentDemandKw": 120,
      "state": "NORMAL",
      "throttleable": true,
      "shedCapable": false
    }
  }
}
```

---

## Decision-engine folder layout (Phase 1)

```
src/types/nimbus.ts                  shared contract (all consumers)
src/lib/constants/thresholds.ts      all tunable prototype parameters
src/lib/engine/
  calculateEnergyMetrics.ts          net power, EMA filter, velocity, acceleration
  detectTrajectory.ts                trajectory + severity classification
  resources.ts                       clamp/round/resource-update helpers
  runController.ts                   dispatcher + hospital safety guard
  examples/fixtures.ts               Phase 1 example island states
  examples/runExamples.ts            one-call scenario runner
src/lib/controllers/
  naiveController.ts
  reactiveController.ts
  nimbusController.ts
src/lib/explainability/
  decisionExplanation.ts             plain-English explanation builder
docs/contracts/telemetry-contract.md this document
```

## Tunable prototype parameters

All thresholds live in `src/lib/constants/thresholds.ts` as named constants:

- Naive: resort shed at battery < 30%, residential reduce at < 20%.
- Reactive: shed band (25% → restore at 40%), net-power triggers.
- Nimbus: watch/warning/critical battery lines (45/30/20), target surplus (+15 kW), trajectory velocity/acceleration lines (-2 / -8 kW/s), desalination PD gains (P 0.35, D 0.9), min operating 30%, max step 5%/tick.
- EMA alphas: net power 0.30, velocity 0.20, acceleration 0.15; warmup 5 ticks.

These are deliberately named constants so tuning is one-file, deterministic, and demoable.

## Open items for the team

- Write-back loop for `filteredNetPowerKw`/`velocityKwS`/`accelerationKwS2` (engine → backend → next `IslandState`) is Phase 2.
- Controller-mode switching UX (how the dashboard requests a controller) — owned by backend/dashboard.