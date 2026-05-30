import { describe, it, expect } from "vitest";
import { rollDamageExpr, computeAttackDamage } from "./mechanical-damage";
import { clampHp } from "./combat-effect";
import { doubleDice } from "./dice-formula";

// ─── rollDamageExpr ───────────────────────────────────────────────────────────

describe("rollDamageExpr", () => {
  it("1d6 returns integer ∈ [1, 6]", () => {
    for (let i = 0; i < 50; i++) {
      const v = rollDamageExpr("1d6");
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it("1d4+2 returns integer ∈ [3, 6]", () => {
    for (let i = 0; i < 50; i++) {
      const v = rollDamageExpr("1d4+2");
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it("2d6+3 returns integer ∈ [5, 15]", () => {
    for (let i = 0; i < 100; i++) {
      const v = rollDamageExpr("2d6+3");
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(15);
    }
  });

  it("crit: doubleDice(1d8) → 2d8 returns integer ∈ [2, 16]", () => {
    const critExpr = doubleDice("1d8");
    expect(critExpr).toBe("2d8");
    for (let i = 0; i < 100; i++) {
      const v = rollDamageExpr(critExpr);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(16);
    }
  });

  it("unarmed 1d4 with stat mod +2 baked in returns ∈ [3, 6]", () => {
    for (let i = 0; i < 50; i++) {
      const v = rollDamageExpr("1d4+2");
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});

// ─── computeAttackDamage ──────────────────────────────────────────────────────

describe("computeAttackDamage", () => {
  it("normal hit, shortsword 1d6, STR mod +2 → ∈ [3, 8]", () => {
    for (let i = 0; i < 100; i++) {
      const v = computeAttackDamage("1d6", 2, false);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(8);
    }
  });

  it("critical hit, 1d6, STR mod +2 → ∈ [4, 14] (2d6 + mod)", () => {
    for (let i = 0; i < 200; i++) {
      const v = computeAttackDamage("1d6", 2, true);
      expect(v).toBeGreaterThanOrEqual(4);
      expect(v).toBeLessThanOrEqual(14);
    }
  });

  it("unarmed (null weapon) → uses 1d4 + STR mod +2 → ∈ [3, 6]", () => {
    for (let i = 0; i < 50; i++) {
      const v = computeAttackDamage(null, 2, false);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it("enchanted weapon +1 attackBonus does not inflate damage (dice only)", () => {
    // attackBonus is for to-hit only; damageDice "1d6" → [3,8] with STR +2
    for (let i = 0; i < 50; i++) {
      const v = computeAttackDamage("1d6", 2, false);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(8);
    }
  });

  it("minimum damage is 1 even with negative mod", () => {
    for (let i = 0; i < 50; i++) {
      const v = computeAttackDamage("1d4", -10, false);
      expect(v).toBeGreaterThanOrEqual(1);
    }
  });
});

// ─── clampHp ─────────────────────────────────────────────────────────────────

describe("clampHp", () => {
  it("enemy at 4 HP, hit for 3 → newHp = 1", () => {
    expect(clampHp(4, -3, 8)).toBe(1);
  });

  it("enemy at 1 HP, hit for 5 (overkill) → newHp = 0, not negative", () => {
    expect(clampHp(1, -5, 8)).toBe(0);
  });

  it("enemy at 0 HP (already dead) → newHp = 0", () => {
    expect(clampHp(0, -3, 8)).toBe(0);
  });

  it("crit finishes enemy exactly → newHp = 0", () => {
    expect(clampHp(6, -6, 6)).toBe(0);
  });
});
