import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));

import { DUNGEON_ACTS, PROVING_GROUNDS_ACTS } from '../act-definitions';
import { levelUpThisFight } from '../situation-summary';

// ─── DUNGEON_ACTS milestoneXp values ─────────────────────────────────────────

describe('DUNGEON_ACTS milestone XP', () => {
  it('act 1 completion awards 600 XP', () => {
    const act1 = DUNGEON_ACTS.find(a => a.act === 1);
    expect(act1?.milestoneXp).toBe(600);
  });

  it('act 2 completion awards 2400 XP', () => {
    const act2 = DUNGEON_ACTS.find(a => a.act === 2);
    expect(act2?.milestoneXp).toBe(2400);
  });

  it('act 3 completion awards 0 XP', () => {
    const act3 = DUNGEON_ACTS.find(a => a.act === 3);
    expect(act3?.milestoneXp).toBe(0);
  });
});

// ─── PROVING_GROUNDS_ACTS milestoneXp values ─────────────────────────────────

describe('PROVING_GROUNDS_ACTS milestone XP', () => {
  it('act 1 awards 0 XP', () => {
    const act1 = PROVING_GROUNDS_ACTS.find(a => a.act === 1);
    expect(act1?.milestoneXp).toBe(0);
  });

  it('act 2 awards 300 XP', () => {
    const act2 = PROVING_GROUNDS_ACTS.find(a => a.act === 2);
    expect(act2?.milestoneXp).toBe(300);
  });

  it('act 3 awards 0 XP', () => {
    const act3 = PROVING_GROUNDS_ACTS.find(a => a.act === 3);
    expect(act3?.milestoneXp).toBe(0);
  });
});

// ─── levelUpThisFight ─────────────────────────────────────────────────────────

describe('levelUpThisFight', () => {
  it('empty character list → []', () => {
    expect(levelUpThisFight([], 500)).toEqual([]);
  });

  it('character xp + pool < needed → not in list', () => {
    // L1 needs 300 XP; char has 0 + pool 100 = 100 < 300
    const result = levelUpThisFight([{ name: 'Tomas', xp: 0, level: 1 }], 100);
    expect(result).toEqual([]);
  });

  it('character xp + pool >= needed → included', () => {
    // L1 needs 300 XP; char has 250 + pool 50 = 300 >= 300
    const result = levelUpThisFight([{ name: 'Tomas', xp: 250, level: 1 }], 50);
    expect(result).toEqual(['Tomas']);
  });

  it('multiple characters — only near-level ones included', () => {
    const result = levelUpThisFight([
      { name: 'Tomas', xp: 250, level: 1 },  // 250 + 100 = 350 >= 300 ✓
      { name: 'Seris', xp: 0, level: 1 },     // 0 + 100 = 100 < 300 ✗
    ], 100);
    expect(result).toEqual(['Tomas']);
  });

  it('all characters near level-up → all included', () => {
    const result = levelUpThisFight([
      { name: 'Tomas', xp: 250, level: 1 },
      { name: 'Seris', xp: 200, level: 1 },
    ], 200);
    expect(result).toContain('Tomas');
    expect(result).toContain('Seris');
    expect(result).toHaveLength(2);
  });

  it('character at L20 cap → never in list', () => {
    const result = levelUpThisFight([{ name: 'Tomas', xp: 355000, level: 20 }], 9999999);
    expect(result).toEqual([]);
  });

  it('exact threshold boundary: xp + pool === threshold → included', () => {
    // L1: needs exactly 300; char has 0 + pool 300
    const result = levelUpThisFight([{ name: 'Tomas', xp: 0, level: 1 }], 300);
    expect(result).toEqual(['Tomas']);
  });
});
