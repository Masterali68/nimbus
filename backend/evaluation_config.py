"""
Nimbus Phase 3 — Evaluation configuration.

All tunable constants for metric computation and the prototype Nimbus score
live here so the evaluation harness, the FastAPI backend, and the dashboard
stay aligned around one file.

IMPORTANT: The Nimbus Score is a PROTOTYPE EVALUATION METRIC for a hackathon
demonstration. The weights below are demonstration priorities, NOT a
scientifically optimal or universally applicable weighting scheme. They must
not be used to make claims about real-world energy systems.
"""

from controller_config import TICK_INTERVAL_SECONDS as _DT

# --- Simulation / recording -------------------------------------------------

# Simulation timestep in seconds. Metric functions that integrate energy over
# time use this to convert tick counts into kWh and seconds.
TICK_INTERVAL_SECONDS = _DT

# Number of decimal places used when rounding metric outputs.
METRIC_ROUND_DIGITS = 3


# --- Metric definitions -----------------------------------------------------

# Hospital is "operational" while its operating percentage is AT OR ABOVE this
# level. The engine's safety guard unconditionally keeps the hospital at 100%,
# so this floors at 100 by default; the threshold is kept configurable so a
# degraded-hospital experiment can be represented without hardcoding.
HOSPITAL_OPERATIONAL_PCT = 100.0

# Percentage band within which a resource's percentage is considered "not
# meaningfully different" from full operating level. Used to avoid counting
# trivial sub-percent changes as shedding/restore events.
MEANINGFUL_STATE_DELTA_PCT = 1.0

# Desalination operating range (must match controller_config safe band).
DESALINATION_MIN_OPERATING_PCT = 30.0
DESALINATION_MAX_OPERATING_PCT = 100.0

# Maximum allowed single-tick change in desalination operating percentage
# (must match DESALINATION_MAX_STEP_PCT_PER_TICK). Used by the smoothness check.
DESALINATION_MAX_STEP_PCT_PER_TICK = 5.0


# --- Stable recovery definition ---------------------------------------------

# A scenario is considered "recovered" when ALL of the following hold for
# recovery window conditions and no new disturbance begins:
#   - resort.state == NORMAL and operatingPct == 100.0
#   - residential.state == NORMAL
#   - desalination operatingPct >= WATER_RECOVERED_PCT
#   - batteryPct >= RECOVERY_BATTERY_PCT
#   - trajectory in (STABLE, IMPROVING)
#   - filteredNetPowerKw >= RECOVERY_SURPLUS_KW

# Minimum battery percentage considered "recovered" from a disturbance.
RECOVERY_BATTERY_PCT = 40.0

# Battery percentage below which a scenario is considered to have "low initial
# battery" (a stress scenario in the comparison suite).
LOW_INITIAL_BATTERY_PCT = 25.0

# Minimum filtered net power surplus required for recovery (kW).
RECOVERY_SURPLUS_KW = 5.0

# Desalination operating percentage considered "recovered" from throttling.
WATER_RECOVERED_PCT = 90.0


# --- Shedding events --------------------------------------------------------

# A resource state transition is counted as a "shedding event" when the
# resource enters SHED, or enters REDUCED and drops AT LEAST this many
# percentage points from its prior operating level (so a 100% -> 80%
# residential reduction counts, but noise-level wobble does not).
SHED_EVENT_MIN_DROP_PCT = 10.0


# --- Critical-service interruption ------------------------------------------

# Major score penalty applied if the hospital is ever interrupted
# (operatingPct < HOSPITAL_OPERATIONAL_PCT for any tick).
INTERRUPTION_SCORE_PENALTY = 100.0


# --- Prototype Nimbus Score weights -----------------------------------------

# Weights multiply each normalized (0..1) sub-score. Positive weights reward
# the corresponding term; negative weights penalize it. The sub-scores are
# scaled so each lies in [0,1] before weighting, then the weighted sum is scaled
# to a 0..100 point scale.

# Rewards (higher sub-score is better for these).
W_CRITICAL_UPTIME = 30.0   # critical-service uptime, 0..1
W_WATER = 15.0             # water availability, 0..1
W_BATTERY = 15.0           # minimum battery preservation, 0..1
W_RECOVERY = 10.0          # recovery speed (inverse of time), 0..1

# Penalties (higher sub-score is worse for these; weight is applied to a
# 1 - normalized-worst term so a zero penalty contributes the full weight).
W_SHED = -10.0             # total load shed, kWh normalized 0..1
W_EVENTS = -10.0           # shedding-event count normalized 0..1
W_INSTABILITY = -10.0      # instability / oscillation index normalized 0..1

# The critical-service interruption penalty is separate and dominant: if any
# interruption occurs, the score is floored to 0 regardless of other terms.
INTERRUPTION_FLOORS_SCORE = True
