/**
 * LOCAL-DEVELOPMENT FALLBACK — NOT REAL SIMULATION RESULTS.
 *
 * This is a hand-written sample `EvaluationResult` used only so the evaluation
 * page has something to lay out when the FastAPI backend is unreachable during
 * frontend development. It is always tagged `source: "fallback"` and every
 * surface that renders it MUST show a visible "sample data" label.
 *
 * The numbers below are illustrative and deliberately NOT a clean sweep for
 * Nimbus: the Naive controller never sheds load, so it "wins" the load-shed and
 * shedding-event rows — while failing badly on critical-service uptime and
 * interruptions. This keeps the sample honest and the best-value highlighting
 * logic exercised.
 */

import type { EvaluationResult } from "@/lib/api/evaluation";

function breakdown(
  reward: [string, string, number][],
  penalty: [string, string, number][],
) {
  return {
    rewards: reward.map(([key, label, value]) => ({
      key,
      label,
      kind: "reward" as const,
      value,
    })),
    penalties: penalty.map(([key, label, value]) => ({
      key,
      label,
      kind: "penalty" as const,
      value,
    })),
  };
}

export const EVALUATION_FALLBACK: EvaluationResult = {
  runId: "sample-local",
  generatedAt: null,
  durationMs: null,
  source: "fallback",
  scenario: {
    seed: 4242,
    event: "compound_crisis",
    severity: 0.82,
    initialBatteryPct: 55,
    eventDurationS: 900,
    demandSpikePct: 35,
    recoverySpeed: "gradual",
    timestepS: 1,
    scenarioCount: 100,
  },
  controllers: {
    naive: {
      criticalUptimePct: 82.4,
      waterAvailabilityPct: 71.0,
      totalLoadShedKwh: 0,
      sheddingEventCount: 0,
      recoveryTimeS: 540,
      minBatteryPct: 6.2,
      instabilityIndex: 8.7,
      criticalInterruptions: 5,
      nimbusScore: 41,
      scoreBreakdown: breakdown(
        [
          ["uptime", "Critical-service uptime", 18],
          ["water", "Water availability", 9],
          ["stability", "Energy stability", 4],
          ["battery", "Battery preservation", 2],
          ["recovery", "Faster recovery", 8],
        ],
        [
          ["shedding", "Unnecessary shedding", 0],
          ["oscillation", "Oscillation", -1],
          ["stateChanges", "Repeated state changes", -1],
          ["interruptions", "Critical-service interruptions", -14],
          ["recoveryTime", "Long recovery time", -12],
        ],
      ),
    },
    reactive: {
      criticalUptimePct: 94.1,
      waterAvailabilityPct: 78.5,
      totalLoadShedKwh: 128.6,
      sheddingEventCount: 14,
      recoveryTimeS: 320,
      minBatteryPct: 18.9,
      instabilityIndex: 5.2,
      criticalInterruptions: 2,
      nimbusScore: 67,
      scoreBreakdown: breakdown(
        [
          ["uptime", "Critical-service uptime", 24],
          ["water", "Water availability", 12],
          ["stability", "Energy stability", 9],
          ["battery", "Battery preservation", 7],
          ["recovery", "Faster recovery", 13],
        ],
        [
          ["shedding", "Unnecessary shedding", -6],
          ["oscillation", "Oscillation", -4],
          ["stateChanges", "Repeated state changes", -3],
          ["interruptions", "Critical-service interruptions", -6],
          ["recoveryTime", "Long recovery time", -5],
        ],
      ),
    },
    nimbus: {
      criticalUptimePct: 99.6,
      waterAvailabilityPct: 88.2,
      totalLoadShedKwh: 74.3,
      sheddingEventCount: 6,
      recoveryTimeS: 190,
      minBatteryPct: 27.4,
      instabilityIndex: 2.1,
      criticalInterruptions: 0,
      nimbusScore: 88,
      scoreBreakdown: breakdown(
        [
          ["uptime", "Critical-service uptime", 27],
          ["water", "Water availability", 16],
          ["stability", "Energy stability", 17],
          ["battery", "Battery preservation", 12],
          ["recovery", "Faster recovery", 20],
        ],
        [
          ["shedding", "Unnecessary shedding", -3],
          ["oscillation", "Oscillation", -1],
          ["stateChanges", "Repeated state changes", -2],
          ["interruptions", "Critical-service interruptions", 0],
          ["recoveryTime", "Long recovery time", -2],
        ],
      ),
    },
  },
};
