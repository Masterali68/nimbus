import { describe, expect, it } from "vitest";
import { stepDemand } from "@/simulation/models/demand";
import { createRngStreams } from "@/simulation/rng";
import { DEFAULT_CONFIG } from "@/simulation/config";
import type { EnvironmentalModifiers, SimTime } from "@/simulation/types";

function makeTime(hourOfDay: number, isWeekend: boolean, seasonalFactor = 0.5): SimTime {
  return {
    tick: Math.round(hourOfDay * 60),
    minutesElapsed: Math.round(hourOfDay * 60),
    dayIndex: 0,
    minuteOfDay: Math.round(hourOfDay * 60),
    hourOfDay,
    dayOfWeek: isWeekend ? 0 : 3,
    isWeekend,
    seasonalFactor,
  };
}

const NEUTRAL_MODIFIERS: EnvironmentalModifiers = {
  cloudCoverDelta: 0,
  windMeanShiftMps: 0,
  windVolatilityMultiplier: 1,
  demandSurgeKw: {},
  desalinationOutageFraction: 0,
  waterContaminationFlag: false,
};

describe("stepDemand", () => {
  it("hospital demand has low variance across the day (near-constant) and is PROTECTED", () => {
    const streams = createRngStreams(1);
    const values: number[] = [];
    for (let h = 0; h < 24; h++) {
      const demand = stepDemand(makeTime(h, false), NEUTRAL_MODIFIERS, streams, DEFAULT_CONFIG);
      values.push(demand.hospital.currentDemandKw);
      expect(demand.hospital.state).toBe("PROTECTED");
      expect(demand.hospital.criticalityScore).toBe(100);
      expect(demand.hospital.shedCapable).toBe(false);
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const maxDeviation = Math.max(...values.map((v) => Math.abs(v - mean)));
    expect(maxDeviation / mean).toBeLessThan(0.25);
    expect(values.every((v) => v > 0)).toBe(true);
  });

  it("residential demand shows a double-hump curve (morning + evening peaks above midday trough)", () => {
    const streams = createRngStreams(2);
    const morningPeak = stepDemand(
      makeTime(DEFAULT_CONFIG.demand.residential.morningPeakHour, false),
      NEUTRAL_MODIFIERS,
      streams,
      DEFAULT_CONFIG
    ).residential.maxDemandKw;
    const midday = stepDemand(makeTime(12, false), NEUTRAL_MODIFIERS, streams, DEFAULT_CONFIG).residential
      .maxDemandKw;
    const eveningPeak = stepDemand(
      makeTime(DEFAULT_CONFIG.demand.residential.eveningPeakHour, false),
      NEUTRAL_MODIFIERS,
      streams,
      DEFAULT_CONFIG
    ).residential.maxDemandKw;

    expect(morningPeak).toBeGreaterThan(midday);
    expect(eveningPeak).toBeGreaterThan(midday);
  });

  it("residential demand is higher on weekends given the weekend multiplier", () => {
    const streamsA = createRngStreams(3);
    const streamsB = createRngStreams(3);
    const weekday = stepDemand(
      makeTime(DEFAULT_CONFIG.demand.residential.morningPeakHour, false),
      NEUTRAL_MODIFIERS,
      streamsA,
      DEFAULT_CONFIG
    ).residential.maxDemandKw;
    const weekend = stepDemand(
      makeTime(DEFAULT_CONFIG.demand.residential.morningPeakHour, true),
      NEUTRAL_MODIFIERS,
      streamsB,
      DEFAULT_CONFIG
    ).residential.maxDemandKw;
    expect(weekend).toBeGreaterThan(weekday);
  });

  it("resort demand peaks differently than residential (daytime pool/AC + evening events)", () => {
    const streams = createRngStreams(4);
    const daytimePeak = stepDemand(
      makeTime(DEFAULT_CONFIG.demand.resort.daytimePeakHour, false),
      NEUTRAL_MODIFIERS,
      streams,
      DEFAULT_CONFIG
    ).resort.maxDemandKw;
    const nightTrough = stepDemand(makeTime(4, false), NEUTRAL_MODIFIERS, streams, DEFAULT_CONFIG).resort
      .maxDemandKw;
    expect(daytimePeak).toBeGreaterThan(nightTrough);
  });

  it("desalination is throttleable but not shed-capable, and produces a bounded water output target", () => {
    const streams = createRngStreams(5);
    const demand = stepDemand(makeTime(12, false), NEUTRAL_MODIFIERS, streams, DEFAULT_CONFIG);
    expect(demand.desalination.continuouslyThrottleable).toBe(true);
    expect(demand.desalination.shedCapable).toBe(false);
    expect(demand.desalination.criticalityScore).toBe(90);
    expect(demand.desalination.waterOutputM3PerHour).toBeLessThanOrEqual(
      DEFAULT_CONFIG.demand.desalination.capacityM3PerHour
    );
  });

  it("residential and resort are shed-capable; hospital and desalination are not", () => {
    const streams = createRngStreams(6);
    const demand = stepDemand(makeTime(12, false), NEUTRAL_MODIFIERS, streams, DEFAULT_CONFIG);
    expect(demand.residential.shedCapable).toBe(true);
    expect(demand.resort.shedCapable).toBe(true);
    expect(demand.hospital.shedCapable).toBe(false);
    expect(demand.desalination.shedCapable).toBe(false);
  });

  it("demand surges add on top of the smooth baseline curve (maxDemandKw, before any control)", () => {
    const streamsA = createRngStreams(7);
    const streamsB = createRngStreams(7);
    const base = stepDemand(makeTime(12, false), NEUTRAL_MODIFIERS, streamsA, DEFAULT_CONFIG);
    const surged = stepDemand(
      makeTime(12, false),
      { ...NEUTRAL_MODIFIERS, demandSurgeKw: { resort: 75 } },
      streamsB,
      DEFAULT_CONFIG
    );
    expect(surged.resort.maxDemandKw - base.resort.maxDemandKw).toBeCloseTo(75, 5);
    expect(surged.resort.currentDemandKw - base.resort.currentDemandKw).toBeCloseTo(75, 5);
  });

  it("every consumer starts each tick at operatingPct=100 (the controller decides deltas afterward)", () => {
    const streams = createRngStreams(8);
    const demand = stepDemand(makeTime(15, false), NEUTRAL_MODIFIERS, streams, DEFAULT_CONFIG);
    for (const consumer of [demand.hospital, demand.desalination, demand.residential, demand.resort]) {
      expect(consumer.operatingPct).toBe(100);
      expect(consumer.currentDemandKw).toBeCloseTo(consumer.maxDemandKw, 5);
    }
  });

  it("totalDemandKw/totalMaxDemandKw equal the sum of the four consumers", () => {
    const streams = createRngStreams(9);
    const demand = stepDemand(makeTime(15, false), NEUTRAL_MODIFIERS, streams, DEFAULT_CONFIG);
    const sumCurrent =
      demand.hospital.currentDemandKw +
      demand.desalination.currentDemandKw +
      demand.residential.currentDemandKw +
      demand.resort.currentDemandKw;
    const sumMax =
      demand.hospital.maxDemandKw +
      demand.desalination.maxDemandKw +
      demand.residential.maxDemandKw +
      demand.resort.maxDemandKw;
    expect(demand.totalDemandKw).toBeCloseTo(sumCurrent, 5);
    expect(demand.totalMaxDemandKw).toBeCloseTo(sumMax, 5);
  });
});
