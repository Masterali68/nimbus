import type { Decision, NimbusControllerConfig, ResourceControlState } from "../types";
import type { Controller, ControllerContext, ControllerOutput, ResourceDecision } from "./types";
import { makeDecision } from "./explainability";
import { HysteresisMachine } from "./hysteresis";
import { stepPd } from "./pd";

const THROTTLE_EPSILON_PCT = 0.5;

/**
 * The actual product: a priority hierarchy, orderly one-at-a-time restoration, trajectory-aware.
 * Stage 1 (hospital always on) is enforced upstream — this controller never touches it.
 * Stage 2: continuously PD-throttle desalination.
 * Stage 3: coarsely reduce residential via a hysteresis machine keyed on battery SoC.
 * Stage 4: shed resort via its own hysteresis machine — restoring only after residential has
 * already fully recovered to NORMAL, so recovery is sequential, never simultaneous.
 */
export class NimbusController implements Controller {
  readonly type = "nimbus" as const;

  private prevPdError = 0;
  private wasDesalThrottled = false;
  private readonly residentialMachine: HysteresisMachine;
  private readonly resortMachine: HysteresisMachine;

  constructor(config: NimbusControllerConfig) {
    this.residentialMachine = new HysteresisMachine({ minCooldownTicks: config.restorationCooldownTicks });
    this.resortMachine = new HysteresisMachine(config.resortHysteresis);
  }

  decide(context: ControllerContext): ControllerOutput {
    const config: NimbusControllerConfig = context.config.controllers.nimbus;
    const socPct = context.batteryPrevSocFraction * 100;
    const resourceDecisions: ResourceDecision[] = [];
    const decisions: Decision[] = [];

    // Stage 2: desalination, continuously PD-throttled toward the trajectory-aware target.
    const pd = stepPd({
      filteredNetPowerKw: context.energyBalance.filteredNetPowerKw,
      prevError: this.prevPdError,
      tickLengthMinutes: context.config.tickLengthMinutes,
      config: config.desalinationPd,
    });
    this.prevPdError = pd.error;
    const desalThrottled = pd.operatingPct < 100 - THROTTLE_EPSILON_PCT;
    resourceDecisions.push({
      consumer: "desalination",
      operatingPct: pd.operatingPct,
      state: desalThrottled ? "THROTTLED" : "NORMAL",
    });
    if (desalThrottled && !this.wasDesalThrottled) {
      decisions.push(
        makeDecision(
          context.tick,
          "nimbus",
          "throttle_desalination",
          `trajectory_${context.energyBalance.trajectory.toLowerCase()}`,
          [
            `Net power trend is ${context.energyBalance.trajectory.toLowerCase()}.`,
            `Desalination throttled to ${pd.operatingPct.toFixed(0)}% to help rebalance supply and demand before any load needs to be cut.`,
          ],
          "desalination"
        )
      );
    } else if (!desalThrottled && this.wasDesalThrottled) {
      decisions.push(
        makeDecision(
          context.tick,
          "nimbus",
          "restore_desalination",
          `trajectory_${context.energyBalance.trajectory.toLowerCase()}`,
          ["Supply/demand balance has recovered.", "Desalination restored to full output."],
          "desalination"
        )
      );
    }
    this.wasDesalThrottled = desalThrottled;

    // Stage 3: residential — coarse reduction via hysteresis on battery SoC.
    const residentialShouldReduce = socPct < config.residentialReduceBelowSocPct;
    const residentialCanRestore = socPct > config.residentialRestoreAboveSocPct;
    const prevResidentialState = this.residentialMachine.getState();
    const residentialState = this.residentialMachine.step(context.tick, residentialShouldReduce, residentialCanRestore);
    if (residentialState !== prevResidentialState) {
      decisions.push(this.explainResidentialTransition(context.tick, residentialState, socPct, config));
    }
    resourceDecisions.push({
      consumer: "residential",
      operatingPct: residentialState === "NORMAL" ? 100 : config.residentialReducedOperatingPct,
      state: mapHysteresisState(residentialState, "REDUCED"),
    });

    // Stage 4: resort — full shed via its own hysteresis machine. Restoring requires BOTH the
    // battery recovery threshold AND residential already back to NORMAL — orderly, one at a time.
    const resortShouldShed = socPct < config.resortShedBelowSocPct;
    const resortCanRestore = socPct > config.resortRestoreAboveSocPct && this.residentialMachine.getState() === "NORMAL";
    const prevResortState = this.resortMachine.getState();
    const resortState = this.resortMachine.step(context.tick, resortShouldShed, resortCanRestore);
    if (resortState !== prevResortState) {
      decisions.push(this.explainResortTransition(context.tick, resortState, socPct, config));
    }
    resourceDecisions.push({
      consumer: "resort",
      operatingPct: resortState === "NORMAL" ? 100 : 0,
      state: mapHysteresisState(resortState, "SHED"),
    });

    return { resourceDecisions, batteryRequestedKw: null, decisions };
  }

  private explainResidentialTransition(
    tick: number,
    state: ReturnType<HysteresisMachine["getState"]>,
    socPct: number,
    config: NimbusControllerConfig
  ): Decision {
    if (state === "SHED") {
      return makeDecision(
        tick,
        "nimbus",
        "reduce_residential",
        "battery_low",
        [
          `Battery is at ${socPct.toFixed(0)}%, below the ${config.residentialReduceBelowSocPct}% threshold.`,
          `Residential load reduced to ${config.residentialReducedOperatingPct}% to preserve battery reserve for critical loads.`,
        ],
        "residential"
      );
    }
    if (state === "NORMAL") {
      return makeDecision(
        tick,
        "nimbus",
        "restore_residential",
        "battery_recovered",
        [`Battery has recovered to ${socPct.toFixed(0)}%.`, "Residential load restored to normal."],
        "residential"
      );
    }
    return makeDecision(
      tick,
      "nimbus",
      "residential_cooldown",
      "recovery_in_progress",
      ["Residential load is in a cooldown period before it can be fully restored."],
      "residential"
    );
  }

  private explainResortTransition(
    tick: number,
    state: ReturnType<HysteresisMachine["getState"]>,
    socPct: number,
    config: NimbusControllerConfig
  ): Decision {
    if (state === "SHED") {
      return makeDecision(
        tick,
        "nimbus",
        "shed_resort",
        "battery_critical",
        [
          `Battery is at ${socPct.toFixed(0)}%, below the ${config.resortShedBelowSocPct}% threshold.`,
          "Resort load cut entirely — it is the least critical resource on the island.",
        ],
        "resort"
      );
    }
    if (state === "NORMAL") {
      return makeDecision(
        tick,
        "nimbus",
        "restore_resort",
        "battery_recovered",
        [
          `Battery has recovered to ${socPct.toFixed(0)}%.`,
          "Residential load was already fully restored, so resort is now being restored last, as planned.",
        ],
        "resort"
      );
    }
    return makeDecision(
      tick,
      "nimbus",
      "resort_cooldown",
      "recovery_in_progress",
      ["Resort load is in a cooldown period, waiting for residential to fully recover first."],
      "resort"
    );
  }
}

function mapHysteresisState(
  state: "NORMAL" | "SHED" | "COOLDOWN",
  shedLabel: Extract<ResourceControlState, "REDUCED" | "SHED">
): ResourceControlState {
  if (state === "NORMAL") return "NORMAL";
  if (state === "COOLDOWN") return "COOLDOWN";
  return shedLabel;
}
