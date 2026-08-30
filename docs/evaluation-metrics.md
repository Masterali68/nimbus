# Nimbus Phase 3 — Evaluation Metrics & Fair Controller Comparison

**Status:** Phase 3 — metric + comparison harness implemented, tests green.
**Owner:** Ali (decision engine / metrics).
**Entry points:** `backend/evaluation_metrics.py`, `backend/evaluation_config.py`.
**Callers:** the FastAPI evaluation runner (Vishruth) and the evaluation UI (Adith).

This document defines, for each evaluation metric: its **units**, its
**formula/definition**, what counts as **stable recovery**, what counts as a
**shedding event**, the **Nimbus Score disclaimer**, and the **fair-comparison
rules** that guarantee Naive, Reactive, and Nimbus are measured under identical
conditions.

---

## 1. Fair-comparison rules

All three controllers are measured on the **same scenario** and the **same
physics**, so the only thing that can differ between two runs of the same
scenario is each controller's own decision logic.

Every controller receives identical:
- **Initial island state** (same battery, same resource configuration, same
  nominal demand profile).
- **Event configuration** (same `activeEvent` label).
- **Event severity / magnitude** (same generation + demand trace over time).
- **Event duration** (same tick count).
- **Demand conditions** (same fixed demand curves).
- **Recovery conditions** (same post-event generation/demand recovery profile).
- **Simulation timestep** (1 second, `TICK_INTERVAL_SECONDS`).
- **Scenario seed** (deterministic — no randomness in the harness).

**Enforced by construction:** one shared `generation_trace` + `demand_trace`
drives every controller. The same deterministic `BatteryModel` integrates
post-decision net power for each controller. Any difference in `batteryPct`
over time is *caused by* the controller's decisions, not by differing physics.

**No fabrication, no tuning-to-win:**
- Metric functions compute from the actually recorded tick series.
- `compare_controllers` reports each controller's recorded values verbatim; it
  never adjusts a controller's numbers so it wins.
- If Nimbus performs *worse* on a scenario, that actual result is preserved and
  reported honestly (see §10).

---

## 2. Critical-service uptime

| | |
|---|---|
| **Units** | percent (0–100) |
| **Definition** | Percentage of scenario ticks where the hospital is operational, i.e. `hospital.operatingPct >= HOSPITAL_OPERATIONAL_PCT` (default 100). |

```
uptime_pct = (ticks where hospital.operatingPct >= 100) / total_ticks * 100
```

Because the engine's safety guard unconditionally keeps the hospital at 100%,
this is normally 100% for all three controllers. Its purpose in the comparison
is to confirm safety, and to surface any scenario where it is not met as a
headline finding.

---

## 3. Water availability

| | |
|---|---|
| **Units** | percent (0–100 of nominal desalination output) |
| **Definition** | Average desalination `operatingPct` over the scenario — a proxy for average water produced. |

```
water_availability_pct = mean(desalination.operatingPct over ticks)
```

Deliberate tradeoff: Nimbus throttles desalination (smoothly, within its safe
floor) to preserve the battery, so it may score **lower** on water during a
storm than a controller that leaves desalination at 100%. This is reported
honestly — the benefit shows up in battery preservation and stability.

---

## 4. Total load shed

| | |
|---|---|
| **Units** | kilowatt-hours (kWh) |
| **Definition** | Total flexible energy removed from residential + resort demand over the scenario, using the real timestep. |

```
load_shed_kwh = sum_t [ (residential.baselineMax - residential.currentDemandKw)
                      + (resort.baselineMax - resort.currentDemandKw) ]
                * (TICK_INTERVAL_SECONDS / 3600)
```

- `baselineMax` = the resource's nominal `maxDemandKw` (100% operating level).
- `currentDemandKw` = the recorded value each tick.
- Desalination throttling is **excluded** here; its cost appears in Water
  Availability instead.

A controller that sheds *less energy* but *flaps* (rapid on/off) is not
rewarded by this metric alone — that behavior is captured by the instability
index and shedding-event count.

---

## 5. Number of shedding events

