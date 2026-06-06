import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: vi.fn() } } }));

import { resolveEnemyTurn, advanceTurn } from '../game-controller';
import type { CombatState, InitiativeEntry } from '@/types/v2-game';

// Deterministic dice
vi.mock('@/lib/dice', () => ({
  rollD20Check: vi.fn(),
  abilityModifier: (score: number) => Math.floor((score - 10) / 2),
  rollDice: vi.fn(() => ({ total: 3 })),
  rollInitiative: vi.fn(),
}));
vi.mock('@/lib/mechanical-damage', () => ({
  computeAttackDamage: vi.fn(() => 5),
}));

import { rollD20Check } from '@/lib/dice';
import { computeAttackDamage } from '@/lib/mechanical-damage';

const base = { modifier: 3, dc: 12, dcType: 'AC' as const };
const mockHit = { ...base, roll: 15, total: 18, success: true, critical: false, fumble: false };
const mockMiss = { ...base, roll: 4, total: 7, success: false, critical: false, fumble: false };
const mockCrit = { ...base, roll: 20, total: 23, success: true, critical: true, fumble: false };
const mockFumble = { ...base, roll: 1, total: 4, success: false, critical: false, fumble: true };

function makeEnemy(overrides: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return {
    id: 'enemy-1',
    type: 'enemy',
    name: 'Guard',
    initiative: 9,
    hp: 11,
    maxHp: 11,
    ac: 13,
    surprised: false,
    acted: false,
    proximity: 'close',
    status_effects: [],
    ...overrides,
  };
}

function makeCharEntry(overrides: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return {
    id: 'char-1',
    type: 'character',
    name: 'Tomas',
    initiative: 17,
    hp: 14,
    maxHp: 18,
    ac: 12,
    surprised: false,
    acted: false,
    proximity: 'close',
    status_effects: [],
    ...overrides,
  };
}

function makeCs(enemy: InitiativeEntry, char: InitiativeEntry): CombatState {
  return {
    round: 1,
    initiativeOrder: [char, enemy],
    activeActorId: enemy.id,
    currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
  };
}

const aggressiveProps = {
  combat_stats: { attack_bonus: 3, damage: '1d6+1', max_hp: 11, ac: 13, dex_score: 10 },
  ai_behavior: { priority: 'aggressive', flee_threshold: 0 },
};
const defensiveProps = {
  combat_stats: { attack_bonus: 2, damage: '1d6', max_hp: 11, ac: 12, dex_score: 10 },
  ai_behavior: { priority: 'defensive', flee_threshold: 0 },
};
const cowardlyProps = (threshold: number) => ({
  combat_stats: { attack_bonus: 1, damage: '1d4', max_hp: 10, ac: 10, dex_score: 10 },
  ai_behavior: { priority: 'cowardly', flee_threshold: threshold },
});

