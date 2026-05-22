// ─── Dice Engine ─────────────────────────────────────────────────────────────
// Pure TypeScript dice functions. Zero framework dependencies. Zero Prisma
// imports. All functions are deterministic given the injectable rollFn pattern.
// ─────────────────────────────────────────────────────────────────────────────

// ─── D20 Result Interface ─────────────────────────────────────────────────────

/** Full audit trail for a d20 check. Returned by rollD20Check. */
export interface D20Result {
  /** Raw d20 face value (1–20). */
  roll: number;
  /** Applied modifier (ability modifier + proficiency bonus if applicable). */
  modifier: number;
  /** roll + modifier. */
  total: number;
  /** Difficulty Class or Armor Class being checked against. */
  dc: number;
  /** "AC" for attack rolls, "DC" for skill/ability checks. */
  dcType: "AC" | "DC";
  /** true if total >= dc. Natural 20 does NOT auto-succeed skill checks. */
  success: boolean;
  /** true if roll === 20 (natural 20). */
  critical: boolean;
  /** true if roll === 1 (natural 1 / fumble). */
  fumble: boolean;
}

// ─── Primitive Rollers ────────────────────────────────────────────────────────

/**
 * Roll a single die with the given number of sides.
 * Returns a value in [1, sides] inclusive.
 */
export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Roll XdY — roll `count` dice each with `sides` faces.
 * Returns each individual result and the sum total.
 */
export function rollDice(count: number, sides: number): { rolls: number[]; total: number } {
  const rolls = Array.from({ length: count }, () => rollDie(sides));
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
}

// ─── D&D 5e Modifiers ────────────────────────────────────────────────────────

/**
 * Standard D&D 5e ability modifier formula.
 * floor((score - 10) / 2)
 * Examples: 10 → 0, 8 → -1, 15 → 2, 20 → 5, 1 → -5
 */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Proficiency bonus by character level per D&D Basic Rules 2014 (levels 1–5).
 * Implemented as a step-function table — NOT a formula.
 * Levels 1–4 → +2, Level 5 → +3.
 */
export function proficiencyBonus(level: number): number {
  if (level >= 5) return 3;
  return 2;
}

// ─── d20 Check ───────────────────────────────────────────────────────────────

/**
 * Roll a d20 check against a DC or AC.
 *
 * The `rollFn` parameter (default: rollDie.bind(null, 20)) is injectable for
 * deterministic testing without vi.spyOn or vi.mock — pass `() => fixedValue`.
 *
 * Important: natural 20 does NOT auto-succeed skill checks (D&D 5e rule).
 * The `critical` flag is set, but `success` is still computed as total >= dc.
 *
 * @param modifier - Ability modifier + proficiency bonus (if applicable)
 * @param dc       - Target number (DC for skill checks, AC for attack rolls)
 * @param dcType   - "AC" for attack rolls, "DC" for skill/ability checks
 * @param rollFn   - Injectable die roller; defaults to a real d20 roll
 */
export function rollD20Check(
  modifier: number,
  dc: number,
  dcType: "AC" | "DC",
  rollFn: () => number = rollDie.bind(null, 20),
): D20Result {
  const roll = rollFn();
  const total = roll + modifier;
  return {
    roll,
    modifier,
    total,
    dc,
    dcType,
    success: total >= dc,
    critical: roll === 20,
    fumble: roll === 1,
  };
}