| | |
|---|---|
| **Units** | count |
| **Definition** | Meaningful transitions into a discharged/reduced state — NOT one per tick. |

An event is counted when a flexible resource:
- **enters `SHED`**, or
- **enters `REDUCED`** and drops at least `SHED_EVENT_MIN_DROP_PCT` (10)
  percentage points from its previous operating level.

Consecutive ticks spent already shed/reduced are NOT recounted. This avoids
inflating the count with trivial per-tick noise and keeps it a measure of how
*often* the controller chooses to disrupt service.

---

## 6. Recovery time

| | |
|---|---|
| **Units** | seconds (and the underlying tick count) |
| **Definition** | Time from the first disturbance tick until **stable recovery** conditions are met. |

**First disturbance tick** `t0`: the first tick where any flexible resource
enters `SHED`/`REDUCED`, or `severity` becomes `WATCH` or worse.

**Stable recovery** `t1`: the first tick `>= t0` where **all** of the following
hold simultaneously:
- `resort.state == NORMAL` and `operatingPct == 100`
- `residential.state == NORMAL`
- `desalination.operatingPct >= WATER_RECOVERED_PCT` (90)
- `batteryPct >= RECOVERY_BATTERY_PCT` (40)
- `trajectory` is `STABLE` or `IMPROVING`
- `filteredNetPowerKw >= RECOVERY_SURPLUS_KW` (5)

```
recovery_time_s = (t1 - t0) * TICK_INTERVAL_SECONDS
```

If recovery is never reached before the end of the scenario, `t1` is reported
as the full remaining span (i.e. "not recovered").

---

## 7. Minimum battery percentage

| | |
|---|---|
| **Units** | percent (0–100) |
| **Definition** | Lowest `batteryPct` observed during the scenario. |

```
min_battery_pct = min(batteryPct over ticks)
```

Reflects how much battery reserve the controller protected through a
disturbance.

---

## 8. Energy-balance instability

| | |
|---|---|
| **Units** | index points (higher = more unstable) |
| **Definition** | A clear, documented prototype metric combining observable signs of an unstable controller. |

```
instability = resource_state_change_count
            + 0.5 * desalination_output_oscillations
            + 0.5 * net_power_zero_crossings
```

- **state_change_count**: total state transitions across resort + residential
  (a shed→restore cycle, or repeated flapping, adds to this).
- **desalination_output_oscillations**: number of times the sign of the
  desalination `operatingPct` per-tick change flips direction (up→down→up…).
- **net_power_zero_crossings**: number of times the filtered net power crosses
  from surplus to deficit or back (repeated overshoot).

Lower is better. This metric is what should expose a naive controller's abrupt
flapping versus Nimbus's cooldown + ramp behavior. It is a **prototype**
measure, not a scientific standard.

---

## 9. Critical-service interruption

| | |
|---|---|
| **Units** | boolean flag + interrupted-tick count |
| **Definition** | Any tick where `hospital.operatingPct < HOSPITAL_OPERATIONAL_PCT`. |

- `interrupted` is `True` if at least one tick is below the hospital
  operational level.
- `interrupted_ticks` counts how many such ticks occurred.
- In the Nimbus Score, an interruption **floors the score to 0** (a major
  penalty) because preserving critical service is the system's top requirement.

---

## 10. Prototype Nimbus Score

> **DISCLAIMER — READ THIS FIRST.**
> The Nimbus Score is a **prototype evaluation metric** for a hackathon
> demonstration. The weighting in `backend/evaluation_config.py` is a
> team-chosen preference, **not** a scientifically optimal or universally
> applicable score. It must not be used to make claims about real-world energy
> systems. The score is a *relative* decision-support number, always shown
> alongside its full breakdown and the raw metrics.

**Formula.** The score is a combined-fraction prototype on a 0–100 scale:

```
reward_score  = sum(reward_w_i * sub_i)     / sum(reward_w_i)   # 0..1
penalty_score = sum(|pen_w_j| * bad_j)      / sum(|pen_w_j|)    # 0..1
score         = clamp(reward_score * (1 - penalty_score), 0, 1) * 100
```

If a critical-service interruption occurs, the score is floored to 0.

