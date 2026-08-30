import { describe, expect, it } from "vitest";
import { resolveBattery } from "@/simulation/models/battery";
import { DEFAULT_CONFIG } from "@/simulation/config";
import type { BatteryConfig } from "@/simulation/types";

const config: BatteryConfig = DEFAULT_CONFIG.battery;

describe("resolveBattery", () => {
  it("never allows SoC below 0 under repeated aggressive discharge requests", () => {
    let socKwh = 10; // start nearly empty
    for (let i = 0; i < 200; i++) {
      const result = resolveBattery({
        prevSocKwh: socKwh,
        prevCyclesAccumulated: 0,
        totalSupplyKw: 0,
        totalDemandKw: 100000, // huge deficit -> heuristic requests max discharge
        controlOverrideRequestedKw: null,
        tickLengthMinutes: 1,
        config,
      });
      socKwh = result.state.socKwh;
      expect(socKwh).toBeGreaterThanOrEqual(0);
    }
    expect(socKwh).toBeCloseTo(0, 5);
  });

  it("never allows SoC above capacity under repeated aggressive charge requests", () => {
    let socKwh = config.capacityKwh - 10; // start nearly full
    for (let i = 0; i < 200; i++) {
      const result = resolveBattery({
        prevSocKwh: socKwh,
        prevCyclesAccumulated: 0,
        totalSupplyKw: 100000, // huge surplus -> heuristic requests max charge
        totalDemandKw: 0,
        controlOverrideRequestedKw: null,
        tickLengthMinutes: 1,
        config,
      });
      socKwh = result.state.socKwh;
      expect(socKwh).toBeLessThanOrEqual(config.capacityKwh);
    }
    expect(socKwh).toBeCloseTo(config.capacityKwh, 5);
  });

  it("never exceeds max charge/discharge rate even when a ControlAction requests more", () => {
    const chargeResult = resolveBattery({
      prevSocKwh: config.capacityKwh / 2,
      prevCyclesAccumulated: 0,
      totalSupplyKw: 0,
      totalDemandKw: 0,
      controlOverrideRequestedKw: config.maxChargeRateKw * 10,
      tickLengthMinutes: 1,
      config,
    });
    expect(chargeResult.state.chargeRateKw).toBeLessThanOrEqual(config.maxChargeRateKw);
    expect(chargeResult.violations.some((v) => v.code === "BATTERY_RATE_CLAMPED")).toBe(true);

    const dischargeResult = resolveBattery({
      prevSocKwh: config.capacityKwh / 2,
      prevCyclesAccumulated: 0,
      totalSupplyKw: 0,
      totalDemandKw: 0,
      controlOverrideRequestedKw: -config.maxDischargeRateKw * 10,
      tickLengthMinutes: 1,
      config,
    });
    expect(dischargeResult.state.chargeRateKw).toBeGreaterThanOrEqual(-config.maxDischargeRateKw);
    expect(dischargeResult.violations.some((v) => v.code === "BATTERY_RATE_CLAMPED")).toBe(true);
  });

  it("a queued ControlAction fully overrides the default dispatch heuristic for that tick", () => {
    const result = resolveBattery({
      prevSocKwh: config.capacityKwh / 2,
      prevCyclesAccumulated: 0,
      totalSupplyKw: 1000, // heuristic would want to charge hard
      totalDemandKw: 0,
      controlOverrideRequestedKw: -50, // but the control action says discharge
      tickLengthMinutes: 1,
      config,
    });
    expect(result.state.chargeRateKw).toBeLessThan(0);
  });

  it("holds (no charge/discharge) within the dispatch deadband to avoid flapping", () => {
    const result = resolveBattery({
      prevSocKwh: config.capacityKwh / 2,
      prevCyclesAccumulated: 0,
      totalSupplyKw: 100,
      totalDemandKw: 100 + config.dispatchDeadbandKw / 2, // net is inside the deadband
      controlOverrideRequestedKw: null,
      tickLengthMinutes: 1,
      config,
    });
    expect(result.state.chargeRateKw).toBe(0);
    expect(result.state.socKwh).toBeCloseTo(config.capacityKwh / 2, 5);
  });

  it("charges from surplus and discharges to cover deficit outside the deadband", () => {
    const charge = resolveBattery({
      prevSocKwh: config.capacityKwh / 2,
      prevCyclesAccumulated: 0,
      totalSupplyKw: 200,
      totalDemandKw: 50,
      controlOverrideRequestedKw: null,
      tickLengthMinutes: 1,
      config,
    });
    expect(charge.state.chargeRateKw).toBeGreaterThan(0);

    const discharge = resolveBattery({
      prevSocKwh: config.capacityKwh / 2,
      prevCyclesAccumulated: 0,
      totalSupplyKw: 50,
      totalDemandKw: 200,
      controlOverrideRequestedKw: null,
      tickLengthMinutes: 1,
      config,
    });
    expect(discharge.state.chargeRateKw).toBeLessThan(0);
  });
});
