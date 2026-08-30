/**
 * Controller display vocabulary for the evaluation page.
 *
 * Colours are the fixed comparison language used by every chart, table header,
 * and score tile so the three controllers always read the same way:
 *   Naive    — muted grey
 *   Reactive — orange
 *   Nimbus   — cyan
 */

import type { ControllerKey } from "@/lib/api/evaluation";

export interface ControllerMeta {
  key: ControllerKey;
  label: string;
  /** Solid colour for chart bars / dots. */
  color: string;
  /** Tailwind left-accent class for the explanation cards. */
  accent: string;
  tagline: string;
  bullets: string[];
}

export const CONTROLLER_META: Record<ControllerKey, ControllerMeta> = {
  naive: {
    key: "naive",
    label: "Naive",
    color: "#8a94a6",
    accent: "border-l-[#8a94a6]",
    tagline: "Battery-threshold reaction.",
    bullets: [
      "Acts only on a fixed battery-level threshold.",
      "Sheds resources abruptly once that line is crossed.",
      "No sense of which way the system is heading.",
    ],
  },
  reactive: {
    key: "reactive",
    label: "Reactive",
    color: "#fb923c",
    accent: "border-l-signal-orange",
    tagline: "Battery + current net power.",
    bullets: [
      "Uses the battery level and the current supply/demand gap.",
      "Responds after conditions have already worsened.",
      "Basic hysteresis to avoid rapid on/off flapping.",
    ],
  },
  nimbus: {
    key: "nimbus",
    label: "Nimbus",
    color: "#38bdf8",
    accent: "border-l-signal-cyan",
    tagline: "Trajectory-aware, priority-first.",
    bullets: [
      "Detects a worsening trajectory early from rate and acceleration of change.",
      "Protects critical services — the hospital first.",
      "Smoothly throttles flexible demand instead of hard cut-offs.",
      "Allocates by priority and restores resources gradually.",
    ],
  },
};

export const CONTROLLER_ORDER: ControllerKey[] = ["naive", "reactive", "nimbus"];
