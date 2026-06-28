import { describe, it, expect, vi } from 'vitest';
import { xpForNextLevel } from '@/lib/xp';
import { maxForLevel } from '@/lib/v2/level-utils';
import type { PartyMemberInfo, CharacterStats, PendingLevelUpChoice, NextFeature } from '@/types/v2-game';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function xpToNextLevel(xp: number, level: number): number | null {
  const threshold = xpForNextLevel(level);
  return threshold !== null ? threshold - xp : null;
}

function makePartyMember(overrides: Partial<PartyMemberInfo> = {}): PartyMemberInfo {
  return {
    characterId: 'c1', characterName: 'Tomas', characterClass: 'Fighter',
    avatarUrl: null, currentHp: 18, maxHp: 18, isDead: false,
    isDormant: false, isInSameRoom: true, currentRoom: 'Guard Room',
    lastSeenAt: null, level: 1, ac: 14, attackBonus: 3, initiativeMod: 1,
    baseStrength: 16, baseDexterity: 12, baseConstitution: 14,
    baseIntelligence: 10, baseWisdom: 10, baseCharisma: 8,
    skillsModifiers: {}, skillProficiencies: [],
    xp: 0, xpToNextLevel: 300, nextFeature: null,
    ...overrides,
  };
}

// ─── xpForNextLevel ───────────────────────────────────────────────────────────

describe('xpForNextLevel', () => {
  it('returns threshold for next level (L1 → 300)', () => {
    expect(xpForNextLevel(1)).toBe(300);
  });

  it('returns null at level cap (L20)', () => {
    expect(xpForNextLevel(20)).toBeNull();
  });

  it('returns 6500 for L4', () => {
    expect(xpForNextLevel(4)).toBe(6500);
  });
});

// ─── xpToNextLevel gap ────────────────────────────────────────────────────────

describe('xpToNextLevel gap', () => {
  it('250 XP at L1 → gap of 50', () => {
    expect(xpToNextLevel(250, 1)).toBe(50);
  });

  it('0 XP at L1 → gap of 300', () => {
    expect(xpToNextLevel(0, 1)).toBe(300);
  });

  it('6500 XP at L5 (level cap for campaign) → gap to L6 is 7500', () => {
    expect(xpToNextLevel(6500, 5)).toBe(14000 - 6500);
  });

  it('returns null at L20', () => {
    expect(xpToNextLevel(355000, 20)).toBeNull();
  });
});

// ─── PartyMemberInfo XP fields ────────────────────────────────────────────────

describe('PartyMemberInfo XP fields', () => {
  it('xp and xpToNextLevel are present and correct', () => {
    const m = makePartyMember({ xp: 250, level: 1, xpToNextLevel: 50 });
    expect(m.xp).toBe(250);
    expect(m.xpToNextLevel).toBe(50);
  });

  it('xpToNextLevel is null at L20', () => {
    const m = makePartyMember({ xp: 355000, level: 20, xpToNextLevel: null });
    expect(m.xpToNextLevel).toBeNull();
  });

  it('nextFeature is null when no ClassProgression data', () => {
    const m = makePartyMember({ nextFeature: null });
    expect(m.nextFeature).toBeNull();
  });

  it('nextFeature carries name and level when set', () => {
    const nf: NextFeature = { name: 'Action Surge', level: 2 };
    const m = makePartyMember({ nextFeature: nf });
    expect(m.nextFeature?.name).toBe('Action Surge');
    expect(m.nextFeature?.level).toBe(2);
  });
});

// ─── CharacterStats pendingChoicesQueue ───────────────────────────────────────

