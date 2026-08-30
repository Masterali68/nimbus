import type {
  IslandState,
  NimbusDecision,
  ReasonCode,
  ResourceAction,
  Severity,
  Trajectory,
} from "../engine/types";
import {
  desalinationLimits,
  residentialLimits,
} from "@/lib/constants/thresholds";
import { roundTo1 } from "@/lib/engine/resources";

export interface ExplanationContext {
  state: IslandState;
  controllerMode: NimbusDecision["controllerMode"];
  severity: Severity;
  trajectory: Trajectory;
  action: ResourceAction;
  reasonCode: ReasonCode;
  filteredNetPowerKw: number;
  velocityKwS: number;
  accelerationKwS2: number;
}

export interface DecisionExplanation {
  explanation: string;
  expectedOutcome: string;
}

function fmt(value: number): string {
  return roundTo1(value).toString();
}

export function buildExplanation(context: ExplanationContext): DecisionExplanation {
  const { state, trajectory, reasonCode } = context;
  const batteryPct = roundTo1(state.batteryPct);
  const desal = state.resources.desalination;
  const resort = state.resources.resort;
  const loadAdditionsKw =
    resort.currentDemandKw * (resort.operatingPct / 100) +
    desal.currentDemandKw * (desal.operatingPct / 100);

  let explanation = "";
  let expectedOutcome = "";

  switch (reasonCode) {
    case "OK_STABLE":
      explanation = `Trajectory is stable and the battery is healthy at ${batteryPct}%. All resources stay at normal operating levels while the island banks surplus.`;
      expectedOutcome =
        "The system continues normally; battery holds or charges and no load is interrupted.";
      break;

    case "OK_IMPROVING":
      explanation = `Net power is growing (+${fmt(context.velocityKwS)} kW/s), so conditions are improving and normal operations are preserved.`;
      expectedOutcome = "Surplus builds, the battery recharges, and no curtailment is needed.";
      break;

    case "WATCH_TRAJECTORY":
      explanation = `Early watch: the live energy balance is drifting down at ${fmt(context.velocityKwS)} kW/s (battery ${batteryPct}%). This is short-term early detection using the trajectory of live energy balance, not a forecast. No resources are shed yet.`;
      expectedOutcome = "The island keeps running while the engine watches whether the decline continues.";
      break;

    case "WATCH_BATTERY":
      explanation = `Battery level at ${batteryPct}% is below the watch line. No action taken yet, but flexible loads are primed to respond if conditions worsen.`;
      expectedOutcome = "Early awareness; dispatch is delayed until thresholds are truly crossed.";
      break;

    case "WARNING_SHED_RESORT":
      explanation = `Resort was shed: it has the lowest criticality (${resort.criticality}), and the island entered a warning state with battery at ${batteryPct}%.`;
      expectedOutcome = `Freeing up ${fmt(loadAdditionsKw)} kW of load protects the hospital and slows battery drawdown.`;
      break;

    case "WARNING_THROTTLE_DESALINATION":
      explanation = `Desalination throttled to ${desal.operatingPct}% to keep a positive energy balance. It is trimmed smoothly, respecting the ${desalinationLimits.minOperatingPct}% safe floor.`;
      expectedOutcome = "Water still flows at a reduced rate while battery drawdown is reduced.";
      break;

    case "WARNING_REDUCE_RESIDENTIAL":
      explanation = `Serious shortage: battery at ${batteryPct}%. Residential demand reduced by ${residentialLimits.reduceStepPct}% after the resort was already addressed.`;
      expectedOutcome = "A step of residential load is freed; hospital and desalination continue operating.";
      break;

    case "CRITICAL_BATTERY":
      explanation = `Critical: battery at ${batteryPct}% with the balance still falling (${fmt(context.velocityKwS)} kW/s). All non-protected flexible loads are shed or minimized.`;
      expectedOutcome = "Maximum available load reduction keeps the hospital online and prevents a full island outage.";
      break;

    case "CRITICAL_COLLAPSE":
      explanation = `Critical: generation is collapsing fast (${fmt(context.velocityKwS)} kW/s, acceleration ${fmt(context.accelerationKwS2)} kW/s²). Dispatching all low-priority load reductions immediately.`;
      expectedOutcome = "Hospital stays protected; the battery floor is defended for as long as possible.";
      break;

    case "RECOVERY_RESTORE_DESALINATION":
      explanation = `Balance recovered (${fmt(context.filteredNetPowerKw)} kW filtered). Desalination is being restored gradually toward 100% within its ramp limits.`;
      expectedOutcome = "Water production recovers smoothly without re-stressing the battery.";
      break;

    case "RECOVERY_RESTORE_RESIDENTIAL":
      explanation = `Battery recovered to ${batteryPct}% with a stable trajectory. Residential demand is restored to normal levels.`;
      expectedOutcome = "Homes return to full supply once the island can sustain them.";
      break;

    case "RECOVERY_RESTORE_RESORT":
      explanation = `Conditions recovered (battery ${batteryPct}%, trajectory ${trajectory}). The resort is being brought back online.`;
      expectedOutcome = "The resort reconnects after the island demonstrably holds at healthy levels.";
      break;

    case "COOLDOWN_HOLD":
      explanation = `Resort remains in cooldown after its last shed. Battery is at ${batteryPct}%; it must stay safely above the recovery line before reconnection.`;
      expectedOutcome = "No rapid on/off cycling; the resort returns only when recovery is stable.";
      break;

    default:
      explanation =
        "The island is operating normally with no action required.";
      expectedOutcome = "No change in island operations.";
      break;
  }

  return { explanation, expectedOutcome };
}