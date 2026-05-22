// ─── create-character Server Action — LVL-03 Integration Tests ───────────────
// Verifies that the HP computation wired into create-character.ts produces
// class-correct maxHp values at character creation (level 1).
// These tests validate the business logic that create-character.ts must call
// maxHpAtLevel(characterClass, constitution, 1) and persist the result.
// Requires explicit vitest imports (globals: false in vitest.config.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { maxHpAtLevel } from '../../lib/leveling'

// ─── LVL-03: Class-aware maxHp at character creation ─────────────────────────
// These are the exact cases from the plan <behavior> block.
// create-character.ts must call maxHpAtLevel(characterClass, constitution, 1).

describe('LVL-03 create-character maxHp computation', () => {
  it('Fighter CON 14 → maxHp = 12 (10 die + 2 con mod)', () => {
    expect(maxHpAtLevel('Fighter', 14, 1)).toBe(12)
  })

  it('Wizard CON 10 → maxHp = 6 (6 die + 0 con mod)', () => {
    expect(maxHpAtLevel('Wizard', 10, 1)).toBe(6)
  })

  it('Rogue CON 8 → maxHp = 7 (8 die + (-1) con mod)', () => {
    expect(maxHpAtLevel('Rogue', 8, 1)).toBe(7)
  })

  it('Cleric CON 16 → maxHp = 11 (8 die + 3 con mod)', () => {
    expect(maxHpAtLevel('Cleric', 16, 1)).toBe(11)
  })

  it('unknown class throws descriptive error (defense-in-depth, T-03-04)', () => {
    expect(() => maxHpAtLevel('Paladin', 12, 1)).toThrow('Unknown class: Paladin')
  })
})
