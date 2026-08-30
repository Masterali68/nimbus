import { describe, expect, it } from "vitest";
import { createStream, hashSeedLabel, mulberry32, sampleStandardNormal, stepOrnsteinUhlenbeck } from "@/simulation/rng";

describe("rng", () => {
  it("mulberry32 is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("mulberry32 produces values in [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds produce different sequences", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("hashSeedLabel is deterministic and label-sensitive", () => {
    expect(hashSeedLabel(1, "solar.cloud")).toBe(hashSeedLabel(1, "solar.cloud"));
    expect(hashSeedLabel(1, "solar.cloud")).not.toBe(hashSeedLabel(1, "wind.speed"));
  });

  it("createStream gives independent streams that don't couple with each other", () => {
    const solar = createStream(1, "solar.cloud");
    const wind = createStream(1, "wind.speed");
    // Consuming one stream must not affect the other's future values.
    const windFirstValueBefore = mulberry32(hashSeedLabel(1, "wind.speed"))();
    solar();
    solar();
    solar();
    const windFirstValueAfter = wind();
    expect(windFirstValueAfter).toBe(windFirstValueBefore);
  });

  it("sampleStandardNormal produces a roughly zero-mean, unit-variance distribution", () => {
    const rng = mulberry32(123);
    const samples = Array.from({ length: 5000 }, () => sampleStandardNormal(rng));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
    expect(mean).toBeGreaterThan(-0.15);
    expect(mean).toBeLessThan(0.15);
    expect(variance).toBeGreaterThan(0.8);
    expect(variance).toBeLessThan(1.2);
  });

  it("stepOrnsteinUhlenbeck mean-reverts toward mu over many steps", () => {
    const rng = mulberry32(99);
    let x = 20; // far from mu
    for (let i = 0; i < 2000; i++) {
      x = stepOrnsteinUhlenbeck(x, 5, 0.05, 0.1, rng);
    }
    expect(Math.abs(x - 5)).toBeLessThan(3);
  });
});
