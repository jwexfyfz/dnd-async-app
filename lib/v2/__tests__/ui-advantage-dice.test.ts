import { describe, it, expect } from 'vitest';

// Pure logic extracted from the advantage dice UI.
// These mirror the inline logic in CombatRollSheet and page.tsx so they can be tested independently.

function getDiceCount(statusEffects: string[]): 1 | 2 | 3 {
  if (statusEffects.includes('elven_accuracy_next_attack')) return 3;
  if (statusEffects.includes('advantage_next_attack')) return 2;
  return 1;
}

function getWinnerIdx(allRolls: number[]): number {
  return allRolls.indexOf(Math.max(...allRolls));
}

function mapAllRolls(d20Rolls: [number, number] | undefined): number[] | undefined {
  return d20Rolls ? [...d20Rolls] : undefined;
}

// ── diceCount derivation ─────────────────────────────────────────────────────

describe('getDiceCount — from status_effects', () => {
  it('returns 1 for no relevant effects', () => {
    expect(getDiceCount([])).toBe(1);
    expect(getDiceCount(['poisoned', 'prone'])).toBe(1);
  });

  it('returns 2 for advantage_next_attack', () => {
    expect(getDiceCount(['advantage_next_attack'])).toBe(2);
    expect(getDiceCount(['poisoned', 'advantage_next_attack'])).toBe(2);
  });

  it('returns 3 for elven_accuracy_next_attack', () => {
    expect(getDiceCount(['elven_accuracy_next_attack'])).toBe(3);
    expect(getDiceCount(['advantage_next_attack', 'elven_accuracy_next_attack'])).toBe(3);
  });

  it('elven_accuracy takes priority over advantage alone', () => {
    expect(getDiceCount(['advantage_next_attack', 'elven_accuracy_next_attack'])).toBe(3);
  });
});

// ── winner index (which die to highlight) ────────────────────────────────────

describe('getWinnerIdx — kept die for display', () => {
  it('single die is always winner', () => {
    expect(getWinnerIdx([15])).toBe(0);
  });

  it('picks the higher of two rolls (index 0)', () => {
    expect(getWinnerIdx([18, 7])).toBe(0);
  });

  it('picks the higher of two rolls (index 1)', () => {
    expect(getWinnerIdx([5, 14])).toBe(1);
  });

  it('on a tie, picks the first occurrence', () => {
    expect(getWinnerIdx([12, 12])).toBe(0);
  });

  it('three dice — picks highest', () => {
    expect(getWinnerIdx([8, 17, 3])).toBe(1);
    expect(getWinnerIdx([20, 6, 14])).toBe(0);
    expect(getWinnerIdx([4, 11, 19])).toBe(2);
  });

  it('three dice — tie picks first occurrence', () => {
    expect(getWinnerIdx([15, 15, 9])).toBe(0);
    expect(getWinnerIdx([9, 15, 15])).toBe(1);
  });

  it('natural 20 in any slot wins', () => {
    expect(getWinnerIdx([1, 20])).toBe(1);
    expect(getWinnerIdx([20, 1])).toBe(0);
    expect(getWinnerIdx([1, 1, 20])).toBe(2);
  });

  it('natural 1 fumble — loser when paired with anything higher', () => {
    expect(getWinnerIdx([1, 2])).toBe(1);
  });
});

// ── allRolls mapping (game-controller forwarding) ────────────────────────────

describe('mapAllRolls — d20Rolls → allRolls', () => {
  it('returns undefined when no advantage roll', () => {
    expect(mapAllRolls(undefined)).toBeUndefined();
  });

  it('returns a copy of both rolls for advantage', () => {
    const result = mapAllRolls([14, 7]);
    expect(result).toEqual([14, 7]);
  });

  it('returns independent copy (not same reference)', () => {
    const rolls: [number, number] = [10, 5];
    const result = mapAllRolls(rolls);
    rolls[0] = 99;
    expect(result![0]).toBe(10);
  });

  it('preserves order: kept die is first (advantage picks max)', () => {
    // In combat-engine, roll (the kept result) is assigned to d20, while
    // d20Rolls preserves [roll1, roll2]. For advantage the higher of the two
    // is what's used, but the display order matches the engine's pair.
    const result = mapAllRolls([18, 3]);
    expect(result).toEqual([18, 3]);
  });
});
