"""
Nimbus Phase 2 — Controller configuration.

All tunable constants for the decision engine live here so the simulator,
the FastAPI backend, and the dashboard stay aligned around one file.

NOTE: These are PROTOTYPE TUNING PARAMETERS for a hackathon simulation.
They are deliberately named and isolated so the team can re-tune behaviour
in one place. They are NOT scientifically optimal or universal values, and
they must NOT be used to make claims about real-world energy systems.
"""

# --- Simulation timing -------------------------------------------------------

# Seconds represented by one simulation tick. The contract assumes 1 Hz ticks.
TICK_INTERVAL_SECONDS = 1.0


# --- EMA filtering (energy-balance smoothing) --------------------------------

# Smoothing factors (alpha) for the exponential moving averages. Lower = smoother
# but slower to react; higher = more responsive but noisier.
EMA_FILTER_ALPHA = 0.30          # net power EMA
EMA_VELOCITY_ALPHA = 0.20        # velocity EMA
EMA_ACCELERATION_ALPHA = 0.15    # acceleration EMA
EMA_WARMUP_TICKS = 5             # ticks before filtering is considered reliable


# --- Nimbus crisis thresholds ------------------------------------------------

# Battery level bands (percent of capacity).
WATCH_BATTERY_PCT = 45.0     # below this -> early awareness (WATCH)
WARNING_BATTERY_PCT = 30.0   # below this -> escalating (WARNING)
CRITICAL_BATTERY_PCT = 20.0  # below this -> emergency (CRITICAL)

# Energy-balance reference and trajectory lines.
TARGET_NET_POWER_KW = 15.0          # controller tries to hold a small surplus so the battery charges
WATCH_NET_POWER_KW = -5.0           # filtered net power below this -> WATCH
DETERIORATING_VELOCITY_KWS = -2.0   # balance falling faster than this per second -> DETERIORATING
CRITICAL_VELOCITY_KWS = -8.0        # balance collapsing at this rate -> CRITICAL
IMPROVING_VELOCITY_KWS = 3.0        # balance climbing faster than this per second -> IMPROVING
CRITICAL_ACCELERATION_KWS2 = -2.0   # velocity falling faster than this -> CRITICAL
# Fast decline only counts as an emergency once the island is actually in
# deficit (net power at or below this). A steep but still-positive drop is
# DETERIORATING — a warning, not a reason to shed through a deliberate ramp.
CRITICAL_NET_POWER_KW = 0.0


# --- Desalination PD control ------------------------------------------------

# Safe operating band. Desalination is throttled smoothly, never abruptly switched off.
DESALINATION_MIN_OPERATING_PCT = 30.0
DESALINATION_MAX_OPERATING_PCT = 100.0
# Maximum change per tick. This is what turns "100% -> 0%" into "100% -> 95% -> 90% ...".
DESALINATION_MAX_STEP_PCT_PER_TICK = 5.0

# PD gains for the proportional-derivative controller.
PD_KP = 0.35                 # proportional gain on energy-balance error
PD_KD = 0.9                  # derivative gain on change in the same error
PD_MAX_CURTAIL_KW = 80.0     # hard cap on how much load the PD may ask desalination to drop


# --- Naive controller thresholds (battery only) ------------------------------

NAIVE_RESORT_SHED_BATTERY_PCT = 30.0        # battery below this -> shed resort
NAIVE_RESIDENTIAL_REDUCE_BATTERY_PCT = 20.0 # battery below this -> reduce residential


# --- Reactive controller thresholds (battery + net power) --------------------

REACTIVE_RESORT_SHED_BATTERY_PCT = 25.0        # shed resort below this
REACTIVE_RESORT_RESTORE_BATTERY_PCT = 40.0     # restore resort only above this
REACTIVE_RESIDENTIAL_REDUCE_BATTERY_PCT = 20.0 # reduce residential below this
REACTIVE_RESIDENTIAL_RESTORE_BATTERY_PCT = 40.0
REACTIVE_SHED_NET_POWER_KW = -10.0             # net power deficit severe enough to shed
REACTIVE_RESTORE_NET_POWER_KW = 5.0            # net power surplus needed before restoring


# --- Residential reduction ---------------------------------------------------

RESIDENTIAL_REDUCED_OPERATING_PCT = 80.0            # residential runs at this when reduced
# Nimbus only reduces residential below the warning line by this margin, so the
# resort (triggered at WARNING) is demonstrably handled first.
NIMBUS_RESIDENTIAL_REDUCE_BATTERY_PCT = 25.0


# --- Hysteresis / cooldown / restoration -------------------------------------

# Restoration only begins once these are satisfied for a sustained cooldown.
RESORT_RECOVERY_BATTERY_PCT = 40.0
RESIDENTIAL_RECOVERY_BATTERY_PCT = 45.0
RESORT_COOLDOWN_TICKS = 20      # resort held off after a shed
RESIDENTIAL_COOLDOWN_TICKS = 15 # residential held reduced after a reduction
RESTORE_SURPLUS_KW = 5.0        # filtered net power must be above this to allow restoration
# In RESTORING, load is ramped back up at this rate per tick so a restore step
# can never read as a new collapse (no rapid on/off, no all-at-once restore).
RESTORATION_RAMP_PCT_PER_TICK = 5.0


# --- Safety ------------------------------------------------------------------

MIN_BATTERY_PCT = 0.0
MIN_OPERATING_PCT = 0.0
MAX_OPERATING_PCT = 100.0
HOSPITAL_CRITICALITY = 100

# Stable keys shared with the telemetry contract.
SEVERITY_LEVELS = ("STABLE", "WATCH", "WARNING", "CRITICAL")
TRAJECTORY_LEVELS = ("STABLE", "IMPROVING", "DETERIORATING", "CRITICAL")
RESOURCE_STATES = ("PROTECTED", "NORMAL", "THROTTLED", "REDUCED", "SHED", "COOLDOWN", "RESTORING")