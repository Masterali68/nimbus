"""
Nimbus Phase 2 — Hysteresis and load-shedding state machines.

Implements the resort and residential state machines:

    NORMAL -> SHED/REDUCED -> COOLDOWN -> RESTORING -> NORMAL

and the shared recovery gate that stops rapid shed / restore / shed flapping
and staggers restoration so resources do not all reconnect at once.

Restoration is a RAMP (RESTORATION_RAMP_PCT_PER_TICK), never a large step, so
bringing a load back can never itself read as a new collapse. The COOLDOWN
counter only counts down while recovery conditions hold, which guarantees a
sustained stable window before restoration is even allowed to begin.
"""

STATE_NORMAL = "NORMAL"
STATE_SHED = "SHED"
STATE_REDUCED = "REDUCED"
STATE_COOLDOWN = "COOLDOWN"
STATE_RESTORING = "RESTORING"

EVENT_NONE = "NONE"
EVENT_SHED = "SHED"
EVENT_REDUCED = "REDUCED"
EVENT_ENTER_COOLDOWN = "ENTER_COOLDOWN"
EVENT_COOLDOWN_HOLD = "COOLDOWN_HOLD"
EVENT_ENTER_RESTORING = "ENTER_RESTORING"
EVENT_RESTORING_HOLD = "RESTORING_HOLD"
EVENT_RESTORED = "RESTORED"


def _resource_out(resource, state, pct, cooldown=0):
    out = dict(resource)
    out["state"] = state
    out["operatingPct"] = round(pct, 1)
    out["currentDemandKw"] = round(resource.get("maxDemandKw", 0.0) * pct / 100.0, 1)
    out["cooldownTicksRemaining"] = max(int(cooldown), 0)
    out.pop("restoreHoldTicksRemaining", None)
    return out


def recovery_ok(battery_pct, trajectory, filtered_net_power_kw, recovery_line_pct, cfg=None):
    """Strict gate: sustained stable/improving balance before restoration begins
    (used for cooldown countdown and entering RESTORING)."""
    cfg = cfg if cfg is not None else _mod()
    return (
        battery_pct >= recovery_line_pct
        and trajectory in ("STABLE", "IMPROVING")
        and filtered_net_power_kw >= cfg.RESTORE_SURPLUS_KW
    )


def restoring_ok(battery_pct, trajectory, filtered_net_power_kw, recovery_line_pct, cfg=None):
    """Looser gate used once a ramp is already running: battery is adequate,
    filtered balance is above the surplus line, and the island is not critical.
    Without this, the ramp's own load steps keep re-labelling the balance
    DETERIORATING and restoration would starve despite ample headroom."""
    cfg = cfg if cfg is not None else _mod()
    return (
        battery_pct >= recovery_line_pct
        and trajectory != "CRITICAL"
        and filtered_net_power_kw >= cfg.RESTORE_SURPLUS_KW
    )


def resort_shed_trigger(severity, battery_pct, cfg=None):
    cfg = cfg if cfg is not None else _mod()
    return severity == "CRITICAL" or (
        severity == "WARNING" and battery_pct <= cfg.WARNING_BATTERY_PCT
    )


def residential_reduce_trigger(severity, battery_pct, resort_handled, cfg=None):
    cfg = cfg if cfg is not None else _mod()
    if severity == "CRITICAL":
        return True
    return (
        severity == "WARNING"
        and resort_handled
        and battery_pct <= cfg.NIMBUS_RESIDENTIAL_REDUCE_BATTERY_PCT
    )