describe('resolveEnemyTurn', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('surprised enemy', () => {
    it('skips turn and clears surprised flag', () => {
      const entry = makeEnemy({ surprised: true });
      const cs = makeCs(entry, makeCharEntry());
      const result = resolveEnemyTurn(entry, cs, 'char-1', 'Tomas', aggressiveProps);
      expect(result.hpDamage).toBe(0);
      expect(result.updatedEntry.surprised).toBe(false);
      expect(result.facts[0]).toMatch(/surprised/);
      expect(rollD20Check).not.toHaveBeenCalled();
    });
  });

  describe('aggressive behavior', () => {
    it('attacks when player is close', () => {
      vi.mocked(rollD20Check).mockReturnValue(mockHit);
      const entry = makeEnemy({ proximity: 'close' });
      const cs = makeCs(entry, makeCharEntry());
      const result = resolveEnemyTurn(entry, cs, 'char-1', 'Tomas', aggressiveProps);
      expect(rollD20Check).toHaveBeenCalled();
      expect(result.hpDamage).toBe(5);
      expect(result.facts[0]).toMatch(/hit/i);
    });

    it('moves to close when player is far', () => {
      const entry = makeEnemy({ proximity: 'far' });
      const cs = makeCs(entry, makeCharEntry());
      const result = resolveEnemyTurn(entry, cs, 'char-1', 'Tomas', aggressiveProps);
      expect(rollD20Check).not.toHaveBeenCalled();
      expect(result.hpDamage).toBe(0);
      expect(result.updatedEntry.proximity).toBe('close');
      expect(result.facts[0]).toMatch(/close range/);
    });
  });

  describe('defensive behavior', () => {
    it('does not advance if player is far', () => {
      const entry = makeEnemy({ proximity: 'far' });
      const cs = makeCs(entry, makeCharEntry());
      const result = resolveEnemyTurn(entry, cs, 'char-1', 'Tomas', defensiveProps);
      expect(rollD20Check).not.toHaveBeenCalled();
      expect(result.hpDamage).toBe(0);
      expect(result.facts[0]).toMatch(/holds/);
    });

    it('attacks when player is close', () => {
      vi.mocked(rollD20Check).mockReturnValue(mockHit);
      const entry = makeEnemy({ proximity: 'close' });
      const cs = makeCs(entry, makeCharEntry());
      const result = resolveEnemyTurn(entry, cs, 'char-1', 'Tomas', defensiveProps);
      expect(result.hpDamage).toBe(5);
    });
  });

  describe('cowardly behavior', () => {
    it('attacks when HP above flee_threshold', () => {
      vi.mocked(rollD20Check).mockReturnValue(mockHit);
      const entry = makeEnemy({ hp: 8, maxHp: 10, proximity: 'close' });
      const cs = makeCs(entry, makeCharEntry());
      const result = resolveEnemyTurn(entry, cs, 'char-1', 'Tomas', cowardlyProps(0.3));
      expect(result.hpDamage).toBe(5);
    });

    it('flees when HP at or below flee_threshold', () => {
      const entry = makeEnemy({ hp: 3, maxHp: 10, proximity: 'close' });
      const cs = makeCs(entry, makeCharEntry());
      const result = resolveEnemyTurn(entry, cs, 'char-1', 'Tomas', cowardlyProps(0.3));
      expect(rollD20Check).not.toHaveBeenCalled();
      expect(result.hpDamage).toBe(0);
      expect(result.facts[0]).toMatch(/flee/);
    });
  });

  describe('attack outcomes', () => {
    it('miss: no hp damage', () => {
      vi.mocked(rollD20Check).mockReturnValue(mockMiss);
      const entry = makeEnemy();
      const result = resolveEnemyTurn(entry, makeCs(entry, makeCharEntry()), 'char-1', 'Tomas', aggressiveProps);
      expect(result.hpDamage).toBe(0);
      expect(result.facts[0]).toMatch(/miss/);
    });

    it('fumble: no damage', () => {
      vi.mocked(rollD20Check).mockReturnValue(mockFumble);
      const entry = makeEnemy();
      const result = resolveEnemyTurn(entry, makeCs(entry, makeCharEntry()), 'char-1', 'Tomas', aggressiveProps);
      expect(result.hpDamage).toBe(0);
      expect(result.facts[0]).toMatch(/fumble/);
    });

    it('critical hit: computeAttackDamage called with isCrit=true', () => {
      vi.mocked(rollD20Check).mockReturnValue(mockCrit);
      const entry = makeEnemy();
      resolveEnemyTurn(entry, makeCs(entry, makeCharEntry()), 'char-1', 'Tomas', aggressiveProps);
      expect(computeAttackDamage).toHaveBeenCalledWith(expect.any(String), 0, true);
    });

    it('hit with player dodging: uses disadvantage (lower roll)', () => {
      const roll1 = { ...base, roll: 15, total: 18, success: true, critical: false, fumble: false };
      const roll2 = { ...base, roll: 6, total: 9, success: false, critical: false, fumble: false };
      vi.mocked(rollD20Check).mockReturnValueOnce(roll1).mockReturnValueOnce(roll2);
      const entry = makeEnemy();
      const charEntry = makeCharEntry({ status_effects: ['dodging'] });
      const cs = makeCs(entry, charEntry);
      const result = resolveEnemyTurn(entry, cs, 'char-1', 'Tomas', aggressiveProps);
      // Lower roll used → miss (roll2 is lower)
      expect(result.hpDamage).toBe(0);
    });

    it('advantage_next_attack: higher roll used and flag cleared', () => {
      const roll1 = { ...base, roll: 4, total: 7, success: false, critical: false, fumble: false };
      const roll2 = { ...base, roll: 15, total: 18, success: true, critical: false, fumble: false };
      vi.mocked(rollD20Check).mockReturnValueOnce(roll1).mockReturnValueOnce(roll2);
      vi.mocked(computeAttackDamage).mockReturnValue(5);
      const entry = makeEnemy({ status_effects: ['advantage_next_attack'] });
      const result = resolveEnemyTurn(entry, makeCs(entry, makeCharEntry()), 'char-1', 'Tomas', aggressiveProps);
      expect(result.hpDamage).toBe(5);
      expect(result.updatedEntry.status_effects).not.toContain('advantage_next_attack');
    });
  });

  describe('priority_target', () => {
    it('defensive enemy with priority_target moves to close (aggressive override)', () => {
      const entry = makeEnemy({ proximity: 'far', priority_target: 'char-1', priority_target_until_round: 3 });
      const cs = makeCs(entry, makeCharEntry());
      const result = resolveEnemyTurn(entry, cs, 'char-1', 'Tomas', defensiveProps);
      // Defensive would normally hold when far, but priority_target overrides to move
      expect(result.updatedEntry.proximity).toBe('close');
      expect(result.hpDamage).toBe(0);
    });

    it('priority_target enemy attacks when already close', () => {
      vi.mocked(rollD20Check).mockReturnValue(mockHit);
      const entry = makeEnemy({ proximity: 'close', priority_target: 'char-1', priority_target_until_round: 3 });
      const cs = makeCs(entry, makeCharEntry());
      const result = resolveEnemyTurn(entry, cs, 'char-1', 'Tomas', defensiveProps);
      expect(result.hpDamage).toBe(5);
    });

    it('priority_target expired: defensive behavior resumes', () => {
      const entry = makeEnemy({ proximity: 'far', priority_target: 'char-1', priority_target_until_round: 1 });
      const cs = { ...makeCs(entry, makeCharEntry()), round: 2 };
      const result = resolveEnemyTurn(entry, cs, 'char-1', 'Tomas', defensiveProps);
      // Round 2 > priority_target_until_round 1 → expired → hold
      expect(result.hpDamage).toBe(0);
      expect(result.facts[0]).toMatch(/holds/);
    });
  });
});

