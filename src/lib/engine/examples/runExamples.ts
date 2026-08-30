import type { ControllerMode, IslandState, NimbusDecision } from "../types";
import { runController } from "@/lib/engine/runController";
import {
  recovery,
  severeBatteryShortage,
  stableIsland,
  stormFallingGeneration,
  withControllerMode,
} from "@/lib/engine/examples/fixtures";

export const controllerModes: ControllerMode[] = ["naive", "reactive", "nimbus"];
export const exampleScenarios: IslandState[] = [
  stableIsland,
  stormFallingGeneration,
  severeBatteryShortage,
  recovery,
];

export function runPhase1Examples(): NimbusDecision[] {
  const decisions: NimbusDecision[] = [];
  for (const scenario of exampleScenarios) {
    for (const controllerMode of controllerModes) {
      const state = withControllerMode(scenario, controllerMode);
      decisions.push(runController(state));
    }
  }
  return decisions;
}