def advance_resort(resource, trigger, battery_pct, trajectory, filtered_net_power_kw, cfg=None):
    """
    Advance the resort state machine one tick. Returns (new_resource, event).

    The trigger flag asks the machine to shed (or keep shed). Restoration only
    happens through COOLDOWN -> RESTORING and never immediately after a shed.
    """
    cfg = cfg if cfg is not None else _mod()
    state = resource.get("state", STATE_NORMAL)
    cooldown = int(resource.get("cooldownTicksRemaining", 0) or 0)

    if trigger:
        return _resource_out(resource, STATE_SHED, 0.0, cfg.RESORT_COOLDOWN_TICKS), EVENT_SHED

    if state == STATE_SHED:
        return _resource_out(resource, STATE_COOLDOWN, 0.0, cfg.RESORT_COOLDOWN_TICKS), EVENT_ENTER_COOLDOWN

    if state == STATE_COOLDOWN:
        if not recovery_ok(
            battery_pct, trajectory, filtered_net_power_kw, cfg.RESORT_RECOVERY_BATTERY_PCT, cfg
        ):
            return _resource_out(resource, STATE_COOLDOWN, 0.0, cooldown), EVENT_COOLDOWN_HOLD
        remaining = cooldown - 1
        if remaining > 0:
            return _resource_out(resource, STATE_COOLDOWN, 0.0, remaining), EVENT_COOLDOWN_HOLD
        return (
            _resource_out(resource, STATE_RESTORING, resource.get("operatingPct", 0.0), 0),
            EVENT_ENTER_RESTORING,
        )

    if state == STATE_RESTORING:
        if not restoring_ok(
            battery_pct, trajectory, filtered_net_power_kw, cfg.RESORT_RECOVERY_BATTERY_PCT, cfg
        ):
            return _resource_out(resource, STATE_RESTORING, resource.get("operatingPct", 0.0), 0), EVENT_RESTORING_HOLD
        new_pct = min(resource.get("operatingPct", 0.0) + cfg.RESTORATION_RAMP_PCT_PER_TICK, 100.0)
        if new_pct >= 100.0:
            return _resource_out(resource, STATE_NORMAL, 100.0, 0), EVENT_RESTORED
        return _resource_out(resource, STATE_RESTORING, new_pct, 0), EVENT_RESTORING_HOLD

    return _resource_out(resource, STATE_NORMAL, 100.0, 0), EVENT_NONE


def advance_residential(resource, trigger, battery_pct, trajectory, filtered_net_power_kw, cfg=None):
    """
    Advance the residential state machine one tick. Returns (new_resource, event).
    Reduces to a fixed step, then ramps back through COOLDOWN -> RESTORING.
    """
    cfg = cfg if cfg is not None else _mod()
    state = resource.get("state", STATE_NORMAL)
    cooldown = int(resource.get("cooldownTicksRemaining", 0) or 0)

    if trigger:
        return (
            _resource_out(resource, STATE_REDUCED, cfg.RESIDENTIAL_REDUCED_OPERATING_PCT, cfg.RESIDENTIAL_COOLDOWN_TICKS),
            EVENT_REDUCED,
        )

    if state == STATE_REDUCED:
        return (
            _resource_out(resource, STATE_COOLDOWN, cfg.RESIDENTIAL_REDUCED_OPERATING_PCT, cfg.RESIDENTIAL_COOLDOWN_TICKS),
            EVENT_ENTER_COOLDOWN,
        )

    if state == STATE_COOLDOWN:
        if not recovery_ok(
            battery_pct, trajectory, filtered_net_power_kw, cfg.RESIDENTIAL_RECOVERY_BATTERY_PCT, cfg
        ):
            return _resource_out(resource, STATE_COOLDOWN, resource.get("operatingPct", 80.0), cooldown), EVENT_COOLDOWN_HOLD
        remaining = cooldown - 1
        if remaining > 0:
            return _resource_out(resource, STATE_COOLDOWN, resource.get("operatingPct", 80.0), remaining), EVENT_COOLDOWN_HOLD
        return (
            _resource_out(resource, STATE_RESTORING, resource.get("operatingPct", 80.0), 0),
            EVENT_ENTER_RESTORING,
        )

    if state == STATE_RESTORING:
        if not restoring_ok(
            battery_pct, trajectory, filtered_net_power_kw, cfg.RESIDENTIAL_RECOVERY_BATTERY_PCT, cfg
        ):
            return _resource_out(resource, STATE_RESTORING, resource.get("operatingPct", 80.0), 0), EVENT_RESTORING_HOLD
        new_pct = min(resource.get("operatingPct", 80.0) + cfg.RESTORATION_RAMP_PCT_PER_TICK, 100.0)
        if new_pct >= 100.0:
            return _resource_out(resource, STATE_NORMAL, 100.0, 0), EVENT_RESTORED
        return _resource_out(resource, STATE_RESTORING, new_pct, 0), EVENT_RESTORING_HOLD

    return _resource_out(resource, STATE_NORMAL, 100.0, 0), EVENT_NONE


def _mod():
    import controller_config

    return controller_config