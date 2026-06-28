import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: vi.fn() }; } }));
vi.mock('@/lib/dice', () => ({
  rollD20Check: vi.fn(),
  abilityModifier: (score: number) => Math.floor((score - 10) / 2),
  rollDice: vi.fn(() => ({ total: 4 })),
  rollInitiative: vi.fn(() => 10),
}));
vi.mock('@/lib/mechanical-damage', () => ({
  computeAttackDamage: vi.fn(() => ({ total: 5, expr: '[3]+2' })),
}));
vi.mock('@/lib/stealth', () => ({
  rollStealthCheck: vi.fn(() => ({ roll: 15, modifier: 2, total: 17 })),
}));
vi.mock('@/lib/initiative', () => ({
  rollInitiative: vi.fn(() => 10),
}));
vi.mock('crypto', () => ({ randomInt: vi.fn() }));

import {
  resolveDeathSave,
  resolveEnemyTurn,
  advanceTurn,
  resolveCombatAction,
} from '../game-controller';
import type { CombatState, InitiativeEntry } from '@/types/v2-game';
import { rollD20Check } from '@/lib/dice';
import { randomInt } from 'crypto';

const mockRollD20Check = vi.mocked(rollD20Check);
const mockRandomInt = vi.mocked(randomInt) as unknown as { mockReturnValue: (n: number) => void };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeChar(overrides: Partial<InitiativeEntry> & { id: string }): InitiativeEntry {
  return {
    type: 'character',
    name: 'Anya',
    initiative: 15,
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

function makeEnemy(overrides: Partial<InitiativeEntry> & { id: string }): InitiativeEntry {
  return {
    type: 'enemy',
    name: 'Goblin',
    initiative: 8,
    hp: 8,
    maxHp: 8,
    ac: 12,
    surprised: false,
    acted: false,
    proximity: 'close',
    status_effects: [],
    ...overrides,
  };
}

function makeCs(overrides: Partial<CombatState> = {}): CombatState {
  return {
    round: 1,
    activeActorId: 'p1',
    initiativeOrder: [],
    currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
    ...overrides,
  };
}

const deathSaveAction = {
  action_type: 'death_save' as const,
  target_poi_instance_id: null,
  resulting_stance: null,
  interaction_result: null,
  target_room_template_id: null,
  item_id: null,
  target_character_id: null,
};

const baseChar = {
  id: 'p1', name: 'Anya', characterClass: 'Fighter', level: 2,
  baseDexterity: 10, baseStrength: 10, baseCharisma: 10, baseWisdom: 10,
  isHiding: false, critThreshold: 20, attacksPerAction: 1,
};

// ─── resolveDeathSave ─────────────────────────────────────────────────────────

describe('resolveDeathSave', () => {
  it('natural 20 — revives with 1 HP and clears all save counts', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 1, deathSaveFailures: 1 });
    const result = resolveDeathSave(entry, 'Anya', () => 20);
    expect(result.outcome).toBe('revived');
    expect(result.updatedEntry.hp).toBe(1);
    expect(result.updatedEntry.deathSaveSuccesses).toBe(0);
    expect(result.updatedEntry.deathSaveFailures).toBe(0);
    expect(result.updatedEntry.isStabilized).toBe(false);
    expect(result.characterDied).toBe(false);
    expect(result.roll).toBe(20);
  });

  it('natural 20 with no prior saves still revives', () => {
    const entry = makeChar({ id: 'p1', hp: 0 });
    const result = resolveDeathSave(entry, 'Anya', () => 20);
    expect(result.outcome).toBe('revived');
    expect(result.updatedEntry.hp).toBe(1);
    expect(result.characterDied).toBe(false);
  });

  it('roll 10-19 — records one success', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 0, deathSaveFailures: 0 });
    const result = resolveDeathSave(entry, 'Anya', () => 14);
    expect(result.outcome).toBe('success');
    expect(result.successes).toBe(1);
    expect(result.failures).toBe(0);
    expect(result.updatedEntry.deathSaveSuccesses).toBe(1);
    expect(result.characterDied).toBe(false);
  });

  it('third success — stabilizes (outcome=stabilized, isStabilized=true)', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 2, deathSaveFailures: 1 });
    const result = resolveDeathSave(entry, 'Anya', () => 12);
    expect(result.outcome).toBe('stabilized');
    expect(result.successes).toBe(3);
    expect(result.updatedEntry.isStabilized).toBe(true);
    expect(result.characterDied).toBe(false);
  });

  it('roll 2-9 — records one failure', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 0, deathSaveFailures: 0 });
    const result = resolveDeathSave(entry, 'Anya', () => 7);
    expect(result.outcome).toBe('failure');
    expect(result.failures).toBe(1);
    expect(result.successes).toBe(0);
    expect(result.updatedEntry.deathSaveFailures).toBe(1);
    expect(result.characterDied).toBe(false);
  });

  it('third failure (roll 5 with 2 existing) — character dies', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 1, deathSaveFailures: 2 });
    const result = resolveDeathSave(entry, 'Anya', () => 5);
    expect(result.outcome).toBe('dead');
    expect(result.failures).toBe(3);
    expect(result.characterDied).toBe(true);
  });

  it('natural 1 — counts as two failures', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 0, deathSaveFailures: 0 });
    const result = resolveDeathSave(entry, 'Anya', () => 1);
    expect(result.outcome).toBe('failure');
    expect(result.failures).toBe(2);
    expect(result.characterDied).toBe(false);
    expect(result.updatedEntry.deathSaveFailures).toBe(2);
  });

  it('natural 1 with one existing failure — causes death (total=3)', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 0, deathSaveFailures: 1 });
    const result = resolveDeathSave(entry, 'Anya', () => 1);
    expect(result.outcome).toBe('dead');
    expect(result.failures).toBe(3);
    expect(result.characterDied).toBe(true);
  });

  it('natural 1 with two existing failures — facts show 3/3 (capped display)', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 0, deathSaveFailures: 2 });
    const result = resolveDeathSave(entry, 'Anya', () => 1);
    expect(result.outcome).toBe('dead');
    expect(result.characterDied).toBe(true);
    expect(result.facts[0]).toContain('3/3');
  });

  it('preserves existing successes when adding a failure', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 2, deathSaveFailures: 0 });
    const result = resolveDeathSave(entry, 'Anya', () => 6);
    expect(result.successes).toBe(2);
    expect(result.failures).toBe(1);
  });

  it('preserves existing failures when adding a success', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 0, deathSaveFailures: 2 });
    const result = resolveDeathSave(entry, 'Anya', () => 15);
    expect(result.failures).toBe(2);
    expect(result.successes).toBe(1);
  });

  it('facts include character name and roll result', () => {
    const entry = makeChar({ id: 'p1', hp: 0 });
    const result = resolveDeathSave(entry, 'Anya', () => 11);
    expect(result.facts[0]).toContain('Anya');
    expect(result.facts[0]).toContain('11');
  });

  it('uses rollFn when provided instead of randomInt', () => {
    const entry = makeChar({ id: 'p1', hp: 0 });
    let called = false;
    resolveDeathSave(entry, 'Anya', () => { called = true; return 10; });
    expect(called).toBe(true);
  });
});

