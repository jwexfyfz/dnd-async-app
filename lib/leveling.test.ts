// ─── Leveling Engine Unit Tests (LVL-01 + LVL-05) ────────────────────────────
// Tests all exports of lib/leveling.ts at boundary conditions.
// Covers LVL-01 (maxHpAtLevel correctness for all 4 classes) and LVL-05 (CON
// modifier edge cases: -2/0/+3 at levels 1-5 for all classes = 48 assertions).
// Requires explicit vitest imports (globals: false in vitest.config.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { HIT_DIE_BY_CLASS, maxHpAtLevel, proficiencyBonus } from './leveling'

// ─── HIT_DIE_BY_CLASS ─────────────────────────────────────────────────────────

describe('HIT_DIE_BY_CLASS', () => {
  it('Fighter → { die: 10, avg: 6 } (d10 hit die, average 6 per level after L1)', () => {
    expect(HIT_DIE_BY_CLASS['Fighter']).toEqual({ die: 10, avg: 6 })
  })

  it('Rogue → { die: 8, avg: 5 } (d8 hit die, average 5 per level after L1)', () => {
    expect(HIT_DIE_BY_CLASS['Rogue']).toEqual({ die: 8, avg: 5 })
  })

  it('Cleric → { die: 8, avg: 5 } (d8 hit die, average 5 per level after L1)', () => {
    expect(HIT_DIE_BY_CLASS['Cleric']).toEqual({ die: 8, avg: 5 })
  })

  it('Wizard → { die: 6, avg: 4 } (d6 hit die, average 4 per level after L1)', () => {
    expect(HIT_DIE_BY_CLASS['Wizard']).toEqual({ die: 6, avg: 4 })
  })
})

// ─── maxHpAtLevel — LVL-01 base cases (level 1, max die + CON mod) ────────────

describe('maxHpAtLevel level-1 base cases', () => {
  it('"Fighter", 14, 1 → 12 (10 + 2 CON mod)', () => {
    expect(maxHpAtLevel('Fighter', 14, 1)).toBe(12)
  })

  it('"Rogue", 10, 1 → 8 (8 + 0 CON mod)', () => {
    expect(maxHpAtLevel('Rogue', 10, 1)).toBe(8)
  })

  it('"Cleric", 16, 1 → 11 (8 + 3 CON mod)', () => {
    expect(maxHpAtLevel('Cleric', 16, 1)).toBe(11)
  })

  it('"Wizard", 6, 1 → 4 (6 + (-2) CON mod)', () => {
    expect(maxHpAtLevel('Wizard', 6, 1)).toBe(4)
  })
})

// ─── maxHpAtLevel — LVL-05 fixture grid (4 classes × 5 levels × 3 CON mods) ──
// Fighter (die 10, avg 6)

describe('maxHpAtLevel Fighter CON 6 (mod -2)', () => {
  it('"Fighter", 6, 1 → 8 (10 + (-2))', () => {
    expect(maxHpAtLevel('Fighter', 6, 1)).toBe(8)
  })
  it('"Fighter", 6, 2 → 12 (8 + 6 + (-2))', () => {
    expect(maxHpAtLevel('Fighter', 6, 2)).toBe(12)
  })
  it('"Fighter", 6, 3 → 16 (12 + 6 + (-2))', () => {
    expect(maxHpAtLevel('Fighter', 6, 3)).toBe(16)
  })
  it('"Fighter", 6, 4 → 20 (16 + 6 + (-2))', () => {
    expect(maxHpAtLevel('Fighter', 6, 4)).toBe(20)
  })
  it('"Fighter", 6, 5 → 24 (20 + 6 + (-2))', () => {
    expect(maxHpAtLevel('Fighter', 6, 5)).toBe(24)
  })
})

describe('maxHpAtLevel Fighter CON 10 (mod 0)', () => {
  it('"Fighter", 10, 1 → 10 (10 + 0)', () => {
    expect(maxHpAtLevel('Fighter', 10, 1)).toBe(10)
  })
  it('"Fighter", 10, 2 → 16 (10 + 6 + 0)', () => {
    expect(maxHpAtLevel('Fighter', 10, 2)).toBe(16)
  })
  it('"Fighter", 10, 3 → 22 (16 + 6 + 0)', () => {
    expect(maxHpAtLevel('Fighter', 10, 3)).toBe(22)
  })
  it('"Fighter", 10, 4 → 28 (22 + 6 + 0)', () => {
    expect(maxHpAtLevel('Fighter', 10, 4)).toBe(28)
  })
  it('"Fighter", 10, 5 → 34 (28 + 6 + 0)', () => {
    expect(maxHpAtLevel('Fighter', 10, 5)).toBe(34)
  })
})

