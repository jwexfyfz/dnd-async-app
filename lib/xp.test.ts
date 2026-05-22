// ─── XP Engine Unit Tests (XP-05) ────────────────────────────────────────────
// Tests all four exports of lib/xp.ts at boundary conditions.
// Covers all 10 required computeLevel threshold boundaries plus edge cases.
// Requires explicit vitest imports (globals: false in vitest.config.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { computeLevel, xpForNextLevel, XP_THRESHOLDS, XP_BY_DIFFICULTY } from './xp'

// ─── computeLevel ─────────────────────────────────────────────────────────────

describe('computeLevel', () => {
  it('0 XP → level 1 (level 1 start, exactly at threshold[0])', () => {
    expect(computeLevel(0)).toBe(1)
  })

  it('299 XP → level 1 (one below L2 threshold of 300)', () => {
    expect(computeLevel(299)).toBe(1)
  })

  it('300 XP → level 2 (exactly at L2 threshold)', () => {
    expect(computeLevel(300)).toBe(2)
  })

  it('301 XP → level 2 (one above L2 threshold)', () => {
    expect(computeLevel(301)).toBe(2)
  })

  it('899 XP → level 2 (one below L3 threshold of 900)', () => {
    expect(computeLevel(899)).toBe(2)
  })

  it('900 XP → level 3 (exactly at L3 threshold)', () => {
    expect(computeLevel(900)).toBe(3)
  })

  it('2699 XP → level 3 (one below L4 threshold of 2700)', () => {
    expect(computeLevel(2699)).toBe(3)
  })

  it('2700 XP → level 4 (exactly at L4 threshold)', () => {
    expect(computeLevel(2700)).toBe(4)
  })

  it('6499 XP → level 4 (one below L5 threshold of 6500 — one below cap)', () => {
    expect(computeLevel(6499)).toBe(4)
  })

  it('6500 XP → level 5 (exactly at L5 threshold — level cap)', () => {
    expect(computeLevel(6500)).toBe(5)
  })

  it('99999 XP → level 5 (XP far above cap stays at level 5)', () => {
    expect(computeLevel(99999)).toBe(5)
  })

  it('-1 XP → level 1 (negative XP floors to level 1 — never below minimum)', () => {
    expect(computeLevel(-1)).toBe(1)
  })
})

// ─── xpForNextLevel ───────────────────────────────────────────────────────────

describe('xpForNextLevel', () => {
  it('level 1 → 300 (next threshold for a level 1 character)', () => {
    expect(xpForNextLevel(1)).toBe(300)
  })

  it('level 2 → 900 (next threshold for a level 2 character)', () => {
    expect(xpForNextLevel(2)).toBe(900)
  })

  it('level 3 → 2700 (next threshold for a level 3 character)', () => {
    expect(xpForNextLevel(3)).toBe(2700)
  })

  it('level 4 → 6500 (next threshold for a level 4 character)', () => {
    expect(xpForNextLevel(4)).toBe(6500)
  })

  it('level 5 → null (at level cap — no next level)', () => {
    expect(xpForNextLevel(5)).toBeNull()
  })
})

// ─── XP_BY_DIFFICULTY ─────────────────────────────────────────────────────────

describe('XP_BY_DIFFICULTY', () => {
  it('Beginner difficulty → 50 XP', () => {
    expect(XP_BY_DIFFICULTY['Beginner']).toBe(50)
  })

  it('Standard difficulty → 100 XP', () => {
    expect(XP_BY_DIFFICULTY['Standard']).toBe(100)
  })

  it('Veteran difficulty → 200 XP', () => {
    expect(XP_BY_DIFFICULTY['Veteran']).toBe(200)
  })
})

// ─── XP_THRESHOLDS ────────────────────────────────────────────────────────────

describe('XP_THRESHOLDS', () => {
  it('has exactly 5 entries for levels 1–5', () => {
    expect(XP_THRESHOLDS).toHaveLength(5)
  })

  it('threshold values are [0, 300, 900, 2700, 6500] in order', () => {
    expect(XP_THRESHOLDS[0]).toBe(0)
    expect(XP_THRESHOLDS[1]).toBe(300)
    expect(XP_THRESHOLDS[2]).toBe(900)
    expect(XP_THRESHOLDS[3]).toBe(2700)
    expect(XP_THRESHOLDS[4]).toBe(6500)
  })
})