// ─── advanceTurn — death save interactions ────────────────────────────────────

describe('advanceTurn — dying and stabilized characters', () => {
  it('dying character (hp=0, not stabilized) is NOT skipped — gets their turn', () => {
    // Enemy just acted; next should be the dying player in the new round
    const cs = makeCs({
      activeActorId: 'e1',
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 0 }),
        makeEnemy({ id: 'e1' }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('p1');
  });

  it('stabilized character (hp=0, isStabilized=true) IS skipped — turn goes to enemy', () => {
    const cs = makeCs({
      activeActorId: 'p1',
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 5 }),
        makeChar({ id: 'p2', hp: 0, isStabilized: true }),
        makeEnemy({ id: 'e1', hp: 6 }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('e1');
  });

  it('stabilized character is also skipped on round wrap', () => {
    const cs = makeCs({
      round: 1,
      activeActorId: 'e1',
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 0, isStabilized: true, acted: true }),
        makeEnemy({ id: 'e1' }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.round).toBe(2);
    expect(next.activeActorId).not.toBe('p1');
  });

  it('dying player (hp=0, no saves yet) gets their turn after enemy acts', () => {
    const cs = makeCs({
      activeActorId: 'e1',
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 0, deathSaveFailures: 1 }),
        makeEnemy({ id: 'e1' }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('p1');
  });

  it('revived player (hp=1) is NOT skipped', () => {
    const cs = makeCs({
      activeActorId: 'e1',
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 1 }),
        makeEnemy({ id: 'e1' }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('p1');
  });
});

// ─── resolveEnemyTurn — auto-failures on dying targets ───────────────────────

describe('resolveEnemyTurn — targetIsDying auto-failures', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const defaultProps = { combat_stats: { attack_bonus: 3, damage: '1d6', ac: 12 } };

  it('hit on dying target returns 1 auto-failure and zero HP damage', () => {
    mockRollD20Check.mockReturnValue({ roll: 15, total: 18, success: true, critical: false, fumble: false, modifier: 3, dc: 14, dcType: 'AC' as const });
    const charEntry = makeChar({ id: 'p1', hp: 0, ac: 14 });
    const enemy = makeEnemy({ id: 'e1', proximity: 'close' });
    const cs = makeCs({ activeActorId: 'e1', initiativeOrder: [charEntry, enemy] });

    const result = resolveEnemyTurn(enemy, cs, 'p1', 'Anya', defaultProps, 'C', false, true);

    expect(result.hpDamage).toBe(0);
    expect(result.deathSaveAutoFailures).toBe(1);
    expect(result.facts[0]).toContain('death save failure');
  });

  it('critical hit on dying target returns 2 auto-failures', () => {
    mockRollD20Check.mockReturnValue({ roll: 20, total: 23, success: true, critical: true, fumble: false, modifier: 3, dc: 14, dcType: 'AC' as const });
    const charEntry = makeChar({ id: 'p1', hp: 0, ac: 14 });
    const enemy = makeEnemy({ id: 'e1', proximity: 'close' });
    const cs = makeCs({ activeActorId: 'e1', initiativeOrder: [charEntry, enemy] });

    const result = resolveEnemyTurn(enemy, cs, 'p1', 'Anya', defaultProps, 'C', false, true);

    expect(result.hpDamage).toBe(0);
    expect(result.deathSaveAutoFailures).toBe(2);
    expect(result.facts[0]).toContain('CRITICAL HIT');
    expect(result.facts[0]).toContain('2 death save failures');
  });

  it('miss on dying target returns 0 auto-failures', () => {
    mockRollD20Check.mockReturnValue({ roll: 3, total: 6, success: false, critical: false, fumble: false, modifier: 3, dc: 14, dcType: 'AC' as const });
    const charEntry = makeChar({ id: 'p1', hp: 0, ac: 14 });
    const enemy = makeEnemy({ id: 'e1', proximity: 'close' });
    const cs = makeCs({ activeActorId: 'e1', initiativeOrder: [charEntry, enemy] });

    const result = resolveEnemyTurn(enemy, cs, 'p1', 'Anya', defaultProps, 'C', false, true);

    expect(result.hpDamage).toBe(0);
    expect(result.deathSaveAutoFailures).toBe(0);
  });

  it('fumble on dying target returns 0 auto-failures', () => {
    mockRollD20Check.mockReturnValue({ roll: 1, total: 4, success: false, critical: false, fumble: true, modifier: 3, dc: 14, dcType: 'AC' as const });
    const charEntry = makeChar({ id: 'p1', hp: 0, ac: 14 });
    const enemy = makeEnemy({ id: 'e1', proximity: 'close' });
    const cs = makeCs({ activeActorId: 'e1', initiativeOrder: [charEntry, enemy] });

    const result = resolveEnemyTurn(enemy, cs, 'p1', 'Anya', defaultProps, 'C', false, true);

    expect(result.hpDamage).toBe(0);
    expect(result.deathSaveAutoFailures).toBe(0);
  });

  it('alive target (targetIsDying=false) still takes normal HP damage', () => {
    mockRollD20Check.mockReturnValue({ roll: 15, total: 18, success: true, critical: false, fumble: false, modifier: 3, dc: 14, dcType: 'AC' as const });
    const charEntry = makeChar({ id: 'p1', hp: 8, ac: 14 });
    const enemy = makeEnemy({ id: 'e1', proximity: 'close' });
    const cs = makeCs({ activeActorId: 'e1', initiativeOrder: [charEntry, enemy] });

    const result = resolveEnemyTurn(enemy, cs, 'p1', 'Anya', defaultProps, 'C', false, false);

    expect(result.hpDamage).toBeGreaterThan(0);
    expect(result.deathSaveAutoFailures).toBeUndefined();
  });

  it('default targetIsDying=false — behaves as alive target', () => {
    mockRollD20Check.mockReturnValue({ roll: 15, total: 18, success: true, critical: false, fumble: false, modifier: 3, dc: 14, dcType: 'AC' as const });
    const charEntry = makeChar({ id: 'p1', hp: 8, ac: 14 });
    const enemy = makeEnemy({ id: 'e1', proximity: 'close' });
    const cs = makeCs({ activeActorId: 'e1', initiativeOrder: [charEntry, enemy] });

    const result = resolveEnemyTurn(enemy, cs, 'p1', 'Anya', defaultProps);

    expect(result.hpDamage).toBeGreaterThan(0);
  });
});

// ─── resolveCombatAction — death_save action ─────────────────────────────────

describe('resolveCombatAction — death_save action', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('success (randomInt=14) increments deathSaveSuccesses on player entry', () => {
    mockRandomInt.mockReturnValue(14);
    const playerEntry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 0, deathSaveFailures: 0 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [playerEntry, makeEnemy({ id: 'e1' })] });

    const result = resolveCombatAction(deathSaveAction, cs, baseChar, null, null);

    const updated = result.updatedCombatState.initiativeOrder.find(e => e.id === 'p1')!;
    expect(updated.deathSaveSuccesses).toBe(1);
    expect(result.characterDied).toBe(false);
  });

  it('failure (randomInt=6) increments deathSaveFailures', () => {
    mockRandomInt.mockReturnValue(6);
    const playerEntry = makeChar({ id: 'p1', hp: 0 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [playerEntry, makeEnemy({ id: 'e1' })] });

    const result = resolveCombatAction(deathSaveAction, cs, baseChar, null, null);

    const updated = result.updatedCombatState.initiativeOrder.find(e => e.id === 'p1')!;
    expect(updated.deathSaveFailures).toBe(1);
    expect(result.characterDied).toBe(false);
  });

  it('third failure (randomInt=3, 2 existing) sets characterDied=true', () => {
    mockRandomInt.mockReturnValue(3);
    const playerEntry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 0, deathSaveFailures: 2 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [playerEntry, makeEnemy({ id: 'e1' })] });

    const result = resolveCombatAction(deathSaveAction, cs, baseChar, null, null);

    expect(result.characterDied).toBe(true);
    expect(result.facts[0]).toContain('died');
  });

  it('third success (randomInt=12, 2 existing) sets isStabilized=true', () => {
    mockRandomInt.mockReturnValue(12);
    const playerEntry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 2, deathSaveFailures: 0 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [playerEntry, makeEnemy({ id: 'e1' })] });

    const result = resolveCombatAction(deathSaveAction, cs, baseChar, null, null);

    const updated = result.updatedCombatState.initiativeOrder.find(e => e.id === 'p1')!;
    expect(updated.isStabilized).toBe(true);
    expect(result.characterDied).toBe(false);
  });

  it('natural 20 revives player (hp=1) and clears save counts', () => {
    mockRandomInt.mockReturnValue(20);
    const playerEntry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 1, deathSaveFailures: 1 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [playerEntry, makeEnemy({ id: 'e1' })] });

    const result = resolveCombatAction(deathSaveAction, cs, baseChar, null, null);

    const updated = result.updatedCombatState.initiativeOrder.find(e => e.id === 'p1')!;
    expect(updated.hp).toBe(1);
    expect(updated.deathSaveSuccesses).toBe(0);
    expect(updated.deathSaveFailures).toBe(0);
    expect(result.characterDied).toBe(false);
  });

  it('natural 1 counts as 2 failures', () => {
    mockRandomInt.mockReturnValue(1);
    const playerEntry = makeChar({ id: 'p1', hp: 0 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [playerEntry, makeEnemy({ id: 'e1' })] });

    const result = resolveCombatAction(deathSaveAction, cs, baseChar, null, null);

    const updated = result.updatedCombatState.initiativeOrder.find(e => e.id === 'p1')!;
    expect(updated.deathSaveFailures).toBe(2);
    expect(result.characterDied).toBe(false);
  });

  it('marks actionUsed in turn usage', () => {
    mockRandomInt.mockReturnValue(10);
    const playerEntry = makeChar({ id: 'p1', hp: 0 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [playerEntry] });

    const result = resolveCombatAction(deathSaveAction, cs, baseChar, null, null);

    expect(result.updatedCombatState.currentTurnUsage.actionUsed).toBe(true);
  });

  it('other entries in initiativeOrder are not mutated by death save', () => {
    mockRandomInt.mockReturnValue(10);
    const playerEntry = makeChar({ id: 'p1', hp: 0 });
    const enemy = makeEnemy({ id: 'e1', hp: 7 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [playerEntry, enemy] });

    const result = resolveCombatAction(deathSaveAction, cs, baseChar, null, null);

    const enemyAfter = result.updatedCombatState.initiativeOrder.find(e => e.id === 'e1')!;
    expect(enemyAfter.hp).toBe(7);
  });
});

