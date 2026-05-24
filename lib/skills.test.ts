// ─── Skills Engine Unit Tests (SKILL-03 + SKILL-05) ──────────────────────────
// Tests all exports of lib/skills.ts at boundary conditions.
// Covers SKILL-03 (SKILL_ABILITY_MAP / SKILLS constant correctness, class pools)
// and SKILL-05 (resolveSkillCheck: proficient, non-proficient, DC boundary,
// unknown skill throw).
// Requires explicit vitest imports (globals: false in vitest.config.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  SKILL_ABILITY_MAP,
  SKILLS,
  CLASS_SKILL_POOL,
  SKILL_PICK_COUNT,
  resolveSkillCheck,
} from './skills'

// ─── SKILL_ABILITY_MAP constant ───────────────────────────────────────────────

describe('SKILL_ABILITY_MAP', () => {
  it('has exactly 18 entries', () => {
    expect(Object.keys(SKILL_ABILITY_MAP).length).toBe(18)
  })

  it('Stealth → dexterity', () => {
    expect(SKILL_ABILITY_MAP['Stealth']).toBe('dexterity')
  })

  it('Athletics → strength', () => {
    expect(SKILL_ABILITY_MAP['Athletics']).toBe('strength')
  })

  it('Arcana → intelligence', () => {
    expect(SKILL_ABILITY_MAP['Arcana']).toBe('intelligence')
  })

  it('Insight → wisdom', () => {
    expect(SKILL_ABILITY_MAP['Insight']).toBe('wisdom')
  })

  it('Intimidation → charisma', () => {
    expect(SKILL_ABILITY_MAP['Intimidation']).toBe('charisma')
  })
})

// ─── SKILLS alias (REQUIREMENTS.md SKILL-03 literal compliance) ───────────────

describe('SKILLS alias', () => {
  it('SKILLS is the same object reference as SKILL_ABILITY_MAP', () => {
    expect(SKILLS).toBe(SKILL_ABILITY_MAP)
  })

  it('SKILLS["Stealth"] === "dexterity"', () => {
    expect(SKILLS['Stealth']).toBe('dexterity')
  })
})

// ─── CLASS_SKILL_POOL and SKILL_PICK_COUNT ────────────────────────────────────

describe('CLASS_SKILL_POOL lengths', () => {
  it('Fighter pool has 8 skills', () => {
    expect(CLASS_SKILL_POOL['Fighter'].length).toBe(8)
  })

  it('Rogue pool has 11 skills', () => {
    expect(CLASS_SKILL_POOL['Rogue'].length).toBe(11)
  })

  it('Cleric pool has 5 skills', () => {
    expect(CLASS_SKILL_POOL['Cleric'].length).toBe(5)
  })

  it('Wizard pool has 6 skills', () => {
    expect(CLASS_SKILL_POOL['Wizard'].length).toBe(6)
  })
})

describe('SKILL_PICK_COUNT', () => {
  it('Fighter picks 2 skills', () => {
    expect(SKILL_PICK_COUNT['Fighter']).toBe(2)
  })

  it('Rogue picks 4 skills', () => {
    expect(SKILL_PICK_COUNT['Rogue']).toBe(4)
  })

  it('Cleric picks 2 skills', () => {
    expect(SKILL_PICK_COUNT['Cleric']).toBe(2)
  })

  it('Wizard picks 2 skills', () => {
    expect(SKILL_PICK_COUNT['Wizard']).toBe(2)
  })
})

// ─── resolveSkillCheck — proficient character ─────────────────────────────────

describe('resolveSkillCheck — proficient character (Rogue level 1, DEX 14, DC 12, roll 10)', () => {
  const character = {
    characterClass: 'Rogue',
    level: 1,
    strength: 10,
    dexterity: 14,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
    skillProficiencies: ['Stealth'],
  }
  const result = resolveSkillCheck('Stealth', character, 12, () => 10)

  it('result.proficient === true', () => {
    expect(result.proficient).toBe(true)
  })

  it('result.roll === 10', () => {
    expect(result.roll).toBe(10)
  })

  it('result.modifier === 2 (DEX 14 → mod +2)', () => {
    expect(result.modifier).toBe(2)
  })

  it('result.proficiencyBonus === 2 (proficiencyBonus(1) = 2)', () => {
    expect(result.proficiencyBonus).toBe(2)
  })

  it('result.total === 14 (10 + 2 + 2)', () => {
    expect(result.total).toBe(14)
  })

  it('result.success === true (14 >= 12)', () => {
    expect(result.success).toBe(true)
  })

  it('result.dc === 12', () => {
    expect(result.dc).toBe(12)
  })

  it('result.abilityScore === "dexterity"', () => {
    expect(result.abilityScore).toBe('dexterity')
  })

  it('result.skill === "Stealth"', () => {
    expect(result.skill).toBe('Stealth')
  })
})

// ─── resolveSkillCheck — non-proficient character ─────────────────────────────

describe('resolveSkillCheck — non-proficient character (Fighter level 1, DEX 14, DC 12, roll 10)', () => {
  const character = {
    characterClass: 'Fighter',
    level: 1,
    strength: 10,
    dexterity: 14,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
    skillProficiencies: [],
  }
  const result = resolveSkillCheck('Stealth', character, 12, () => 10)

  it('result.proficient === false', () => {
    expect(result.proficient).toBe(false)
  })

  it('result.proficiencyBonus === 0 (not proficient)', () => {
    expect(result.proficiencyBonus).toBe(0)
  })

  it('result.total === 12 (10 + 2 + 0)', () => {
    expect(result.total).toBe(12)
  })

  it('result.success === true (12 >= 12 — exactly at DC is success)', () => {
    expect(result.success).toBe(true)
  })
})

// ─── resolveSkillCheck — DC boundary conditions ───────────────────────────────

describe('resolveSkillCheck — DC boundary conditions (DC 12, no proficiency, DEX 14)', () => {
  const character = {
    characterClass: 'Fighter',
    level: 1,
    strength: 10,
    dexterity: 14,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
    skillProficiencies: [],
  }

  it('total 11 (roll 9 + mod 2 + bonus 0): success === false (11 < 12)', () => {
    const result = resolveSkillCheck('Stealth', character, 12, () => 9)
    expect(result.total).toBe(11)
    expect(result.success).toBe(false)
  })

  it('total 12 (roll 10 + mod 2 + bonus 0): success === true (12 >= 12)', () => {
    const result = resolveSkillCheck('Stealth', character, 12, () => 10)
    expect(result.total).toBe(12)
    expect(result.success).toBe(true)
  })

  it('total 13 (roll 11 + mod 2 + bonus 0): success === true (13 >= 12)', () => {
    const result = resolveSkillCheck('Stealth', character, 12, () => 11)
    expect(result.total).toBe(13)
    expect(result.success).toBe(true)
  })
})

// ─── resolveSkillCheck — unknown skill throws ─────────────────────────────────

describe('resolveSkillCheck — unknown skill throws', () => {
  const character = {
    characterClass: 'Fighter',
    level: 1,
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
    skillProficiencies: [],
  }

  it('throws Error matching /Unknown skill: Lockpicking/', () => {
    expect(() => resolveSkillCheck('Lockpicking', character, 12)).toThrow(
      /Unknown skill: Lockpicking/,
    )
  })
})
