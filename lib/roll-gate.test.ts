import { describe, it, expect } from "vitest";
import { RollGate } from "./roll-gate";

describe("RollGate — double-tap lockout", () => {
  it("starts unlocked", () => {
    expect(new RollGate().isLocked).toBe(false);
  });

  it("grants first tap and locks immediately", () => {
    const gate = new RollGate();
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.isLocked).toBe(true);
  });

  it("blocks second tap before release", () => {
    const gate = new RollGate();
    gate.tryAcquire();
    expect(gate.tryAcquire()).toBe(false);
  });

  it("allows re-acquire after release", () => {
    const gate = new RollGate();
    gate.tryAcquire();
    gate.release();
    expect(gate.tryAcquire()).toBe(true);
  });

  it("blocks N concurrent taps — exactly one succeeds", () => {
    const gate = new RollGate();
    const results = Array.from({ length: 20 }, () => gate.tryAcquire());
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results[0]).toBe(true);   // first caller wins
    expect(results[1]).toBe(false);  // all subsequent are blocked
  });
});