// ─── Regression: stuck-enemy bug ─────────────────────────────────────────────

describe('advanceTurn regression — turn must advance past enemy who downed the player', () => {
  it('after enemy kills player, turn advances to dying player (not stuck on enemy)', () => {
    // Simulates state just AFTER an enemy attacked and killed the player.
    // The fix: advanceTurn is always called before breaking from the enemy loop.
    // Here we verify advanceTurn moves past the enemy to the dying player.
    const enemy = makeEnemy({ id: 'e1', acted: false });
    const player = makeChar({ id: 'p1', hp: 0 });
    const cs = makeCs({
      activeActorId: 'e1',
      initiativeOrder: [player, enemy],
    });

    const next = advanceTurn(cs);

    expect(next.activeActorId).not.toBe('e1');
    expect(next.activeActorId).toBe('p1');
  });

  it('two enemies — after first kills player, second enemy acts next (mid-round)', () => {
    // Turn order: p1 (dying, not yet acted), e1 (just acted), e2 (not yet acted).
    // advanceTurn scans FORWARD from e1 for the next unacted, non-skippable actor.
    // e2 comes after e1 and hasn't acted yet — so e2 goes next (mid-round continuation).
    // p1 (dying) would get a turn when the round wraps.
    // The key invariant: dying players are NOT skipped, they appear in turn order.
    const player = makeChar({ id: 'p1', hp: 0, acted: false });
    const e1 = makeEnemy({ id: 'e1', acted: false, name: 'Goblin1' });
    const e2 = makeEnemy({ id: 'e2', acted: false, name: 'Goblin2', initiative: 6 });
    const cs = makeCs({
      activeActorId: 'e1',
      initiativeOrder: [player, e1, e2],
    });

    const next = advanceTurn(cs);

    // e1 is at index 1; e2 is at index 2 (not acted, not skippable) — e2 goes next
    expect(next.activeActorId).toBe('e2');
    expect(next.round).toBe(1);  // still round 1, mid-round
  });

  it('stabilized player is skipped — active loops back to enemies on round wrap', () => {
    const stabilized = makeChar({ id: 'p1', hp: 0, isStabilized: true, acted: true });
    const enemy = makeEnemy({ id: 'e1', acted: false });
    const cs = makeCs({
      activeActorId: 'e1',
      initiativeOrder: [stabilized, enemy],
    });

    const next = advanceTurn(cs);
    expect(next.round).toBe(2);
    expect(next.activeActorId).toBe('e1');
  });
});

