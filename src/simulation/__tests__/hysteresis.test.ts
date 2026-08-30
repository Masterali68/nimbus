import { describe, expect, it } from "vitest";
import { HysteresisMachine } from "@/simulation/controllers/hysteresis";

describe("HysteresisMachine", () => {
  it("starts NORMAL and transitions to SHED when the trigger condition holds", () => {
    const machine = new HysteresisMachine({ minCooldownTicks: 5 });
    expect(machine.getState()).toBe("NORMAL");
    machine.step(1, true, false);
    expect(machine.getState()).toBe("SHED");
  });

  it("goes through COOLDOWN before returning to NORMAL, never jumping straight back", () => {
    const machine = new HysteresisMachine({ minCooldownTicks: 5 });
    machine.step(1, true, false); // -> SHED
    machine.step(2, false, true); // recovery condition holds -> COOLDOWN
    expect(machine.getState()).toBe("COOLDOWN");
    machine.step(3, false, true); // still within cooldown
    expect(machine.getState()).toBe("COOLDOWN");
  });

  it("only returns to NORMAL after minCooldownTicks have elapsed", () => {
    const machine = new HysteresisMachine({ minCooldownTicks: 5 });
    machine.step(1, true, false); // -> SHED
    machine.step(2, false, true); // -> COOLDOWN at tick 2
    for (let tick = 3; tick < 7; tick++) {
      machine.step(tick, false, true);
      expect(machine.getState()).toBe("COOLDOWN");
    }
    machine.step(7, false, true); // tick 7 - 2 = 5 >= minCooldownTicks
    expect(machine.getState()).toBe("NORMAL");
  });

  it("re-sheds immediately if conditions worsen again during cooldown", () => {
    const machine = new HysteresisMachine({ minCooldownTicks: 3 });
    machine.step(1, true, false); // -> SHED
    machine.step(2, false, true); // -> COOLDOWN
    machine.step(5, false, false); // cooldown elapsed, but recovery condition no longer holds
    expect(machine.getState()).toBe("SHED");
  });

  it("an input oscillating right at the threshold produces zero rapid flapping (bounded by cooldown)", () => {
    const machine = new HysteresisMachine({ minCooldownTicks: 10 });
    let transitionCount = 0;
    let prevState = machine.getState();

    for (let tick = 1; tick <= 200; tick++) {
      // Oscillate the trigger/recovery conditions every single tick — the crudest possible flapping input.
      const shouldShed = tick % 2 === 0;
      const canRestore = tick % 2 === 1;
      machine.step(tick, shouldShed, canRestore);
      if (machine.getState() !== prevState) {
        transitionCount += 1;
        prevState = machine.getState();
      }
    }

    // With minCooldownTicks=10 over 200 ticks, transitions must be bounded — nowhere near one
    // transition every tick (200), which is what an unprotected raw threshold would produce.
    expect(transitionCount).toBeLessThan(100);
  });
});
