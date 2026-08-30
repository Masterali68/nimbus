import type { HysteresisConfig } from "../types";

export type HysteresisState = "NORMAL" | "SHED" | "COOLDOWN";

/**
 * Generic NORMAL -> SHED -> COOLDOWN -> NORMAL state machine, reusable per resource. The
 * mechanism (this class) is domain-agnostic; the caller supplies the trigger/recovery conditions
 * each tick and only the minimum cooldown duration is configured here. COOLDOWN must last at
 * least `minCooldownTicks` before a restore is allowed, which is what bounds flapping when the
 * input oscillates right at the shed/restore threshold.
 */
export class HysteresisMachine {
  private state: HysteresisState = "NORMAL";
  private lastTransitionTick = 0;

  constructor(private readonly config: HysteresisConfig) {}

  getState(): HysteresisState {
    return this.state;
  }

  /**
   * @param shouldShed trigger condition, checked while NORMAL.
   * @param canRestore recovery condition, checked while SHED/COOLDOWN.
   */
  step(tick: number, shouldShed: boolean, canRestore: boolean): HysteresisState {
    switch (this.state) {
      case "NORMAL":
        if (shouldShed) {
          this.state = "SHED";
          this.lastTransitionTick = tick;
        }
        break;
      case "SHED":
        if (canRestore) {
          this.state = "COOLDOWN";
          this.lastTransitionTick = tick;
        }
        break;
      case "COOLDOWN":
        if (tick - this.lastTransitionTick >= this.config.minCooldownTicks) {
          if (canRestore) {
            this.state = "NORMAL";
          } else {
            // Conditions worsened again during cooldown — shed again immediately.
            this.state = "SHED";
          }
          this.lastTransitionTick = tick;
        }
        break;
    }
    return this.state;
  }
}
