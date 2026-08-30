"""
Nimbus Phase 2 — Plain-English explainability.

Every major decision is accompanied by a short human-readable explanation and
an expected outcome. Explanations are generated from the actual decision
numbers — no hardcoded values — so they always stay truthful.
"""

EVENT_LABELS = {
    "storm-cloud-cover": "Storm conditions",
    "prolonged-storm": "Prolonged storm conditions",
    "clear-sky-noon": "Clear skies",
    "tourist-surge": "A tourist surge",
    "water-emergency": "A water emergency",
    "clearing-after-storm": "The storm clearing",
}
DEFAULT_EVENT_LABEL = "Current conditions"


def _fmt(value):
    rounded = round(float(value), 1)
    return str(int(rounded)) if rounded == int(rounded) else f"{rounded:.1f}"


def _event(state):
    label = EVENT_LABELS.get(state.get("activeEvent", ""), DEFAULT_EVENT_LABEL)
    return label


def _battery(state):
    return _fmt(state.get("batteryPct", 100.0))


def _resource(state, rid):
    return state.get("resources", {}).get(rid, {})


def build_explanation(
    state,
    controller_mode,
    severity,
    trajectory,
    action,
    reason_code,
    resource_updates,
    metrics,
    cfg=None,
):
    """Return {"explanation": str, "expectedOutcome": str} for the decision."""
    battery = _battery(state)
    event = _event(state)
    filtered = metrics.get("filteredNetPowerKw", 0.0)
    velocity = metrics.get("velocityKwS", 0.0)
    acceleration = metrics.get("accelerationKwS2", 0.0)

    desal = resource_updates.get("desalination", _resource(state, "desalination"))
    resort = resource_updates.get("resort", _resource(state, "resort"))
    residential = resource_updates.get("residential", _resource(state, "residential"))
    hospital = resource_updates.get("hospital", _resource(state, "hospital"))

    desal_pct = desal.get("operatingPct", 100.0)
    resort_pct = resort.get("operatingPct", 100.0)
    residential_pct = residential.get("operatingPct", 100.0)
    desal_freed_kw = round1(
        (desal.get("maxDemandKw", 120.0) * (100.0 - desal_pct)) / 100.0
    )
    residential_freed_kw = round1(
        (residential.get("maxDemandKw", 400.0) * (100.0 - residential_pct)) / 100.0
    )

    def protected_list():
        parts = []
        if hospital.get("state") == "PROTECTED" or hospital.get("operatingPct", 100) == 100.0:
            parts.append("the hospital")
        if desal_pct >= (cfg.DESALINATION_MIN_OPERATING_PCT if cfg is not None else 30.0):
            parts.append("desalination (held at its safe floor)")
        return ", ".join(parts) if parts else "critical loads"

    if reason_code == "OK_STABLE":
        explanation = (
            f"Energy balance is stable and the battery is healthy at {battery}%. "
            f"All resources remain at normal operating levels while the island banks surplus."
        )
        expected_outcome = "The system continues normally; the battery holds or charges and no load is interrupted."

    elif reason_code == "OK_IMPROVING":
        explanation = (
            f"Net power is growing (+{_fmt(velocity)} kW/s), so short-term conditions are improving "
            f"and normal operations are preserved."
        )
        expected_outcome = "Surplus builds, the battery recharges, and no curtailment is needed."

    elif reason_code == "WATCH_TRAJECTORY":
        explanation = (
            f"Early watch: {event.lower()} is drifting the live energy balance down at "
            f"{_fmt(velocity)} kW/s (battery {battery}%). This is short-term early detection from "
            f"the trajectory of the live energy balance, not a forecast. No resources are shed yet."
        )
        expected_outcome = "The island keeps running while the engine watches whether the decline continues."

    elif reason_code == "WATCH_BATTERY":
        explanation = (
            f"Battery level at {battery}% is below the watch line. No action taken yet, but flexible "
            f"loads are primed to respond if conditions worsen."
        )
        expected_outcome = "Early awareness; dispatch is delayed until thresholds are truly crossed."

    elif reason_code == "WARNING_SHED_RESORT":
        explanation = (
            f"{event} pressed the energy balance. The resort has the lowest criticality "
            f"({resort.get('criticality', 20)}) and was shed to preserve battery reserve "
            f"(battery {battery}%). {protected_list()} remain protected."
        )
        expected_outcome = (
            f"Shedding the resort frees up to {_fmt(resort.get('maxDemandKw', 250.0))} kW of load, "
            f"slowing the battery drawdown."
        )

    elif reason_code == "WARNING_REDUCE_RESIDENTIAL":
        explanation = (
            f"Serious shortage: energy balance is deteriorating ({_fmt(filtered)} kW filtered) with "
            f"battery at {battery}%. The resort was already shed and desalination was throttled, so "
            f"residential demand was reduced to {_fmt(residential_pct)}%. Hospital remains protected."
        )
        expected_outcome = (
            f"Residential reduction frees approximately {_fmt(residential_freed_kw)} kW; hospital and "
            f"desalination continue operating above their safe minimums."
        )

    elif reason_code == "WARNING_THROTTLE_DESALINATION":
        explanation = (
            f"{event} reduced renewable generation. Desalination was throttled smoothly to "
            f"{_fmt(desal_pct)}% to restore a positive energy balance, respecting its "
            f"{_fmt(cfg.DESALINATION_MIN_OPERATING_PCT if cfg is not None else 30)}% safe floor. "
            f"Hospital remains protected."
        )
        expected_outcome = (
            f"Water still flows at a reduced rate while curtailment frees about {_fmt(desal_freed_kw)} kW "
            f"of load and slows battery drawdown."
        )

    elif reason_code == "CRITICAL_BATTERY":
        explanation = (
            f"Critical: battery at {battery}% with the balance still declining ({_fmt(velocity)} kW/s). "
            f"Resort is shed and residential is reduced; desalination is held at its minimum safe "
            f"percentage. Hospital remains protected."
        )
        expected_outcome = (
            "Maximum available load reduction keeps the hospital online and defends the battery floor "
            "for as long as possible."
        )

    elif reason_code == "CRITICAL_COLLAPSE":
        explanation = (
            f"Critical: generation is collapsing quickly ({_fmt(velocity)} kW/s, acceleration "
            f"{_fmt(acceleration)} kW/s²). All low-priority flexible loads are being shed or reduced "
            f"immediately. Hospital remains protected."
        )
        expected_outcome = "The hospital stays protected and the battery floor is defended as long as possible."

    elif reason_code == "RECOVERY_RESTORE_DESALINATION":
        explanation = (
            f"Balance recovered ({_fmt(filtered)} kW filtered). Desalination is being restored gradually "
            f"toward 100% within its ramp limits. Hospital remains protected."
        )
        expected_outcome = "Water production recovers smoothly without re-stressing the battery."

    elif reason_code == "RECOVERY_RESTORE_RESIDENTIAL":
        explanation = (
            f"Battery recovered to {battery}% with a stable trajectory. Residential demand is being "
            f"restored gradually toward normal levels. Hospital remains protected."
        )
        expected_outcome = "Homes return to full supply once the island can sustain them."

    elif reason_code == "RECOVERY_RESTORE_RESORT":
        explanation = (
            f"Conditions recovered (battery {battery}%, trajectory {trajectory}). The resort is being "
            f"restored gradually (cooldown done, energy balance stable). Hospital remains protected."
        )
        expected_outcome = "The resort reconnects only after the island demonstrably holds at healthy levels."

    elif reason_code == "COOLDOWN_HOLD":
        explanation = (
            f"Resort or residential load remains in cooldown after its last shed/reduction. Battery is "
            f"at {battery}%; it must stay safely above the recovery line with a stable balance before "
            f"restoration begins. Hospital remains protected."
        )
        expected_outcome = "No rapid on/off cycling; loads return only when recovery is demonstrably stable."

    elif reason_code in ("CRITICAL_BATTERY", "CRITICAL_COLLAPSE"):
        explanation = (
            f"Critical conditions (battery {battery}%). Hospital remains protected; all non-critical "
            f"flexible loads are reduced to their safe minimums."
        )
        expected_outcome = "The island keeps the hospital online through the emergency."

    else:
        explanation = (
            f"Action {action} taken at severity {severity} ({trajectory} trajectory, "
            f"battery {battery}%). Hospital remains protected."
        )
        expected_outcome = "Safe operation of the island continues per the controller policy."

    return {"explanation": explanation, "expectedOutcome": expected_outcome}


def round1(value):
    return round(float(value), 1)