# Nimbus Simulation Engine

This module **is the island** — a deterministic, tick-based simulation of a virtual island's
energy and water system. Other Nimbus modules (control/optimizer, dashboard/UI, alerting,
scoring) should depend **only** on `api/simulationApi.ts` and `types.ts`. Internal model files
(`models/`, `constraints/`, `events/`) are implementation details and may change without notice.

## Getting state

```ts
import { simulationApi } from "@/simulation/api/simulationApi";

const state = simulationApi.getCurrentState(); // IslandState snapshot
const lastHour = simulationApi.getHistory(60); // last 60 ticks (minutes, at the default tick rate)
```

`simulationApi` is a ready-to-use client-side singleton. If you need an independent instance
(e.g. for a test, or a second concurrent simulation), use `createSimulationApi(config?)` instead.

## Advancing time

The engine is **pull-based**: nothing advances on its own unless you drive it.

```ts
simulationApi.tick(); // advance one tick synchronously
simulationApi.tick(60); // advance 60 ticks synchronously (e.g. a simulated hour)
```

For a live UI, drive it in real time instead:

```ts
useEffect(() => {
  simulationApi.startAutoTick(60); // 60 simulated minutes per real second
  return () => simulationApi.stopAutoTick();
}, []);
```

## Subscribing to updates

```ts
const unsubscribe = simulationApi.subscribe((state, meta) => {
  // called synchronously at the end of every tick() call
});
```

## Triggering events

```ts
simulationApi.injectEvent("storm"); // probabilistic severity, rolled from the current seed
simulationApi.injectEvent("storm", { forceCompound: true }); // guarantees correlated child events
```

See `demo/scenarios.ts` for scripted, fully-reproducible named scenarios ("calm day", "storm at
dusk", "compound crisis") built entirely out of `injectEvent` calls at fixed ticks.

## Writing to the simulation: `applyControlAction`

This is the **only** way another module may write to the simulation — there is no other mutation
path. Every call returns a `ControlActionResult` (`{ accepted, reason?, violations }`); always
check `accepted` before assuming the action took effect (e.g. `load.shed` on `"hospital"` is
always rejected).

```ts
simulationApi.applyControlAction({
  type: "battery.setChargeRate",
  requestedKw: -150, // negative = discharge
  source: "optimizer-v1",
});
```

**Important contract — read this before building a control/optimizer module:** a
`"battery.setChargeRate"` / `"battery.hold"` action is consumed on the **very next tick only**.
If your module does not queue a fresh battery `ControlAction` on every single tick, the engine's
default auto-dispatch heuristic (charge from surplus / discharge to cover deficit / hold inside a
deadband) silently takes over for every tick with no queued action — including gap ticks if you
only act intermittently (e.g. every 5 ticks, or only on state changes). That is intended
behavior, not a bug, but it is easy to be surprised by if you only send actions occasionally and
then wonder why the battery trace doesn't match your last command. Load-shed and
`desalination.curtail` actions, by contrast, are **standing state**: once issued, they persist
until an explicit `"load.restore"`.

## Controllers

Every tick, an **active controller** (`config.controllers.activeControllerType`, default `"nimbus"`)
decides each resource's `operatingPct`/`state` *before* `applyControlAction` overrides are applied
— this replaces the old "raw heuristic only" default. Two controllers ship in this build:

- `"naive"` — cheapest possible baseline: raw battery-% thresholds only, binary (0% or 100%) shed
  decisions on resort/residential, no proactive throttling of anything else.
- `"nimbus"` — the actual product: hospital always protected → desalination continuously
  PD-throttled toward a trajectory-aware target → residential coarsely reduced (never fully shed)
  → resort fully shed as a last resort, via a hysteresis state machine. Restoration is sequential
  (residential must be back to `NORMAL` before resort is even eligible to restore) — never
  simultaneous.

`applyControlAction` still works exactly as documented above — it's a one-tick **override** on
top of whatever the active controller decided that same tick, not a replacement for having a
controller at all.

Every `IslandState` also carries:
- `energyBalance` — an EMA-smoothed net-power trend (`velocityKwPerS`/`accelerationKwPerS2`/
  `trajectory: "STABLE"|"IMPROVING"|"DETERIORATING"`), computed from **unconstrained** demand so it
  reflects the underlying physical situation, not the controller's own corrective actions.
- `latestDecisions` — `Decision[]`, populated only on ticks where a resource's control state
  actually changes, each with a `reasonDetail: string[]` written in plain language for a "Why?"
  panel — no control-theory jargon required to read it.

A `"reactive"` controller type exists in the type system (`ControllerType`) but has **no
implementation in this build** — constructing an engine with `activeControllerType: "reactive"`
throws immediately. The automated 100+-scenario evaluation harness and the dashboard described in
the product spec are also out of scope for this build; see the plan file's addendum for what's
deferred and why.

## Climate presets

Every physical constant in `config.ts` is grounded in a published real-world benchmark (cited
inline as a comment next to the value — turbine cut-in/rated/cut-out speeds, SWRO desalination
kWh/m³, Tesla Megapack round-trip efficiency and C-rate, EIA household consumption, hotel/hospital
energy-intensity benchmarks, trade-wind/coastal wind-resource studies, etc.), not arbitrary
numbers. `DEFAULT_CONFIG` is one specific profile — a tropical trade-wind island — among four in
`climates.ts`:

```ts
import { createConfigForClimate, CLIMATE_PRESETS } from "@/simulation/climates";
import { createSimulationApi } from "@/simulation/api/simulationApi";

const config = createConfigForClimate("arid-desert-coast", mySeed);
const api = createSimulationApi(config);
```

- `"tropical-trade-wind-island"` — near-equator, low seasonal swing, humid baseline cloud, steady trade winds.
- `"arid-desert-coast"` — very low cloud/high solar yield, AC-heavy demand, rare storms, frequent water emergencies.
- `"temperate-coastal"` — strong seasonal solar swing, cloudier baseline, strong reliable coastal wind, frequent storms.
- `"monsoon-tropical"` — heavy wet-season cloud, gusty wind, frequent/severe cyclone-season storms.

Climate only changes the environmental *resource* (solar/wind/cloud statistics, event frequencies,
some demand-shape parameters) — the wind turbine's hardware power curve (cut-in/rated/cut-out) is
identical across every preset, since that's equipment, not weather. `CLIMATE_PRESETS` also carries
a `label`/`description` per preset for a future picker UI.

## Determinism

Every `SimulationEngine`/`SimulationApi` instance is fully deterministic given `config.seed`:
identical seed + identical sequence of `tick()`/`injectEvent()` calls always produces identical
`IslandState` history. This is what makes `demo/scenarios.ts` reliable for a live demo.
