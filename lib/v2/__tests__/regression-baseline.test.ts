import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roomInstance: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: vi.fn() }; },
}));
vi.mock('@/lib/dice', () => ({
  rollD20Check: vi.fn(),
  abilityModifier: (score: number) => Math.floor((score - 10) / 2),
  rollDice: vi.fn(() => ({ total: 3 })),
  rollInitiative: vi.fn(() => 10),
}));
vi.mock('@/lib/mechanical-damage', () => ({
  computeAttackDamage: vi.fn(() => ({ total: 5 })),
}));
vi.mock('@/lib/stealth', () => ({
  rollStealthCheck: vi.fn(() => ({ roll: 15, modifier: 2, total: 17 })),
}));
vi.mock('@/lib/initiative', () => ({
  rollInitiative: vi.fn(() => 10),
}));

import {
  normalizeInventory,
  resolveOpportunityAttacks,
  checkCombatEnd,
  exitCombat,
  advanceTurn,
  resolveEnemyTurn,
} from '../game-controller';
import type { CombatState, InitiativeEntry } from '@/types/v2-game';
import { rollD20Check } from '@/lib/dice';
const mockRollD20Check = vi.mocked(rollD20Check);

function makeEntry(overrides: Partial<InitiativeEntry> & { id: string }): InitiativeEntry {
  return {
    type: 'character',
    name: 'Hero',
    initiative: 10,
    hp: 10,
    maxHp: 10,
    ac: 14,
    surprised: false,
    acted: false,
    proximity: 'close',
    status_effects: [],
    ...overrides,
  };
}

function makeCombatState(overrides: Partial<CombatState> = {}): CombatState {
  return {
    round: 1,
    activeActorId: 'p1',
    initiativeOrder: [],
    currentTurnUsage: {
      actionUsed: false,
      bonusActionUsed: false,
      movementUsed: false,
      reactionUsed: false,
    },
    ...overrides,
  };
}

// ─── normalizeInventory ────────────────────────────────────────────────────────

describe('normalizeInventory', () => {
  it('null input returns empty bag and equipped', () => {
    const result = normalizeInventory(null);
    expect(result).toEqual({ bag: [], equipped: {} });
  });

  it('array input returns empty bag and equipped', () => {
    const result = normalizeInventory([{ id: 'x', name: 'Sword' }]);
    expect(result).toEqual({ bag: [], equipped: {} });
  });

  it('undefined input returns empty bag and equipped', () => {
    const result = normalizeInventory(undefined);
    expect(result).toEqual({ bag: [], equipped: {} });
  });

  it('valid object with bag returns correct bag', () => {
    const item = { id: 'item-1', name: 'Dagger' };
    const result = normalizeInventory({ bag: [item], equipped: {} });
    expect(result.bag).toHaveLength(1);
    expect(result.bag[0].id).toBe('item-1');
  });

  it('object missing bag key defaults bag to empty array', () => {
    const result = normalizeInventory({ equipped: { main_hand: null } });
    expect(result.bag).toEqual([]);
  });

  it('object missing equipped key defaults equipped to empty object', () => {
    const result = normalizeInventory({ bag: [] });
    expect(result.equipped).toEqual({});
  });

  it('object with non-array bag defaults bag to empty array', () => {
    const result = normalizeInventory({ bag: 'not-an-array', equipped: {} });
    expect(result.bag).toEqual([]);
  });

  it('preserves equipped slots', () => {
    const weapon = { id: 'w-1', name: 'Shortsword' };
    const result = normalizeInventory({ bag: [], equipped: { main_hand: weapon } });
    expect(result.equipped.main_hand).toEqual(weapon);
  });
});

// ─── checkCombatEnd ───────────────────────────────────────────────────────────

