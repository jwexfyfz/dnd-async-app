// ─── XP Engine ───────────────────────────────────────────────────────────────
// Pure TypeScript XP functions. Zero framework dependencies. Zero Prisma
// imports. All functions are deterministic.
// ─────────────────────────────────────────────────────────────────────────────

// ─── XP Thresholds ───────────────────────────────────────────────────────────

/**
 * Cumulative XP required to reach each level tier.
 * Index 0 = level 1 start (0 XP). Index N = cumulative XP required for level N+1.
 * Source: D&D 5e Player's Handbook (L1–20).
 *
 * XP_THRESHOLDS[0] = 0       → Level 1 (starting level)
 * XP_THRESHOLDS[1] = 300     → Level 2 threshold
 * ...
 * XP_THRESHOLDS[19] = 355000 → Level 20 threshold (cap)
 */
export const XP_THRESHOLDS: readonly number[] = [
  0, 300, 900, 2700, 6500,
  14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000,
  195000, 225000, 265000, 305000, 355000,
];

// ─── XP By Difficulty ────────────────────────────────────────────────────────

/**
 * XP awarded at encounter completion, keyed by StoryPrompt.difficulty.
 * Source: CONTEXT.md D-04.
 *
 * If the difficulty value is not in the table, callers should default to 0
 * via `XP_BY_DIFFICULTY[difficulty] ?? 0`.
 */
export const XP_BY_DIFFICULTY: Record<string, number> = {
  Beginner: 50,
  Standard: 100,
  Veteran:  200,
};

// ─── Level Computation ────────────────────────────────────────────────────────

/**
 * Compute the character level corresponding to a cumulative XP total.
 *
 * Iterates XP_THRESHOLDS from index 1 upward. For each threshold[i], if the
 * character's XP meets or exceeds that threshold, level advances to i + 1.
 * Stops as soon as XP falls below a threshold. Returns a value in [1, 20].
 *
 * @param xp - Cumulative XP total (non-negative; negative values floor to level 1)
 * @returns Level in the range [1, 20]
 */
export function computeLevel(xp: number): number {
  if (xp < 0) return 1;
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) {
      level = i + 1;
    } else {
      break;
    }
  }
  return Math.min(level, 20);
}

// ─── Next Level Threshold ─────────────────────────────────────────────────────

/**
 * Returns the cumulative XP required to reach the next level, or null if the
 * character is already at the level cap (level 20).
 *
 * @param level - Current character level (1–20)
 * @returns Cumulative XP threshold for the next level, or null at level cap
 */
export function xpForNextLevel(level: number): number | null {
  if (level <= 0 || level >= XP_THRESHOLDS.length) return null; // invalid or at cap (L20)
  return XP_THRESHOLDS[level]; // XP_THRESHOLDS[level] is the threshold for (level + 1)
}