describe('maxHpAtLevel Fighter CON 16 (mod +3)', () => {
  it('"Fighter", 16, 1 → 13 (10 + 3)', () => {
    expect(maxHpAtLevel('Fighter', 16, 1)).toBe(13)
  })
  it('"Fighter", 16, 2 → 22 (13 + 6 + 3)', () => {
    expect(maxHpAtLevel('Fighter', 16, 2)).toBe(22)
  })
  it('"Fighter", 16, 3 → 31 (22 + 6 + 3)', () => {
    expect(maxHpAtLevel('Fighter', 16, 3)).toBe(31)
  })
  it('"Fighter", 16, 4 → 40 (31 + 6 + 3)', () => {
    expect(maxHpAtLevel('Fighter', 16, 4)).toBe(40)
  })
  it('"Fighter", 16, 5 → 49 (40 + 6 + 3)', () => {
    expect(maxHpAtLevel('Fighter', 16, 5)).toBe(49)
  })
})

// Rogue (die 8, avg 5)

describe('maxHpAtLevel Rogue CON 6 (mod -2)', () => {
  it('"Rogue", 6, 1 → 6 (8 + (-2))', () => {
    expect(maxHpAtLevel('Rogue', 6, 1)).toBe(6)
  })
  it('"Rogue", 6, 2 → 9 (6 + 5 + (-2))', () => {
    expect(maxHpAtLevel('Rogue', 6, 2)).toBe(9)
  })
  it('"Rogue", 6, 3 → 12 (9 + 5 + (-2))', () => {
    expect(maxHpAtLevel('Rogue', 6, 3)).toBe(12)
  })
  it('"Rogue", 6, 4 → 15 (12 + 5 + (-2))', () => {
    expect(maxHpAtLevel('Rogue', 6, 4)).toBe(15)
  })
  it('"Rogue", 6, 5 → 18 (15 + 5 + (-2))', () => {
    expect(maxHpAtLevel('Rogue', 6, 5)).toBe(18)
  })
})

describe('maxHpAtLevel Rogue CON 10 (mod 0)', () => {
  it('"Rogue", 10, 1 → 8 (8 + 0)', () => {
    expect(maxHpAtLevel('Rogue', 10, 1)).toBe(8)
  })
  it('"Rogue", 10, 2 → 13 (8 + 5 + 0)', () => {
    expect(maxHpAtLevel('Rogue', 10, 2)).toBe(13)
  })
  it('"Rogue", 10, 3 → 18 (13 + 5 + 0)', () => {
    expect(maxHpAtLevel('Rogue', 10, 3)).toBe(18)
  })
  it('"Rogue", 10, 4 → 23 (18 + 5 + 0)', () => {
    expect(maxHpAtLevel('Rogue', 10, 4)).toBe(23)
  })
  it('"Rogue", 10, 5 → 28 (23 + 5 + 0)', () => {
    expect(maxHpAtLevel('Rogue', 10, 5)).toBe(28)
  })
})

describe('maxHpAtLevel Rogue CON 16 (mod +3)', () => {
  it('"Rogue", 16, 1 → 11 (8 + 3)', () => {
    expect(maxHpAtLevel('Rogue', 16, 1)).toBe(11)
  })
  it('"Rogue", 16, 2 → 19 (11 + 5 + 3)', () => {
    expect(maxHpAtLevel('Rogue', 16, 2)).toBe(19)
  })
  it('"Rogue", 16, 3 → 27 (19 + 5 + 3)', () => {
    expect(maxHpAtLevel('Rogue', 16, 3)).toBe(27)
  })
  it('"Rogue", 16, 4 → 35 (27 + 5 + 3)', () => {
    expect(maxHpAtLevel('Rogue', 16, 4)).toBe(35)
  })
  it('"Rogue", 16, 5 → 43 (35 + 5 + 3)', () => {
    expect(maxHpAtLevel('Rogue', 16, 5)).toBe(43)
  })
})