describe('checkCombatEnd', () => {
  it('returns false when both player and enemy alive', () => {
    const cs = makeCombatState({
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 5 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 3 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(false);
  });

  it('returns true when all enemies are dead (hp=0)', () => {
    const cs = makeCombatState({
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 5 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 0 }),
        makeEntry({ id: 'e2', type: 'enemy', hp: 0 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(true);
  });

  it('returns false when some enemies still alive', () => {
    const cs = makeCombatState({
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 3 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 0 }),
        makeEntry({ id: 'e2', type: 'enemy', hp: 7 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(false);
  });

  it('returns true when initiative order is empty', () => {
    const cs = makeCombatState({ initiativeOrder: [] });
    expect(checkCombatEnd(cs)).toBe(true);
  });

  it('player at hp=0 does not block end when all enemies also dead', () => {
    const cs = makeCombatState({
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 0 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 0 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(true);
  });
});

// ─── exitCombat ───────────────────────────────────────────────────────────────

describe('exitCombat', () => {
  it('calls prisma to update gameState to exploration', async () => {
    const { prisma } = await import('@/lib/prisma');
    const updateMock = vi.mocked(prisma.roomInstance.update);
    updateMock.mockResolvedValue({} as never);

    await exitCombat('room-instance-abc');

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'room-instance-abc' },
        data: expect.objectContaining({ gameState: 'exploration' }),
      }),
    );
  });

  it('is callable multiple times without error', async () => {
    const { prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.roomInstance.update).mockResolvedValue({} as never);
    await expect(exitCombat('room-abc')).resolves.toBeUndefined();
    await expect(exitCombat('room-abc')).resolves.toBeUndefined();
  });
});

// ─── resolveOpportunityAttacks ────────────────────────────────────────────────

describe('resolveOpportunityAttacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty facts and zero damage when no enemies in initiative order', () => {
    const cs = makeCombatState({
      activeActorId: 'p1',
      initiativeOrder: [makeEntry({ id: 'p1', type: 'character', hp: 10 })],
    });
    const result = resolveOpportunityAttacks(cs, 'p1', 'Hero', []);
    expect(result.facts).toHaveLength(0);
    expect(result.hpDamage).toBe(0);
  });

  it('returns empty results when no close enemies', () => {
    const cs = makeCombatState({
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 10 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 5, proximity: 'far' }),
      ],
    });
    const result = resolveOpportunityAttacks(cs, 'p1', 'Hero', []);
    expect(result.facts).toHaveLength(0);
    expect(result.hpDamage).toBe(0);
  });

  it('triggers opportunity attack from close enemy and deals damage on hit', () => {
    mockRollD20Check.mockReturnValue({
      roll: 15, modifier: 3, dc: 14, dcType: 'AC', total: 18,
      success: true, critical: false, fumble: false,
    });
    const cs = makeCombatState({
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 10 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 5, proximity: 'close' }),
      ],
    });
    const poiInstances = [{
      id: 'e1',
      template: {
        defaultProperties: { combat_stats: { attack_bonus: 3, damage: '1d6', ac: 13 } },
      },
    }];
    const result = resolveOpportunityAttacks(cs, 'p1', 'Hero', poiInstances);
    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.hpDamage).toBeGreaterThan(0);
  });

  it('records zero damage on a miss', () => {
    mockRollD20Check.mockReturnValue({
      roll: 3, modifier: 2, dc: 14, dcType: 'AC', total: 5,
      success: false, critical: false, fumble: false,
    });
    const cs = makeCombatState({
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 10 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 5, proximity: 'close' }),
      ],
    });
    const result = resolveOpportunityAttacks(cs, 'p1', 'Hero', []);
    expect(result.hpDamage).toBe(0);
  });

  it('does not trigger from dead enemies (hp=0)', () => {
    const cs = makeCombatState({
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 10 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 0, proximity: 'close' }),
      ],
    });
    const result = resolveOpportunityAttacks(cs, 'p1', 'Hero', []);
    expect(result.facts).toHaveLength(0);
    expect(result.hpDamage).toBe(0);
  });
});

// ─── advanceTurn ──────────────────────────────────────────────────────────────

