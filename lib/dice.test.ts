// ─── Dice Engine Unit Tests (DICE-05) ────────────────────────────────────────
// Tests all five exports of lib/dice.ts at boundary conditions.
// Uses injectable rollFn for all rollD20Check tests — no vi.spyOn or vi.mock.
// Requires explicit vitest imports (globals: false in vitest.config.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  rollDie,
  rollDice,
  abilityModifier,
  proficiencyBonus,
  rollD20Check,
} from './dice'

// ─── rollDie ─────────────────────────────────────────────────────────────────

describe('rollDie', () => {
  it('rollDie(6) always returns a value in [1, 6] over 100 iterations', () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDie(6)
      expect(result).toBeGreaterThanOrEqual(1)
      expect(result).toBeLessThanOrEqual(6)
    }
  })

  it('rollDie(20) always returns a value in [1, 20] over 100 iterations', () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDie(20)
      expect(result).toBeGreaterThanOrEqual(1)
      expect(result).toBeLessThanOrEqual(20)
    }
  })

  it('rollDie(1) always returns 1', () => {
    for (let i = 0; i < 20; i++) {
      expect(rollDie(1)).toBe(1)
    }
  })
})

// ─── rollDice ─────────────────────────────────────────────────────────────────

describe('rollDice', () => {
  it('rollDice(3, 6) returns 3 rolls each in [1,6] and total equals sum of rolls', () => {
    const result = rollDice(3, 6)
    expect(result.rolls).toHaveLength(3)
    for (const r of result.rolls) {
      expect(r).toBeGreaterThanOrEqual(1)
      expect(r).toBeLessThanOrEqual(6)
    }
    const expectedTotal = result.rolls.reduce((a, b) => a + b, 0)
    expect(result.total).toBe(expectedTotal)
  })

  it('rollDice(1, 1) returns rolls=[1] and total=1', () => {
    const result = rollDice(1, 1)
    expect(result.rolls).toEqual([1])
    expect(result.total).toBe(1)
  })
})

// ─── abilityModifier ──────────────────────────────────────────────────────────

describe('abilityModifier', () => {
  it('score 1 → -5 (minimum ability score)', () => {
    expect(abilityModifier(1)).toBe(-5)
  })

  it('score 8 → -1', () => {
    expect(abilityModifier(8)).toBe(-1)
  })

  it('score 9 → -1 (borderline: floor((9-10)/2) = floor(-0.5) = -1)', () => {
    expect(abilityModifier(9)).toBe(-1)
  })

  it('score 10 → 0 (baseline)', () => {
    expect(abilityModifier(10)).toBe(0)
  })

  it('score 11 → 0', () => {
    expect(abilityModifier(11)).toBe(0)
  })

  it('score 12 → 1', () => {
    expect(abilityModifier(12)).toBe(1)
  })

  it('score 15 → 2', () => {
    expect(abilityModifier(15)).toBe(2)
  })

  it('score 20 → 5 (maximum standard ability score)', () => {
    expect(abilityModifier(20)).toBe(5)
  })
})

// ─── proficiencyBonus ────────────────────────────────────────────────────────

describe('proficiencyBonus', () => {
  it('level 1 → 2', () => {
    expect(proficiencyBonus(1)).toBe(2)
  })

  it('level 2 → 2', () => {
    expect(proficiencyBonus(2)).toBe(2)
  })

  it('level 3 → 2', () => {
    expect(proficiencyBonus(3)).toBe(2)
  })

  it('level 4 → 2 (boundary: last level before step-up)', () => {
    expect(proficiencyBonus(4)).toBe(2)
  })

  it('level 5 → 3 (boundary: first level of step-up)', () => {
    expect(proficiencyBonus(5)).toBe(3)
  })
})

// ─── rollD20Check ─────────────────────────────────────────────────────────────

describe('rollD20Check', () => {
  it('roll=14, modifier=3, dc=14, dcType="AC": total=17, success=true, dcType="AC"', () => {
    const result = rollD20Check(3, 14, 'AC', () => 14)
    expect(result.roll).toBe(14)
    expect(result.modifier).toBe(3)
    expect(result.total).toBe(17)
    expect(result.dc).toBe(14)
    expect(result.dcType).toBe('AC')
    expect(result.success).toBe(true)
    expect(result.critical).toBe(false)
    expect(result.fumble).toBe(false)
  })

  it('roll=10, modifier=3, dc=15, dcType="DC": total=13, success=false, dcType="DC"', () => {
    const result = rollD20Check(3, 15, 'DC', () => 10)
    expect(result.roll).toBe(10)
    expect(result.modifier).toBe(3)
    expect(result.total).toBe(13)
    expect(result.dc).toBe(15)
    expect(result.dcType).toBe('DC')
    expect(result.success).toBe(false)
    expect(result.critical).toBe(false)
    expect(result.fumble).toBe(false)
  })

  it('roll=14, modifier=0, dc=15, dcType="DC": total=14, success=false (exactly one below DC)', () => {
    const result = rollD20Check(0, 15, 'DC', () => 14)
    expect(result.total).toBe(14)
    expect(result.success).toBe(false)
  })

  it('roll=15, modifier=0, dc=15, dcType="DC": total=15, success=true (exactly at DC)', () => {
    const result = rollD20Check(0, 15, 'DC', () => 15)
    expect(result.total).toBe(15)
    expect(result.success).toBe(true)
  })

  it('roll=20: critical=true regardless of modifier or dc', () => {
    const result = rollD20Check(3, 14, 'AC', () => 20)
    expect(result.critical).toBe(true)
    expect(result.fumble).toBe(false)
  })

  it('roll=1: fumble=true regardless of modifier or total', () => {
    const result = rollD20Check(3, 14, 'AC', () => 1)
    expect(result.fumble).toBe(true)
    expect(result.critical).toBe(false)
  })

  // L4 guard: nat 20 does NOT auto-succeed skill checks — success depends on total >= dc
  it('roll=20, modifier=0, dc=25, dcType="DC": critical=true but success=false (nat 20 no auto-succeed on skill checks)', () => {
    const result = rollD20Check(0, 25, 'DC', () => 20)
    expect(result.critical).toBe(true)
    expect(result.success).toBe(false)
  })

  // Fumble flag even when the total would succeed
  it('roll=1, modifier=10, dc=5, dcType="DC": fumble=true even though total=11 beats dc=5', () => {
    const result = rollD20Check(10, 5, 'DC', () => 1)
    expect(result.fumble).toBe(true)
    expect(result.total).toBe(11)
    expect(result.success).toBe(true)
  })

  it('dcType "AC" is preserved on result', () => {
    const result = rollD20Check(2, 12, 'AC', () => 10)
    expect(result.dcType).toBe('AC')
  })

  it('dcType "DC" is preserved on result', () => {
    const result = rollD20Check(2, 12, 'DC', () => 10)
    expect(result.dcType).toBe('DC')
  })
})