// Cleric (die 8, avg 5) — identical math to Rogue

describe('maxHpAtLevel Cleric CON 6 (mod -2)', () => {
  it('"Cleric", 6, 1 → 6 (8 + (-2))', () => {
    expect(maxHpAtLevel('Cleric', 6, 1)).toBe(6)
  })
  it('"Cleric", 6, 2 → 9 (6 + 5 + (-2))', () => {
    expect(maxHpAtLevel('Cleric', 6, 2)).toBe(9)
  })
  it('"Cleric", 6, 3 → 12 (9 + 5 + (-2))', () => {
    expect(maxHpAtLevel('Cleric', 6, 3)).toBe(12)
  })
  it('"Cleric", 6, 4 → 15 (12 + 5 + (-2))', () => {
    expect(maxHpAtLevel('Cleric', 6, 4)).toBe(15)
  })
  it('"Cleric", 6, 5 → 18 (15 + 5 + (-2))', () => {
    expect(maxHpAtLevel('Cleric', 6, 5)).toBe(18)
  })
})

describe('maxHpAtLevel Cleric CON 10 (mod 0)', () => {
  it('"Cleric", 10, 1 → 8 (8 + 0)', () => {
    expect(maxHpAtLevel('Cleric', 10, 1)).toBe(8)
  })
  it('"Cleric", 10, 2 → 13 (8 + 5 + 0)', () => {
    expect(maxHpAtLevel('Cleric', 10, 2)).toBe(13)
  })
  it('"Cleric", 10, 3 → 18 (13 + 5 + 0)', () => {
    expect(maxHpAtLevel('Cleric', 10, 3)).toBe(18)
  })
  it('"Cleric", 10, 4 → 23 (18 + 5 + 0)', () => {
    expect(maxHpAtLevel('Cleric', 10, 4)).toBe(23)
  })
  it('"Cleric", 10, 5 → 28 (23 + 5 + 0)', () => {
    expect(maxHpAtLevel('Cleric', 10, 5)).toBe(28)
  })
})

describe('maxHpAtLevel Cleric CON 16 (mod +3)', () => {
  it('"Cleric", 16, 1 → 11 (8 + 3)', () => {
    expect(maxHpAtLevel('Cleric', 16, 1)).toBe(11)
  })
  it('"Cleric", 16, 2 → 19 (11 + 5 + 3)', () => {
    expect(maxHpAtLevel('Cleric', 16, 2)).toBe(19)
  })
  it('"Cleric", 16, 3 → 27 (19 + 5 + 3)', () => {
    expect(maxHpAtLevel('Cleric', 16, 3)).toBe(27)
  })
  it('"Cleric", 16, 4 → 35 (27 + 5 + 3)', () => {
    expect(maxHpAtLevel('Cleric', 16, 4)).toBe(35)
  })
  it('"Cleric", 16, 5 → 43 (35 + 5 + 3)', () => {
    expect(maxHpAtLevel('Cleric', 16, 5)).toBe(43)
  })
})

// Wizard (die 6, avg 4)

describe('maxHpAtLevel Wizard CON 6 (mod -2)', () => {
  it('"Wizard", 6, 1 → 4 (6 + (-2))', () => {
    expect(maxHpAtLevel('Wizard', 6, 1)).toBe(4)
  })
  it('"Wizard", 6, 2 → 6 (4 + 4 + (-2))', () => {
    expect(maxHpAtLevel('Wizard', 6, 2)).toBe(6)
  })
  it('"Wizard", 6, 3 → 8 (6 + 4 + (-2))', () => {
    expect(maxHpAtLevel('Wizard', 6, 3)).toBe(8)
  })
  it('"Wizard", 6, 4 → 10 (8 + 4 + (-2))', () => {
    expect(maxHpAtLevel('Wizard', 6, 4)).toBe(10)
  })
  it('"Wizard", 6, 5 → 12 (10 + 4 + (-2))', () => {
    expect(maxHpAtLevel('Wizard', 6, 5)).toBe(12)
  })
})

