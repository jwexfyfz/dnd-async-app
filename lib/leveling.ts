// ─── Leveling Engine ──────────────────────────────────────────────────────────
// Pure TypeScript leveling functions. Zero framework dependencies. Zero Prisma
// imports. All functions are deterministic.
// ─────────────────────────────────────────────────────────────────────────────

import { abilityModifier, proficiencyBonus } from "./dice";

// ─── Hit Die Table ────────────────────────────────────────────────────────────

/**
 * Class hit dice per D&D Basic Rules 2014 (levels 1–5 scope).
 * die  = face value (rolled at level 1 for max HP; we always take the max).
 * avg  = fixed average used for all subsequent level-ups (levels 2–5).
 * Source: REQUIREMENTS.md LVL-01 (authoritative).
 *
 * Fighter d10 avg 6 | Rogue d8 avg 5 | Cleric d8 avg 5 | Wizard d6 avg 4
 */
export const HIT_DIE_BY_CLASS: Record<string, { die: number; avg: number }> = {
  Fighter: { die: 10, avg: 6 },
  Rogue:   { die: 8,  avg: 5 },
  Cleric:  { die: 8,  avg: 5 },
  Wizard:  { die: 6,  avg: 4 },
};

// ─── maxHpAtLevel ─────────────────────────────────────────────────────────────

/**
 * Compute the total maximum HP for a character at a given level.
 *
 * Level 1 formula:  hitDie.die + abilityModifier(constitution)
 * Level N (N > 1):  previous total + hitDie.avg + abilityModifier(constitution)
 *
 * The function is a total-HP function: calling maxHpAtLevel(class, con, 5)
 * returns the cumulative total across levels 1–5, not just the level-5 gain.
 *
 * Throws a descriptive Error when characterClass is not a key of HIT_DIE_BY_CLASS
 * (V5 input validation, T-03-01 mitigation).
 *
 * @param characterClass - Character class string; must be a key of HIT_DIE_BY_CLASS
 * @param constitution   - Constitution ability score (1–20 for standard D&D 5e)
 * @param level          - Character level (1–5 for this milestone scope)
 * @returns Total max HP at the specified level
 */
export function maxHpAtLevel(
  characterClass: string,
  constitution: number,
  level: number,
): number {
  const hitDie = HIT_DIE_BY_CLASS[characterClass];
  if (!hitDie) throw new Error(`Unknown class: ${characterClass}`);
  const conMod = abilityModifier(constitution);
  // Level 1: max die face (not average) + CON modifier
  let hp = hitDie.die + conMod;
  // Levels 2–N: add fixed average die + CON modifier per level
  for (let l = 2; l <= level; l++) {
    hp += hitDie.avg + conMod;
  }
  return hp;
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

/**
 * Re-exported from lib/dice.ts so Phase 4 can import all leveling-related math
 * from a single source (D-11).
 *
 * Levels 1–4 → +2, Level 5 → +3 (D&D Basic Rules 2014).
 */
export { proficiencyBonus };
