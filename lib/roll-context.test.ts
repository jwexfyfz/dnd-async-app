// Server-Seeded Roll — payload architecture tests
// Verifies buildRollContext returns the correct schema without rolling a d20
// or appending anything to narrative history.

import { describe, it, expect } from "vitest";
import { buildRollContext } from "./roll-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("buildRollContext — Server-Seeded Roll payload", () => {
  it("sets requiresRoll: true", () => {
    expect(buildRollContext("perception", 14, 0).requiresRoll).toBe(true);
  });

  it("returns a valid UUID v4 rollRequestId", () => {
    expect(buildRollContext("perception", 14, 0).rollRequestId).toMatch(UUID_RE);
  });

  it("maps chip type to canonical skill label", () => {
    expect(buildRollContext("perception", 14, 0).skillType).toBe("Perception");
    expect(buildRollContext("athletics", 12, 3).skillType).toBe("Athletics");
    expect(buildRollContext("stealth", 15, -1).skillType).toBe("Stealth");
    expect(buildRollContext("arcana", 17, 2).skillType).toBe("Arcana");
  });

  it("preserves targetDC exactly", () => {
    expect(buildRollContext("insight", 17, 1).targetDC).toBe(17);
  });

  it("stores modifier as provided", () => {
    expect(buildRollContext("persuasion", 14, -2).modifier).toBe(-2);
    expect(buildRollContext("athletics", 12, 4).modifier).toBe(4);
  });

  it("produces a unique rollRequestId on every call — no d20 result included", () => {
    const a = buildRollContext("deception", 12, 0);
    const b = buildRollContext("deception", 12, 0);
    expect(a.rollRequestId).not.toBe(b.rollRequestId);
    // Confirm the schema has no dice roll or narrative fields
    expect(a).not.toHaveProperty("roll");
    expect(a).not.toHaveProperty("total");
    expect(a).not.toHaveProperty("narrative");
  });
});