describe('maxHpAtLevel Wizard CON 10 (mod 0)', () => {
  it('"Wizard", 10, 1 → 6 (6 + 0)', () => {
    expect(maxHpAtLevel('Wizard', 10, 1)).toBe(6)
  })
  it('"Wizard", 10, 2 → 10 (6 + 4 + 0)', () => {
    expect(maxHpAtLevel('Wizard', 10, 2)).toBe(10)
  })
  it('"Wizard", 10, 3 → 14 (10 + 4 + 0)', () => {
    expect(maxHpAtLevel('Wizard', 10, 3)).toBe(14)
  })
  it('"Wizard", 10, 4 → 18 (14 + 4 + 0)', () => {
    expect(maxHpAtLevel('Wizard', 10, 4)).toBe(18)
  })
  it('"Wizard", 10, 5 → 22 (18 + 4 + 0)', () => {
    expect(maxHpAtLevel('Wizard', 10, 5)).toBe(22)
  })
})

describe('maxHpAtLevel Wizard CON 16 (mod +3)', () => {
  it('"Wizard", 16, 1 → 9 (6 + 3)', () => {
    expect(maxHpAtLevel('Wizard', 16, 1)).toBe(9)
  })
  it('"Wizard", 16, 2 → 16 (9 + 4 + 3)', () => {
    expect(maxHpAtLevel('Wizard', 16, 2)).toBe(16)
  })
  it('"Wizard", 16, 3 → 23 (16 + 4 + 3)', () => {
    expect(maxHpAtLevel('Wizard', 16, 3)).toBe(23)
  })
  it('"Wizard", 16, 4 → 30 (23 + 4 + 3)', () => {
    expect(maxHpAtLevel('Wizard', 16, 4)).toBe(30)
  })
  it('"Wizard", 16, 5 → 37 (30 + 4 + 3)', () => {
    expect(maxHpAtLevel('Wizard', 16, 5)).toBe(37)
  })
})

// ─── maxHpAtLevel — LVL-02 multi-level-up consistency ────────────────────────

describe('maxHpAtLevel multi-level-up consistency (LVL-02)', () => {
  it('"Fighter", 14, 5 → 44 (12 + 8 + 8 + 8 + 8 — stepwise sum matches direct call)', () => {
    expect(maxHpAtLevel('Fighter', 14, 5)).toBe(44)
  })

  it('"Wizard", 8, 5 → 17 (5 + 3 + 3 + 3 + 3 — stepwise sum matches direct call)', () => {
    expect(maxHpAtLevel('Wizard', 8, 5)).toBe(17)
  })

  it('"Rogue", 10, 5 → 28 (8 + 5 + 5 + 5 + 5 — stepwise sum matches direct call)', () => {
    expect(maxHpAtLevel('Rogue', 10, 5)).toBe(28)
  })

  it('"Cleric", 16, 5 → 43 (11 + 8 + 8 + 8 + 8 — stepwise: avg 5 + mod 3 = 8 per level after L1)', () => {
    expect(maxHpAtLevel('Cleric', 16, 5)).toBe(43)
  })
})

// ─── maxHpAtLevel — V5 Input Validation (unknown class throws) ────────────────

describe('maxHpAtLevel unknown class throws (V5 input validation)', () => {
  it('"Paladin", 14, 1 → throws Error with message containing "Unknown class: Paladin"', () => {
    expect(() => maxHpAtLevel('Paladin', 14, 1)).toThrow(/Unknown class: Paladin/)
  })

  it('"", 14, 1 → throws Error with message containing "Unknown class:"', () => {
    expect(() => maxHpAtLevel('', 14, 1)).toThrow(/Unknown class:/)
  })
})

// ─── proficiencyBonus re-export (D-11) ────────────────────────────────────────

describe('proficiencyBonus re-export from lib/leveling.ts (D-11)', () => {
  it('proficiencyBonus(1) → 2 (levels 1–4 return +2)', () => {
    expect(proficiencyBonus(1)).toBe(2)
  })

  it('proficiencyBonus(2) → 2', () => {
    expect(proficiencyBonus(2)).toBe(2)
  })

  it('proficiencyBonus(3) → 2', () => {
    expect(proficiencyBonus(3)).toBe(2)
  })

  it('proficiencyBonus(4) → 2', () => {
    expect(proficiencyBonus(4)).toBe(2)
  })

  it('proficiencyBonus(5) → 3 (level 5 returns +3)', () => {
    expect(proficiencyBonus(5)).toBe(3)
  })
})