// ─── Regression: resolveCombatAction characterDied=false for all non-death-save ─

describe('resolveCombatAction — characterDied=false regression for standard actions', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('dodge action returns characterDied=false', () => {
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [makeChar({ id: 'p1', hp: 10 })] });
    const action = { action_type: 'dodge' as const, target_poi_instance_id: null, resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null };
    expect(resolveCombatAction(action, cs, baseChar, null, null).characterDied).toBe(false);
  });

  it('hide action returns characterDied=false', () => {
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [makeChar({ id: 'p1', hp: 10 })] });
    const action = { action_type: 'hide' as const, target_poi_instance_id: null, resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null };
    expect(resolveCombatAction(action, cs, baseChar, null, null).characterDied).toBe(false);
  });

  it('attack action returns characterDied=false', () => {
    mockRollD20Check.mockReturnValue({ roll: 15, total: 18, success: true, critical: false, fumble: false, modifier: 3, dc: 12, dcType: 'AC' as const });
    const playerEntry = makeChar({ id: 'p1', hp: 10 });
    const enemy = makeEnemy({ id: 'e1' });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [playerEntry, enemy] });
    const action = { action_type: 'attack' as const, target_poi_instance_id: 'e1', resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null };
    expect(resolveCombatAction(action, cs, baseChar, null, null).characterDied).toBe(false);
  });

  it('dash action returns characterDied=false', () => {
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [makeChar({ id: 'p1', hp: 10 })] });
    const action = { action_type: 'dash' as const, target_poi_instance_id: null, resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null };
    expect(resolveCombatAction(action, cs, baseChar, null, null).characterDied).toBe(false);
  });
});
