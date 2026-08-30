import type { ConsumerType, ControllerType, Decision } from "../types";

/**
 * Turns a controller's internal decision into a plain-language Decision record. `timestamp` is
 * the sim tick (not wall-clock) — using Date.now() here would make decisions non-reproducible
 * for an otherwise fully-deterministic, seeded simulation.
 */
export function makeDecision(
  tick: number,
  controllerType: ControllerType,
  action: string,
  reasonSummary: string,
  reasonDetail: string[],
  affectedResource?: ConsumerType | "battery"
): Decision {
  return {
    timestamp: tick,
    tick,
    controllerType,
    action,
    reasonSummary,
    reasonDetail,
    affectedResource,
  };
}