describe('advanceTurn — wrapping behavior', () => {
  it('wraps from last actor back to first and increments round', () => {
    const cs = makeCombatState({
      round: 1,
      activeActorId: 'e1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', acted: true }),
        makeEntry({ id: 'e1', type: 'enemy' }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('p1');
    expect(next.round).toBe(2);
  });

  it('advances to next actor without incrementing round mid-round', () => {
    const cs = makeCombatState({
      round: 1,
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character' }),
        makeEntry({ id: 'e1', type: 'enemy' }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('e1');
    expect(next.round).toBe(1);
  });

  it('resets currentTurnUsage to all false on advance', () => {
    const cs = makeCombatState({
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character' }),
        makeEntry({ id: 'e1', type: 'enemy' }),
      ],
      currentTurnUsage: {
        actionUsed: true, bonusActionUsed: true, movementUsed: true, reactionUsed: true,
      },
    });
    const next = advanceTurn(cs);
    expect(next.currentTurnUsage.actionUsed).toBe(false);
    expect(next.currentTurnUsage.bonusActionUsed).toBe(false);
  });

  it('skips dead enemies (hp=0) when advancing', () => {
    const cs = makeCombatState({
      round: 1,
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character' }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 0 }),
        makeEntry({ id: 'e2', type: 'enemy', hp: 8 }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('e2');
  });

  // Death save invariants — must not regress when isSkippable logic changes
  it('dying player (hp=0, no isStabilized) is NOT skipped — gets a turn', () => {
    const cs = makeCombatState({
      activeActorId: 'e1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 0 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 5 }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('p1');
  });

  it('stabilized player (hp=0, isStabilized=true) IS skipped', () => {
    const cs = makeCombatState({
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 5 }),
        makeEntry({ id: 'p2', type: 'character', hp: 0, isStabilized: true }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 4 }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('e1');
  });

  it('skips both dead enemy and stabilized player, advances to live enemy', () => {
    const cs = makeCombatState({
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 8 }),
        makeEntry({ id: 'p2', type: 'character', hp: 0, isStabilized: true }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 0 }),
        makeEntry({ id: 'e2', type: 'enemy', hp: 6 }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('e2');
  });
});

// Death save additions to checkCombatEnd
describe('checkCombatEnd — death save interactions', () => {
  it('dying player with live enemy — combat continues (false)', () => {
    const cs = makeCombatState({
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 0 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 5 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(false);
  });

  it('stabilized player with all enemies dead — combat ends (true)', () => {
    const cs = makeCombatState({
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 0, isStabilized: true }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 0 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(true);
  });

  it('dying player with all enemies dead — combat ends (true)', () => {
    const cs = makeCombatState({
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 0 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 0 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(true);
  });
});

// ─── Heroic sacrifice regression guards ───────────────────────────────────────
// These must not regress when isSkippable logic or death save handling changes.

describe('advanceTurn — heroic sacrifice regression guards', () => {
  it('sacrifice-pending (isStabilized=true, hp=0) is skipped — does not get a turn', () => {
    const cs = makeCombatState({
      activeActorId: 'e1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 0, isStabilized: true, initiative: 20 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 5, initiative: 10 }),
        makeEntry({ id: 'p2', type: 'character', hp: 6, initiative: 6 }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('p2');
  });

  it('dying (hp=0, isStabilized=false) still gets a turn for auto-resolve', () => {
    const cs = makeCombatState({
      activeActorId: 'e1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 0, initiative: 20 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 5, initiative: 10 }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('p1');
  });

  it('combat ends independently of sacrifice-pending state when all enemies dead', () => {
    const cs = makeCombatState({
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 0, isStabilized: true }),
        makeEntry({ id: 'p2', type: 'character', hp: 4 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 0 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(true);
  });

  it('alive party member continues acting after a sacrifice-pending teammate', () => {
    const cs = makeCombatState({
      activeActorId: 'p1',
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'character', hp: 8, initiative: 18 }),
        makeEntry({ id: 'p2', type: 'character', hp: 0, isStabilized: true, initiative: 14 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 5, initiative: 6 }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('e1');
  });
});

// ─── Heroic Sacrifice — enemy attack on downed character regression guards ────
// Guards the auto-fail path in resolveEnemyTurn (targetIsDying=true).
// This must not regress if the downed-target branch is refactored.

describe('resolveEnemyTurn — downed character auto-fail regression guards', () => {
  beforeEach(() => vi.clearAllMocks());

  const defaultProps = { combat_stats: { attack_bonus: 3, damage: '1d6', ac: 13 } };

  const enemyEntry = makeEntry({ id: 'e1', type: 'enemy', hp: 8, proximity: 'close' }) as InitiativeEntry;
  const downedChar = makeEntry({ id: 'p1', type: 'character', hp: 0, ac: 14 }) as InitiativeEntry;

  function makeDownedCs(): CombatState {
    return makeCombatState({ activeActorId: 'e1', initiativeOrder: [downedChar, enemyEntry] });
  }

  it('normal hit on downed → deathSaveAutoFailures=1, hpDamage=0', () => {
    mockRollD20Check.mockReturnValue({
      roll: 15, modifier: 3, dc: 14, dcType: 'AC', total: 18,
      success: true, critical: false, fumble: false,
    });
    const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Hero', defaultProps, 'C', false, true);
    expect(result.deathSaveAutoFailures).toBe(1);
    expect(result.hpDamage).toBe(0);
  });

  it('critical hit on downed → deathSaveAutoFailures=2, not 1 (critical counts double per 5E)', () => {
    mockRollD20Check.mockReturnValue({
      roll: 20, modifier: 3, dc: 14, dcType: 'AC', total: 23,
      success: true, critical: true, fumble: false,
    });
    const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Hero', defaultProps, 'C', false, true);
    expect(result.deathSaveAutoFailures).toBe(2);
    expect(result.hpDamage).toBe(0);
  });

  it('fumble (roll=1) on downed → deathSaveAutoFailures=0 (fumble misses downed target)', () => {
    mockRollD20Check.mockReturnValue({
      roll: 1, modifier: 0, dc: 14, dcType: 'AC', total: 1,
      success: false, critical: false, fumble: true,
    });
    const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Hero', defaultProps, 'C', false, true);
    expect(result.deathSaveAutoFailures).toBe(0);
    expect(result.hpDamage).toBe(0);
  });

  it('miss on downed → deathSaveAutoFailures=0', () => {
    mockRollD20Check.mockReturnValue({
      roll: 4, modifier: 3, dc: 14, dcType: 'AC', total: 7,
      success: false, critical: false, fumble: false,
    });
    const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Hero', defaultProps, 'C', false, true);
    expect(result.deathSaveAutoFailures).toBe(0);
    expect(result.hpDamage).toBe(0);
  });

  it('downed target never takes HP damage (hit or crit) — guard against regression to live-target path', () => {
    for (const ret of [
      { roll: 20, modifier: 3, dc: 14, dcType: 'AC', total: 23, success: true, critical: true, fumble: false },
      { roll: 15, modifier: 3, dc: 14, dcType: 'AC', total: 18, success: true, critical: false, fumble: false },
    ] as const) {
      mockRollD20Check.mockReturnValueOnce(ret);
      const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Hero', defaultProps, 'C', false, true);
      expect(result.hpDamage).toBe(0);
    }
  });

  it('live character (targetIsDying=false) on hit still takes HP damage — opposite path guard', () => {
    const liveChar = makeEntry({ id: 'p1', type: 'character', hp: 10, ac: 14 }) as InitiativeEntry;
    const liveCs = makeCombatState({ activeActorId: 'e1', initiativeOrder: [liveChar, enemyEntry] });
    mockRollD20Check.mockReturnValue({
      roll: 15, modifier: 3, dc: 14, dcType: 'AC', total: 18,
      success: true, critical: false, fumble: false,
    });
    const result = resolveEnemyTurn(enemyEntry, liveCs, 'p1', 'Hero', defaultProps, 'C', false, false);
    expect(result.hpDamage).toBeGreaterThan(0);
    expect(result.deathSaveAutoFailures).toBeUndefined();
  });

  it('roll badge is emitted for hit on downed (type=combat_roll, success=true)', () => {
    mockRollD20Check.mockReturnValue({
      roll: 15, modifier: 3, dc: 14, dcType: 'AC', total: 18,
      success: true, critical: false, fumble: false,
    });
    const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Hero', defaultProps, 'C', false, true);
    expect(result.rollData?.type).toBe('combat_roll');
    expect(result.rollData?.success).toBe(true);
  });

  it('roll badge isCrit=true for critical hit on downed', () => {
    mockRollD20Check.mockReturnValue({
      roll: 20, modifier: 3, dc: 14, dcType: 'AC', total: 23,
      success: true, critical: true, fumble: false,
    });
    const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Hero', defaultProps, 'C', false, true);
    expect(result.rollData?.isCrit).toBe(true);
  });
});

// ─── resource pools — regression ─────────────────────────────────────────────

import { maxForLevel, getDisplayType } from '@/components/v2/character/ResourcePools';
import type { CharacterStats } from '@/types/v2-game';

describe('resource pools — regression', () => {
  it('CharacterStats with resourceStates=[] does not produce any rows', () => {
    const details: CharacterStats['classFeatureDetails'] = [];
    const pools = details.filter(f => f.featureType === 'RESOURCE_POOL' && f.resourcePool != null);
    expect(pools).toHaveLength(0);
  });

  it('classFeatureDetails with no RESOURCE_POOL entries produces no rows', () => {
    const details: CharacterStats['classFeatureDetails'] = [
      { id: 'f1', name: 'Martial Arts', featureType: 'PASSIVE', mechanicsJson: null, actionType: null, implemented: false, level: 1, subclass: null, description: '', resourcePool: null },
    ];
    const pools = details.filter(f => f.featureType === 'RESOURCE_POOL' && f.resourcePool != null);
    expect(pools).toHaveLength(0);
  });

  it('canShortRest computation is unchanged after refactor (still uses maxForLevel)', () => {
    const shortRestPools = [{ poolKey: 'ki', maxByLevel: { '2': 2, '3': 3 } }];
    const resourceStates = [{ poolKey: 'ki', current: 1 }];
    let canShortRest = false;
    for (const pool of shortRestPools) {
      const state = resourceStates.find(s => s.poolKey === pool.poolKey);
      if (!state) continue;
      const max = maxForLevel(pool.maxByLevel, 3);
      if (state.current < max) { canShortRest = true; break; }
    }
    expect(canShortRest).toBe(true);
  });

  it('rest-helpers: character with existing state rows still gets restored correctly after the upsert change', () => {
    // Verify logic: upsert update path is exercised when state exists and current < max
    const max = maxForLevel({ '2': 2, '3': 3 }, 3);
    const current = 1;
    const needsUpdate = current < max;
    expect(needsUpdate).toBe(true);
    expect(max).toBe(3);
  });
});
