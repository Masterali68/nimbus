# Nimbus Phase 2 — Decision Engine Behaviour

Status: **Phase 2 — working prototype, all tests green (26/26).**

Ownership: Ali (decision engine). Callers: the FastAPI backend (Vishruth) calls
`run_controller(state)` once per tick. Contract types stay in
`src/types/nimbus.ts`; this document describes how the engine actually behaves
and, where noted, the small extensions the engine introduces.

Entry point: `backend/controller.py::run_controller(state, cfg=None)`.
All tunable constants: `backend/controller_config.py`.

---

## 1. Memory model (write-back loop)

The engine is **stateless by design**. All memory rides inside `IslandState`:

- `filteredNetPowerKw`, `velocityKwS`, `accelerationKwS2` — previous tick's
  engine output. The engine reads them as the EMA recursion base and returns
  fresh values in `decision.metrics`; the backend must write those back into the
  next `IslandState` for the filter to stay consistent.
- `resources[*].state` — the hysteresis state machine is stored per resource.
- `resources[*].cooldownTicksRemaining` — remaining hold ticks.

If the previous metrics are missing or `NaN`, the filter re-seeds from the raw
value and reports `warmupComplete: false` until `EMA_WARMUP_TICKS` ticks.

### Contract extensions (flag to the team)

The engine emits two things not present in the Phase 1 `ResourceState`/contract:

1. `resources[*].state == "RESTORING"` — a resource is ramping back up toward
   `NORMAL` after a shed/reduction. TS `ResourceState` does not list it; add it
   please (dashboard can style it distinctly).
2. `resources[*].cooldownTicksRemaining` — how many hold ticks remain before a
   shed/reduced resource may enter `RESTORING`.

`resourceUpdates` in a Nimbus decision always contains all three manageable
resources (resort, residential, desalination); hospital is always present and
always `PROTECTED`. Naive/reactive manage resort/residential and leave
desalination unchanged.

---

## 2. Energy-balance analysis

Every controller (naive/reactive/nimbus) computes the same metrics:

```
netPowerKw         = solarKw + windKw - totalDemandKw
filteredNetPowerKw = EMA_ALPHA * netPowerKw + (1 - EMA_ALPHA) * prevFiltered
velocityKwS        = EMA(d(filtered)/dt)
accelerationKwS2   = EMA(d(velocity)/dt)
```

All quantities are the *live* short-term balance, not a weather forecast.

**Trajectory labels:**

- `CRITICAL` if battery ≤ 20% **or** the island is in deficit (`netPowerKw ≤ 0`)
  *and* the balance is collapsing fast (velocity ≤ -8 kW/s, or velocity falling
  faster than -2 kW/s² while declining).
- `IMPROVING` if velocity ≥ +3 kW/s, `DETERIORATING` if velocity ≤ -2 kW/s,
  otherwise `STABLE`.

Why the deficit gate? A fast measured decline is not itself an emergency — a
deliberate restore ramp reconnecting resort load also dips net power fast but
with a large positive surplus. Treating that as `CRITICAL` made the controller
shed the very load it was restoring (flapping). So steep-but-positive declines
are `DETERIORATING` (a warning); emergencies require an actual deficit (net ≤ 0)
or critical battery. The acceleration guard is additionally shape-gated: a large
negative acceleration only counts when velocity is also declining.

**Severity bands** tie trajectory + battery to actions: `STABLE`, `WATCH`
(battery ≤ 45 or filtered < -5), `WARNING` (DETERIORATING / battery ≤ 30 /
filtered ≤ -5), `CRITICAL`.

---

## 3. Priority cascade

`hospital > desalination > residential > resort`, decided each tick by the
state machines in `backend/hysteresis.py`:

1. **Hospital** — never dispatched or shed. Always `PROTECTED` at 100%.
2. **Desalination (PD control)** — throttled smoothly, never switched:
   `error = TARGET_NET_POWER_KW - filteredNetPowerKw`, PD gains P=0.35 / D=0.9,
   output clamped to [30, 100]%, rate-limited to 5%/tick. Because
   `PD_MAX_CURTAIL_KW = 80` on a 120 kW plant, the PD's floor is ≈33% (it
   saturates above the 30% clamp); the absolute floor is still 30%.
3. **Resort** — shed at `CRITICAL`, or at `WARNING` with battery ≤ 30%.
4. **Residential** — reduced to 80% at `CRITICAL`, or at `WARNING` + resort
   already handled + battery ≤ 25%. This guarantees resort-before-residential.

---

## 4. Hysteresis state machines

Same shape for resort (shed) and residential (reduce):

```
NORMAL -> SHED/REDUCED -> COOLDOWN -> RESTORING -> NORMAL
```

- **SHED / REDUCED**: immediate on trigger; resort → 0%, residential → 80%.
- **COOLDOWN**: the resource is held off while a `cooldownTicksRemaining` counter
  (resort 20, residential 15) counts down. The counter **only** counts down while
  the strict recovery gate holds: battery ≥ recovery line (resort 40 / residential
  45), trajectory `STABLE`/`IMPROVING`, and filtered net power ≥ +5 kW. If the
  island re-deteriorates, the counter pauses (and a `CRITICAL` re-sheds
  immediately). This kills rapid shed/restore toggling.
- **RESTORING**: the resource ramps back up at `RESTORATION_RAMP_PCT_PER_TICK`
  (5%/tick), reaching 100% before `NORMAL`. A restore step can never read as a
  new collapse, and load never reconnects all at once. During a running ramp a
  looser gate applies (battery ≥ recovery line, filtered ≥ +5 kW, trajectory not
  `CRITICAL`); otherwise the ramp's own load steps permanently re-flag the now-
  positive balance as `DETERIORATING` and restoration starves.
- **Trigger during RESTORING**: aborts the ramp back to `SHED`/`REDUCED`
  (cooldown restarts).

**Resulting demo behaviour** (covered by tests): shed once, hold off during
cooldown, ramp up gradually to NORMAL — never flapping, never all-at-once.

---

## 5. Decisions

Every tick produces a `NimbusDecision`: `severity`, `trajectory`, `action`
(`NONE/PROTECT/THROTTLE/REDUCE/SHED/RESTORE/COOLDOWN`), `reasonCode`, plain-
English `explanation` and `expectedOutcome` (built with live numbers in
`backend/explainability.py`), full `resourceUpdates`, and the write-back
`metrics` block.

Safety guard: after any controller runs, hospital is forced to `PROTECTED`/100%
and every operating percentage is clamped to [0, 100].

---

## 6. File layout

```
backend/
  controller.py            run_controller + metrics, trajectory, severity,
                           PD desalination, dispatch, safety guard
  hysteresis.py            state machines + triggers + recovery gates
  controller_config.py     every tunable constant (prototype parameters)
  explainability.py        explanation / expectedOutcome builder
  requirements.txt         python deps (pytest for tests)
  pytest.ini               pythonpath/test config so tests run in-repo
  tests/test_controller.py 26 tests (stable island, storms, surge, water
                           emergency, compound crisis, cooldown/flapping,
                           gradual restoration, PD smoothness, all modes)
docs/controller-behavior.md  this document
```

Run tests:

```
cd backend && .venv/bin/python -m pytest tests -q
```

## 7. Prototype caveats

- Parameters in `controller_config.py` are hackathon tuning values, not
  scientifically optimal or universal.
- `velocityKwS`/`accelerationKwS2` describe the balance's short-term shape only;
  no weather/power forecasting.
- The engine is a recommendation engine for the simulator's physics: it decides
  load shedding/throttling. Actual battery energy and recharge physics remain the
  simulation's job (Lalith).