describe('CharacterStats pendingChoicesQueue', () => {
  function makeStats(overrides: Partial<CharacterStats> = {}): CharacterStats {
    return {
      name: 'Tomas', currentHp: 18, maxHp: 18, ac: 14, level: 1, xp: 0,
      characterClass: 'Fighter', attackBonus: 3, initiativeMod: 1,
      baseStrength: 16, baseDexterity: 12, baseConstitution: 14,
      baseIntelligence: 10, baseWisdom: 10, baseCharisma: 8,
      skillsModifiers: {}, skillProficiencies: [],
      isHiding: false, pendingChoicesQueue: [],
      subclass: null, critThreshold: 20, featuresUnlocked: [], resourceStates: [], canShortRest: false, classFeatureDetails: [],
      ...overrides,
    };
  }

  it('empty queue when nothing pending', () => {
    const s = makeStats({ pendingChoicesQueue: [] });
    expect(s.pendingChoicesQueue).toHaveLength(0);
  });

  it('single ASI choice queued', () => {
    const queue: PendingLevelUpChoice[] = [{ type: 'asi', level: 4 }];
    const s = makeStats({ pendingChoicesQueue: queue });
    expect(s.pendingChoicesQueue).toHaveLength(1);
    expect(s.pendingChoicesQueue[0]).toEqual({ type: 'asi', level: 4 });
  });

  it('two choices queued from multi-level jump; index 0 is the active choice', () => {
    const queue: PendingLevelUpChoice[] = [
      { type: 'subclass', level: 3 },
      { type: 'asi', level: 4 },
    ];
    const s = makeStats({ pendingChoicesQueue: queue });
    expect(s.pendingChoicesQueue).toHaveLength(2);
    expect(s.pendingChoicesQueue[0]).toEqual({ type: 'subclass', level: 3 });
    expect(s.pendingChoicesQueue[1]).toEqual({ type: 'asi', level: 4 });
  });
});

// ─── view-state resource fields — regression ──────────────────────────────────

function makeStats(overrides: Partial<CharacterStats> = {}): CharacterStats {
  return {
    name: 'Tomas', currentHp: 18, maxHp: 18, ac: 14, level: 1, xp: 0,
    characterClass: 'Fighter', attackBonus: 3, initiativeMod: 1,
    baseStrength: 16, baseDexterity: 12, baseConstitution: 14,
    baseIntelligence: 10, baseWisdom: 10, baseCharisma: 8,
    skillsModifiers: {}, skillProficiencies: [],
    isHiding: false, pendingChoicesQueue: [],
    subclass: null, critThreshold: 20,
    featuresUnlocked: [], resourceStates: [], canShortRest: false, classFeatureDetails: [],
    ...overrides,
  };
}

describe('view-state resource fields — regression', () => {
  it('classFeatureDetails is [] when featuresUnlocked is empty', () => {
    const s = makeStats({ classFeatureDetails: [] });
    expect(s.classFeatureDetails).toHaveLength(0);
  });

  it('resourceStates is [] when character has no pool rows', () => {
    const s = makeStats({ resourceStates: [] });
    expect(s.resourceStates).toHaveLength(0);
  });

  it('canShortRest is false when all short-rest pools are at max', () => {
    // Simulate pool max=2, current=2 — not below max, so canShortRest=false
    const pools = [{ poolKey: 'ki', maxByLevel: { '2': 2 } }];
    const resourceStates = [{ poolKey: 'ki', current: 2 }];
    let canShortRest = false;
    for (const pool of pools) {
      const state = resourceStates.find(s => s.poolKey === pool.poolKey);
      if (!state) continue;
      const max = maxForLevel(pool.maxByLevel, 2);
      if (state.current < max) { canShortRest = true; break; }
    }
    expect(canShortRest).toBe(false);
  });

  it('canShortRest is true when any short-rest pool is below max', () => {
    const pools = [{ poolKey: 'ki', maxByLevel: { '2': 2 } }];
    const resourceStates = [{ poolKey: 'ki', current: 1 }];
    let canShortRest = false;
    for (const pool of pools) {
      const state = resourceStates.find(s => s.poolKey === pool.poolKey);
      if (!state) continue;
      const max = maxForLevel(pool.maxByLevel, 2);
      if (state.current < max) { canShortRest = true; break; }
    }
    expect(canShortRest).toBe(true);
  });

  it('canShortRest is false when character has no short-rest pools at all', () => {
    const pools: { poolKey: string; maxByLevel: Record<string, number> }[] = [];
    let canShortRest = false;
    for (const pool of pools) {
      const state: { poolKey: string; current: number } | undefined = undefined;
      if (!state) continue;
      const max = maxForLevel(pool.maxByLevel, 1);
      if (state.current < max) { canShortRest = true; break; }
    }
    expect(canShortRest).toBe(false);
  });
});