describe('auto-resolve loop integration (advanceTurn + resolveEnemyTurn)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('all enemies between player turns resolved before returning to player', () => {
    vi.mocked(rollD20Check).mockReturnValue(mockMiss);
    const char = makeCharEntry({ acted: true });
    const enemy1 = makeEnemy({ id: 'e1', initiative: 9, acted: false });
    const enemy2 = makeEnemy({ id: 'e2', initiative: 5, acted: false });
    let cs: CombatState = {
      round: 1,
      initiativeOrder: [char, enemy1, enemy2],
      activeActorId: 'e1',
      currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
    };

    // Simulate the loop
    const resolvedNames: string[] = [];
    while (true) {
      const active = cs.initiativeOrder.find(e => e.id === cs.activeActorId);
      if (!active || active.type === 'character') break;
      const result = resolveEnemyTurn(active, cs, 'char-1', 'Tomas', aggressiveProps);
      resolvedNames.push(active.id);
      cs = {
        ...cs,
        initiativeOrder: cs.initiativeOrder.map(e => e.id === active.id ? result.updatedEntry : e),
      };
      cs = advanceTurn(cs);
    }

    expect(resolvedNames).toEqual(['e1', 'e2']);
    // After loop, activeActorId should be back to character (new round)
    expect(cs.initiativeOrder.find(e => e.id === cs.activeActorId)?.type).toBe('character');
  });

  it('player reaching 0 HP mid-loop: loop stops', () => {
    vi.mocked(rollD20Check).mockReturnValue(mockHit);
    vi.mocked(computeAttackDamage).mockReturnValue(20); // one-shot player
    const char = makeCharEntry({ acted: true, hp: 10 });
    const enemy1 = makeEnemy({ id: 'e1' });
    const enemy2 = makeEnemy({ id: 'e2', initiative: 5 });
    const cs: CombatState = {
      round: 1,
      initiativeOrder: [char, enemy1, enemy2],
      activeActorId: 'e1',
      currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
    };

    let workingCs = cs;
    let totalDamage = 0;
    const playerHp = 10;
    const resolvedIds: string[] = [];

    while (true) {
      const active = workingCs.initiativeOrder.find(e => e.id === workingCs.activeActorId);
      if (!active || active.type === 'character') break;
      const result = resolveEnemyTurn(active, workingCs, 'char-1', 'Tomas', aggressiveProps);
      resolvedIds.push(active.id);
      totalDamage += result.hpDamage;
      workingCs = {
        ...workingCs,
        initiativeOrder: workingCs.initiativeOrder.map(e => e.id === active.id ? result.updatedEntry : e),
      };
      if (totalDamage >= playerHp) break;
      workingCs = advanceTurn(workingCs);
    }

    // Only e1 resolved — player dead after first hit
    expect(resolvedIds).toEqual(['e1']);
  });
});
