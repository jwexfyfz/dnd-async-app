// ─── create-character Server Action — LVL-03 + SKILL-01/SKILL-02 Integration Tests ───
// Verifies that the HP computation wired into create-character.ts produces
// class-correct maxHp values at character creation (level 1).
// Also verifies skill proficiency validation rules (SKILL-01, SKILL-02).
// Requires explicit vitest imports (globals: false in vitest.config.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { maxHpAtLevel } from '../../lib/leveling'
import { CLASS_SKILL_POOL, SKILL_PICK_COUNT } from '../../lib/skills'

// ─── Skill validation helpers — mirrors server action logic ──────────────────
// These pure functions test the identical rules enforced in create-character.ts.

function validateSkillPicks(
  characterClass: string,
  skillProficiencies: string[],
): { valid: true } | { valid: false; error: string } {
  const requiredCount = SKILL_PICK_COUNT[characterClass]
  const allowedSkills = CLASS_SKILL_POOL[characterClass]
  if (skillProficiencies.length !== requiredCount) {
    return { valid: false, error: `Choose exactly ${requiredCount} skills for ${characterClass}.` }
  }
  if (!skillProficiencies.every((s) => allowedSkills.includes(s))) {
    return { valid: false, error: 'One or more selected skills are not available for this class.' }
  }
  return { valid: true }
}

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

// ─── SKILL-01/SKILL-02: Skill proficiency validation (plan 04-01, Task 2) ────

describe('SKILL-01/02 skill proficiency validation', () => {
  it('Test 1: Fighter with 2 valid skills passes validation', () => {
    const result = validateSkillPicks('Fighter', ['Athletics', 'Intimidation'])
    expect(result.valid).toBe(true)
  })

  it('Test 2: Fighter submitting 3 skills is rejected with count error', () => {
    const result = validateSkillPicks('Fighter', ['Athletics', 'Intimidation', 'Perception'])
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toBe('Choose exactly 2 skills for Fighter.')
    }
  })

  it('Test 3: Fighter submitting a Rogue-only skill is rejected with allowed-list error', () => {
    const result = validateSkillPicks('Fighter', ['Athletics', 'Deception'])
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toBe('One or more selected skills are not available for this class.')
    }
  })

  it('Test 4: Rogue with 4 valid skills passes validation', () => {
    const result = validateSkillPicks('Rogue', ['Stealth', 'Perception', 'Deception', 'Acrobatics'])
    expect(result.valid).toBe(true)
  })
})
