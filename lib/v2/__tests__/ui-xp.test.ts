import { describe, it, expect } from 'vitest';
import { XP_THRESHOLDS } from '@/lib/xp';

// Pure logic tests for Phase 6 XP visibility UI.

// ─── xp_gained pill ───────────────────────────────────────────────────────────

function xpPillText(amount: number, source: string): string {
  return `+${amount} XP — ${source}`;
}

describe('xp_gained pill', () => {
  it('formats amount and source', () => {
    expect(xpPillText(100, 'Giant Rat')).toBe('+100 XP — Giant Rat');
  });

  it('formats with any amount', () => {
    expect(xpPillText(200, 'Guard Sergeant')).toBe('+200 XP — Guard Sergeant');
  });
});

// ─── level_up card ────────────────────────────────────────────────────────────

function levelUpText(newLevel: number, oldHp: number, newHp: number, features: string[]): string {
  return `⬆ Level ${newLevel} reached! HP ${oldHp} → ${newHp}${features.length ? ` · ${features.join(' · ')}` : ''}`;
}

describe('level_up card', () => {
  it('renders level, HP delta, and features', () => {
    const text = levelUpText(2, 10, 19, ['Second Wind', 'Action Surge']);
    expect(text).toContain('Level 2');
    expect(text).toContain('HP 10 → 19');
    expect(text).toContain('Second Wind');
    expect(text).toContain('Action Surge');
  });

  it('renders without features when none unlocked', () => {
    const text = levelUpText(6, 44, 51, []);
    expect(text).toContain('Level 6');
    expect(text).not.toContain('·');
  });
});

// ─── XP bar percentage ────────────────────────────────────────────────────────

function xpBarPct(xp: number, level: number): number | null {
  const levelEnd = XP_THRESHOLDS[level] ?? null;
  if (levelEnd === null) return null; // max level
  const levelStart = XP_THRESHOLDS[level - 1] ?? 0;
  return Math.min(100, Math.max(0, ((xp - levelStart) / (levelEnd - levelStart)) * 100));
}

describe('XP bar percentage', () => {
  it('L1 250/300 XP fills ~83%', () => {
    const pct = xpBarPct(250, 1);
    expect(pct).toBeCloseTo(83.33, 1);
  });

  it('L1 0 XP fills 0%', () => {
    expect(xpBarPct(0, 1)).toBe(0);
  });

  it('L1 at threshold (300 XP) fills 100%', () => {
    expect(xpBarPct(300, 1)).toBe(100);
  });

  it('XP exceeding threshold is clamped to 100%', () => {
    expect(xpBarPct(350, 1)).toBe(100);
  });

  it('L20 returns null (max level — no bar)', () => {
    expect(xpBarPct(355000, 20)).toBeNull();
  });

  it('L2 mid-range fills correctly', () => {
    // L2: 300–900. At 600 XP → 50% through the 600-wide range.
    const pct = xpBarPct(600, 2);
    expect(pct).toBeCloseTo(50, 1);
  });
});

// ─── xpToNextLevel gap ────────────────────────────────────────────────────────

function xpToNextLevel(xp: number, level: number): number | null {
  const levelEnd = XP_THRESHOLDS[level] ?? null;
  return levelEnd !== null ? levelEnd - xp : null;
}

describe('xpToNextLevel', () => {
  it('L1 250 XP → 50 gap', () => {
    expect(xpToNextLevel(250, 1)).toBe(50);
  });

  it('L20 → null', () => {
    expect(xpToNextLevel(355000, 20)).toBeNull();
  });

  it('gap is 0 at threshold', () => {
    expect(xpToNextLevel(300, 1)).toBe(0);
  });
});