**Rewarded terms** (higher `sub` is better):
- Critical-service uptime (0..1)
- Water availability (0..1)
- Battery preservation = `min_battery_pct / starting_battery_pct` (capped at 1)
- Recovery speed = `exp(-recovery_time_s / 180)` (faster recovery → closer to 1)

**Penalized terms** (`bad` is 0 at no disruption, 1 at maximum):
- Total load shed (0–250 kWh reference)
- Shedding-event count (0–10 reference)
- Instability index (0–40 reference)

The default weights live in `evaluation_config.py` and can be re-tuned there —
that is expected and documented, and is a *prototype* choice, not gaming, as
long as it is labeled as such.

**Breakdown.** `nimbus_score(trace)` returns, alongside the single `score`:
- `rewardScore`, `penaltyScore`
- `interrupted`, `interruptionPenaltyApplied`
- a per-term `breakdown` (group, weight, sub-score, contribution)
- the raw `metrics` dictionary
- a `disclaimer` string restating the prototype caveat

---

## 11. How repeated shed/restore actions are penalized

Repeated shed→restore→shed cycling is penalized in **two complementary ways**:

1. **Instability index**: each state transition contributes to
   `state_change_count`, and each oscillation in output or net-power sign
   adds more. A controller that toggles a resource on/off repeatedly accrues
   a higher index even if its total shed *energy* is similar.
2. **Shedding-event count**: each fresh transition into a shed/reduced state
   is counted, so repeated shedding is not free.

This is a mechanistically justified penalty (restarting/reshedding load has a
real cost — wear, disruption, slow recovery), applied uniformly to every
controller. It is not a rule invented to favor Nimbus.

---

## 12. How hospital interruption is handled

- Computed as a binary `interrupted` plus `interrupted_ticks` per run.
- In the score it is a **hard floor**: any interruption sets the score to 0.
- Reported as its own headline metric in the comparison table.
- Stress/validation tests confirm the engine's safety guard keeps the hospital
  protected across all controllers even under extreme inputs (NaN, very low
  battery, compound crisis).

---

## 13. Decision-quality checks

`evaluation_metrics.py` exposes boolean checks that validate controller
*behaviour*, not just outcomes:

- `hospital_never_shed(trace)` — hospital is always above its operational level.
- `resort_shed_before_residential(trace)` — resort is shed before residential
  is reduced (priority ordering).
- `desalination_within_band(trace)` — desalination stays in its safe operating
  range.
- `desalination_smooth(trace)` — no single-tick desalination change exceeds the
  configured ramp limit.
- `no_rapid_flapping(trace, resource)` — no rapid SHED→NORMAL→SHED cycling.
- `resource_restore_order(trace)` — residential reaches NORMAL before resort
  on recovery (reverse priority).
- `explanation_quality(decisions)` — Nimbus explanations carry: a
  trigger/reason, the protected resource (hospital), the action taken, and an
  expected outcome; and do not claim weather forecasting.

---

## 14. Test coverage

`backend/tests/test_evaluation_metrics.py` and
`backend/tests/test_controller_comparison.py` cover at least:

- Stable scenario (all controllers stay normal, no shed)
- Storm (hospital protected across controllers)
- Wind drop / generation loss
- Tourist surge (resort shed before residential)
- Water emergency (desalination in band)
- Compound crisis (all controllers survive with hospital safe)
- Long / no-recovery scenario
- Low initial battery
- High initial battery
- Resort shed before residential
- Hospital protection
- Score calculation + breakdown + interruption floor
- No fake metric values (metrics reflect only recorded values)
- Determinism (identical input → identical controller output & harness result)
- Honest comparison (if Nimbus is worse on a metric, the worse value is
  preserved and reported)

Run all tests:

```
cd backend && .venv/bin/python -m pytest tests -q
```

---

## 15. File layout (owned by Ali)

```
backend/
  evaluation_config.py       metrics config + prototype score weights
  evaluation_metrics.py      metric functions, battery model, quality checks,
                             fair-comparison harness
  tests/test_evaluation_metrics.py
  tests/test_controller_comparison.py
docs/evaluation-metrics.md   this document
```
