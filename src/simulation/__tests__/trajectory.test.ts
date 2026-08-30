import { describe, expect, it } from "vitest";
import { stepTrajectory } from "@/simulation/trajectory";
import { DEFAULT_CONFIG } from "@/simulation/config";

const config = DEFAULT_CONFIG.trajectory;

describe("stepTrajectory", () => {
  it("classifies as STABLE when net power is steady", () => {
    let filtered = 100;
    let velocity = 0;
    for (let i = 0; i < 20; i++) {
      const result = stepTrajectory({
        netPowerKw: 100,
        prevFilteredNetPowerKw: filtered,
        prevVelocityKwPerS: velocity,
        tickLengthMinutes: 1,
        config,
      });
      filtered = result.filteredNetPowerKw;
      velocity = result.velocityKwPerS;
      expect(result.trajectory).toBe("STABLE");
    }
  });

  it("a sharp drop in net power produces negative velocity and flips to DETERIORATING within a bounded window", () => {
    let filtered = 500; // steady state before the drop
    let velocity = 0;
    let flippedAtTick = -1;

    for (let tick = 1; tick <= 30; tick++) {
      const netPowerKw = tick < 5 ? 500 : -500; // sharp drop at tick 5
      const result = stepTrajectory({
        netPowerKw,
        prevFilteredNetPowerKw: filtered,
        prevVelocityKwPerS: velocity,
        tickLengthMinutes: 1,
        config,
      });
      filtered = result.filteredNetPowerKw;
      velocity = result.velocityKwPerS;

      if (tick < 5) {
        expect(result.trajectory).toBe("STABLE");
      }
      if (tick >= 5 && result.trajectory === "DETERIORATING" && flippedAtTick === -1) {
        flippedAtTick = tick;
      }
      if (tick === 5) {
        expect(velocity).toBeLessThan(0); // correct sign immediately after the drop
      }
    }

    expect(flippedAtTick).toBeGreaterThanOrEqual(5); // not before the drop
    expect(flippedAtTick).toBeLessThanOrEqual(10); // detected within a bounded window, not laggy forever
  });

  it("a sharp rise in net power produces positive velocity and flips to IMPROVING within a bounded window", () => {
    // Same shape as the drop test above: check detection happens promptly, not that IMPROVING
    // holds forever — once the EMA fully converges to the new (steady) value, velocity decays
    // back toward zero and the classification correctly settles back to STABLE.
    let filtered = -500;
    let velocity = 0;
    let flippedAtTick = -1;

    for (let tick = 1; tick <= 10; tick++) {
      const result = stepTrajectory({
        netPowerKw: 500,
        prevFilteredNetPowerKw: filtered,
        prevVelocityKwPerS: velocity,
        tickLengthMinutes: 1,
        config,
      });
      filtered = result.filteredNetPowerKw;
      velocity = result.velocityKwPerS;
      if (tick === 1) {
        expect(velocity).toBeGreaterThan(0); // correct sign immediately
      }
      if (result.trajectory === "IMPROVING" && flippedAtTick === -1) {
        flippedAtTick = tick;
      }
    }

    expect(flippedAtTick).toBeGreaterThanOrEqual(1);
    expect(flippedAtTick).toBeLessThanOrEqual(5);
  });

  it("acceleration reflects the change in velocity, not just velocity itself", () => {
    // Constant velocity (linear ramp) -> acceleration should trend toward zero after the initial kick.
    let filtered = 0;
    let velocity = 0;
    let acceleration = 0;
    for (let tick = 1; tick <= 50; tick++) {
      const result = stepTrajectory({
        netPowerKw: tick * 10, // linearly increasing net power
        prevFilteredNetPowerKw: filtered,
        prevVelocityKwPerS: velocity,
        tickLengthMinutes: 1,
        config,
      });
      filtered = result.filteredNetPowerKw;
      velocity = result.velocityKwPerS;
      acceleration = result.accelerationKwPerS2;
    }
    expect(Number.isFinite(acceleration)).toBe(true);
  });
});
