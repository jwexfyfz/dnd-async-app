import { rollDice } from "./dice";
import { doubleDice } from "./dice-formula";

// Rolls a damage expression like "1d6+2", "2d8", "1d4-1". Returns minimum 1.
export function rollDamageExpr(expr: string): number {
  const m = expr.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!m) return 1;
  const count = parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const bonus = m[3] ? parseInt(m[3], 10) : 0;
  return Math.max(1, rollDice(count, sides).total + bonus);
}

// Computes final damage for a weapon attack hit per D&D 5e rules.
//   damageDice: base weapon dice without stat mod (e.g. "1d6" for shortsword, "1d6+1" for +1 sword)
//   statMod:    attacker's relevant ability modifier (STR or DEX)
//   isCrit:     true for natural 20 — dice are doubled, modifier applied once
export function computeAttackDamage(
  damageDice: string | null,
  statMod:    number,
  isCrit:     boolean,
): number {
  const base = damageDice ?? "1d4";
  const expr = isCrit ? doubleDice(base) : base;
  return Math.max(1, rollDamageExpr(expr) + statMod);
}
