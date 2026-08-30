import type { Decision, NaiveControllerConfig } from "../types";
import type { Controller, ControllerContext, ControllerOutput, ResourceDecision } from "./types";
import { makeDecision } from "./explainability";

/**
 * Baseline 1 — the cheapest possible controller: raw battery-% thresholds only, no trajectory
 * input, no PD, no shared hysteresis machine (a hand-rolled two-threshold Schmitt trigger is
 * enough to avoid outright single-tick flapping, but this is deliberately cruder than nimbus.ts).
 */
export class NaiveController implements Controller {
  readonly type = "naive" as const;

  private resortShed = false;
  private residentialShed = false;

  decide(context: ControllerContext): ControllerOutput {
    const config: NaiveControllerConfig = context.config.controllers.naive;
    const socPct = context.batteryPrevSocFraction * 100;
    const resourceDecisions: ResourceDecision[] = [];
    const decisions: Decision[] = [];

    if (!this.resortShed && socPct < config.shedResortBelowSocPct) {
      this.resortShed = true;
      decisions.push(
        makeDecision(
          context.tick,
          "naive",
          "shed_resort",
          "battery_low",
          [
            `Battery is at ${socPct.toFixed(0)}%, below the ${config.shedResortBelowSocPct}% threshold.`,
            "Resort load has been cut off entirely to conserve remaining battery reserve.",
          ],
          "resort"
        )
      );
    } else if (this.resortShed && socPct > config.restoreResortAboveSocPct) {
      this.resortShed = false;
      decisions.push(
        makeDecision(
          context.tick,
          "naive",
          "restore_resort",
          "battery_recovered",
          [`Battery has recovered to ${socPct.toFixed(0)}%.`, "Resort load has been restored."],
          "resort"
        )
      );
    }
    resourceDecisions.push({
      consumer: "resort",
      operatingPct: this.resortShed ? 0 : 100,
      state: this.resortShed ? "SHED" : "NORMAL",
    });

    if (!this.residentialShed && socPct < config.shedResidentialBelowSocPct) {
      this.residentialShed = true;
      decisions.push(
        makeDecision(
          context.tick,
          "naive",
          "shed_residential",
          "battery_critical",
          [
            `Battery is critically low at ${socPct.toFixed(0)}%, below the ${config.shedResidentialBelowSocPct}% threshold.`,
            "Residential load has been cut off entirely to protect the battery.",
          ],
          "residential"
        )
      );
    } else if (this.residentialShed && socPct > config.restoreResidentialAboveSocPct) {
      this.residentialShed = false;
      decisions.push(
        makeDecision(
          context.tick,
          "naive",
          "restore_residential",
          "battery_recovered",
          [`Battery has recovered to ${socPct.toFixed(0)}%.`, "Residential load has been restored."],
          "residential"
        )
      );
    }
    resourceDecisions.push({
      consumer: "residential",
      operatingPct: this.residentialShed ? 0 : 100,
      state: this.residentialShed ? "SHED" : "NORMAL",
    });

    return { resourceDecisions, batteryRequestedKw: null, decisions };
  }
}
